package feishu

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	socket "github.com/gorilla/websocket"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkevent "github.com/larksuite/oapi-sdk-go/v3/event"
	dispatcher "github.com/larksuite/oapi-sdk-go/v3/event/dispatcher"
	callback "github.com/larksuite/oapi-sdk-go/v3/event/dispatcher/callback"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/reliability"
)

type ClientOptions struct {
	HTTPClient *http.Client
	Dialer     *socket.Dialer
	Domain     string
	Logger     Logger
}

type Client struct {
	appID      string
	appSecret  string
	httpClient *http.Client
	dialer     *socket.Dialer
	domain     string
	logger     Logger
	api        *lark.Client
}

type APIError struct {
	Operation  string
	Code       int
	Message    string
	HTTPStatus int
}

func (e *APIError) Error() string {
	if e == nil {
		return ""
	}
	switch {
	case e.Code != 0:
		return fmt.Sprintf("feishu %s failed: code=%d msg=%s", e.Operation, e.Code, e.Message)
	case e.HTTPStatus != 0:
		return fmt.Sprintf("feishu %s failed: http=%d msg=%s", e.Operation, e.HTTPStatus, e.Message)
	default:
		return fmt.Sprintf("feishu %s failed: %s", e.Operation, e.Message)
	}
}

func NewClient(appID string, appSecret string, options ClientOptions) *Client {
	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	dialer := options.Dialer
	if dialer == nil {
		dialer = socket.DefaultDialer
	}
	domain := strings.TrimSpace(options.Domain)
	if domain == "" {
		domain = lark.FeishuBaseUrl
	}
	return &Client{
		appID:      strings.TrimSpace(appID),
		appSecret:  strings.TrimSpace(appSecret),
		httpClient: httpClient,
		dialer:     dialer,
		domain:     strings.TrimRight(domain, "/"),
		logger:     options.Logger,
		api:        lark.NewClient(appID, appSecret),
	}
}

func (c *Client) ProbeCredentials(ctx context.Context) error {
	resp, err := c.api.GetTenantAccessTokenBySelfBuiltApp(ctx, &larkcore.SelfBuiltTenantAccessTokenReq{
		AppID:     c.appID,
		AppSecret: c.appSecret,
	})
	if err != nil {
		c.logStageFailure("credential_probe", err)
		return err
	}
	if resp == nil || !resp.Success() {
		if resp == nil {
			err = &APIError{
				Operation: "probe_credentials",
				Message:   "empty response",
			}
			c.logStageFailure("credential_probe", err)
			return err
		}
		err = &APIError{
			Operation: "probe_credentials",
			Code:      int(resp.Code),
			Message:   resp.Msg,
		}
		c.logStageFailure("credential_probe", err)
		return err
	}
	return nil
}

func (c *Client) ReplyMessage(ctx context.Context, request SendMessageRequest) (*SendMessageResult, error) {
	body := larkim.NewReplyMessageReqBodyBuilder().
		Content(request.Content).
		MsgType(strings.TrimSpace(request.MessageType))
	if request.UUID != "" {
		body = body.Uuid(request.UUID)
	}
	req := larkim.NewReplyMessageReqBuilder().
		MessageId(strings.TrimSpace(request.ReplyToMessageID)).
		Body(body.Build()).
		Build()
	resp, err := c.api.Im.V1.Message.Reply(ctx, req)
	if err != nil {
		return nil, err
	}
	if resp == nil || !resp.Success() {
		if resp == nil {
			return nil, &APIError{
				Operation: "reply_message",
				Message:   "empty response",
			}
		}
		return nil, &APIError{
			Operation: "reply_message",
			Code:      int(resp.Code),
			Message:   resp.Msg,
		}
	}
	return &SendMessageResult{
		MessageID: stringValue(resp.Data.MessageId),
		RootID:    stringValue(resp.Data.RootId),
		ThreadID:  stringValue(resp.Data.ThreadId),
	}, nil
}

func (c *Client) Run(ctx context.Context, handler EventHandler) error {
	endpoint, err := c.fetchEndpoint(ctx)
	if err != nil {
		return reliability.Wrap("platform_unavailable", err)
	}

	conn, serviceID, pingInterval, err := c.connect(ctx, endpoint)
	if err != nil {
		return reliability.Wrap(classifyFeishuError(err).Code, err)
	}
	defer conn.Close()

	dispatch := c.newDispatcher(handler)
	writeMu := &sync.Mutex{}
	if handler != nil {
		handler.OnReady(ctx)
	}

	go func() {
		<-ctx.Done()
		_ = conn.Close()
	}()
	go c.pingLoop(ctx, conn, writeMu, serviceID, pingInterval)

	combined := map[string][][]byte{}
	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return reliability.Wrap(classifyFeishuError(err).Code, err)
		}
		if messageType != socket.BinaryMessage {
			continue
		}

		frame := &larkws.Frame{}
		if err := frame.Unmarshal(payload); err != nil {
			return reliability.Wrap("platform_unavailable", err)
		}

		switch larkws.FrameType(frame.Method) {
		case larkws.FrameTypeControl:
			c.handleControlFrame(frame, &pingInterval)
		case larkws.FrameTypeData:
			if err := c.handleDataFrame(ctx, conn, writeMu, dispatch, combined, frame); err != nil {
				return err
			}
		}
	}
}

func (c *Client) fetchEndpoint(ctx context.Context) (*larkws.Endpoint, error) {
	body, err := json.Marshal(map[string]string{
		"AppID":     c.appID,
		"AppSecret": c.appSecret,
	})
	if err != nil {
		c.logStageFailure("endpoint_fetch", err)
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.domain+larkws.GenEndpointUri, bytes.NewBuffer(body))
	if err != nil {
		c.logStageFailure("endpoint_fetch", err)
		return nil, err
	}
	req.Header.Set("locale", "zh")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.logStageFailure("endpoint_fetch", err)
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		err = fmt.Errorf("feishu ws endpoint returned http %d", resp.StatusCode)
		c.logStageFailure("endpoint_fetch", err)
		return nil, err
	}

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		c.logStageFailure("endpoint_fetch", err)
		return nil, err
	}
	var endpointResp larkws.EndpointResp
	if err := json.Unmarshal(raw, &endpointResp); err != nil {
		c.logStageFailure("endpoint_fetch", err)
		return nil, err
	}
	switch endpointResp.Code {
	case larkws.OK:
	case larkws.SystemBusy, larkws.InternalError:
		err = larkws.NewServerError(endpointResp.Code, endpointResp.Msg)
		c.logStageFailure("endpoint_fetch", err)
		return nil, err
	default:
		err = larkws.NewClientError(endpointResp.Code, endpointResp.Msg)
		c.logStageFailure("endpoint_fetch", err)
		return nil, err
	}
	if endpointResp.Data == nil || strings.TrimSpace(endpointResp.Data.Url) == "" {
		err = fmt.Errorf("feishu ws endpoint is empty")
		c.logStageFailure("endpoint_fetch", err)
		return nil, err
	}
	return endpointResp.Data, nil
}

func (c *Client) connect(ctx context.Context, endpoint *larkws.Endpoint) (*socket.Conn, int32, time.Duration, error) {
	parsed, err := url.Parse(endpoint.Url)
	if err != nil {
		c.logStageFailure("websocket_handshake", err)
		return nil, 0, 0, err
	}
	conn, resp, err := c.dialer.DialContext(ctx, endpoint.Url, nil)
	if err != nil {
		if resp != nil {
			err = parseHandshakeError(resp)
			c.logStageFailure("websocket_handshake", err)
			return nil, 0, 0, err
		}
		c.logStageFailure("websocket_handshake", err)
		return nil, 0, 0, err
	}

	serviceID, _ := parseInt32(parsed.Query().Get(larkws.ServiceID))
	pingInterval := 2 * time.Minute
	if endpoint.ClientConfig != nil && endpoint.ClientConfig.PingInterval > 0 {
		pingInterval = time.Duration(endpoint.ClientConfig.PingInterval) * time.Second
	}
	return conn, serviceID, pingInterval, nil
}

func (c *Client) logStageFailure(stage string, err error) {
	if c.logger == nil || err == nil {
		return
	}

	classification := classifyFeishuError(err)
	code := classification.Code
	if code == "" {
		code = "unknown"
	}
	c.logger.Printf(
		"channel event=failure platform=%s stage=%s errorCode=%s retryable=%t err=%q",
		platformID,
		stage,
		code,
		classification.Retryable,
		err.Error(),
	)
}

func (c *Client) pingLoop(ctx context.Context, conn *socket.Conn, writeMu *sync.Mutex, serviceID int32, interval time.Duration) {
	if interval <= 0 {
		interval = 2 * time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			frame := larkws.NewPingFrame(serviceID)
			payload, err := frame.Marshal()
			if err != nil {
				continue
			}
			writeMu.Lock()
			err = conn.WriteMessage(socket.BinaryMessage, payload)
			writeMu.Unlock()
			if err != nil {
				return
			}
		}
	}
}

func (c *Client) handleControlFrame(frame *larkws.Frame, pingInterval *time.Duration) {
	headers := larkws.Headers(frame.Headers)
	if larkws.MessageType(headers.GetString(larkws.HeaderType)) != larkws.MessageTypePong {
		return
	}
	if len(frame.Payload) == 0 {
		return
	}
	config := &larkws.ClientConfig{}
	if err := json.Unmarshal(frame.Payload, config); err != nil {
		return
	}
	if config.PingInterval > 0 {
		*pingInterval = time.Duration(config.PingInterval) * time.Second
	}
}

func (c *Client) handleDataFrame(
	ctx context.Context,
	conn *socket.Conn,
	writeMu *sync.Mutex,
	dispatch *dispatcher.EventDispatcher,
	combined map[string][][]byte,
	frame *larkws.Frame,
) error {
	headers := larkws.Headers(frame.Headers)
	sum := headers.GetInt(larkws.HeaderSum)
	seq := headers.GetInt(larkws.HeaderSeq)
	messageID := headers.GetString(larkws.HeaderMessageID)
	messageType := larkws.MessageType(headers.GetString(larkws.HeaderType))

	payload := frame.Payload
	if sum > 1 {
		payload = combinePayload(combined, messageID, sum, seq, payload)
		if payload == nil {
			return nil
		}
	}

	startedAt := time.Now()
	var responseData any
	var err error
	switch messageType {
	case larkws.MessageTypeEvent, larkws.MessageTypeCard:
		responseData, err = dispatch.Do(ctx, payload)
	default:
		return nil
	}

	response := larkws.NewResponseByCode(http.StatusOK)
	if err != nil {
		var notFound *dispatcher.NotFoundEventHandlerErr
		if !errors.As(err, &notFound) {
			response = larkws.NewResponseByCode(http.StatusInternalServerError)
		}
	}
	if err == nil && responseData != nil {
		response.Data, err = json.Marshal(responseData)
		if err != nil {
			return reliability.Wrap("payload_invalid", err)
		}
	}

	headers.Add(larkws.HeaderBizRt, fmt.Sprintf("%d", time.Since(startedAt).Milliseconds()))
	frame.Headers = headers
	frame.Payload, _ = json.Marshal(response)
	payloadBytes, marshalErr := frame.Marshal()
	if marshalErr != nil {
		return marshalErr
	}

	writeMu.Lock()
	writeErr := conn.WriteMessage(socket.BinaryMessage, payloadBytes)
	writeMu.Unlock()
	if writeErr != nil {
		return reliability.Wrap(classifyFeishuError(writeErr).Code, writeErr)
	}
	if err != nil {
		return err
	}
	return nil
}

func (c *Client) newDispatcher(handler EventHandler) *dispatcher.EventDispatcher {
	dispatch := dispatcher.NewEventDispatcher("", "")
	dispatch.OnP2MessageReceiveV1(func(ctx context.Context, event *larkim.P2MessageReceiveV1) error {
		if handler == nil {
			return nil
		}
		return handler.OnMessage(ctx, convertMessageEvent(event))
	})
	dispatch.OnP2CardActionTrigger(func(ctx context.Context, event *callback.CardActionTriggerEvent) (*callback.CardActionTriggerResponse, error) {
		if handler == nil {
			return nil, nil
		}
		result, err := handler.OnCardAction(ctx, convertCardActionEvent(event))
		if err != nil {
			return nil, err
		}
		if result == nil {
			return nil, nil
		}
		return convertCardActionResult(result), nil
	})
	return dispatch
}

func convertMessageEvent(event *larkim.P2MessageReceiveV1) *MessageEvent {
	if event == nil || event.Event == nil || event.Event.Message == nil {
		return &MessageEvent{}
	}
	message := event.Event.Message
	sender := event.Event.Sender
	mentions := make([]Mention, 0, len(message.Mentions))
	for _, mention := range message.Mentions {
		if mention == nil {
			continue
		}
		mentions = append(mentions, Mention{
			ID:   userIDOpenID(mention.Id),
			Name: stringValue(mention.Name),
		})
	}
	return &MessageEvent{
		EventID:     headerEventID(event.EventV2Base),
		MessageID:   stringValue(message.MessageId),
		RootID:      stringValue(message.RootId),
		ParentID:    stringValue(message.ParentId),
		ChatID:      stringValue(message.ChatId),
		ThreadID:    stringValue(message.ThreadId),
		ChatType:    stringValue(message.ChatType),
		MessageType: stringValue(message.MessageType),
		Content:     stringValue(message.Content),
		Mentions:    mentions,
		SenderID:    senderOpenID(sender),
		SenderName:  "",
		ReceivedAt:  messageTime(message.CreateTime),
		RawRef:      stringValue(message.MessageId),
	}
}

func convertCardActionEvent(event *callback.CardActionTriggerEvent) *CardActionEvent {
	actionValues := map[string]string{}
	if event != nil && event.Event != nil && event.Event.Action != nil {
		for key, value := range event.Event.Action.Value {
			actionValues[key] = fmt.Sprint(value)
		}
	}
	return &CardActionEvent{
		EventID:      headerEventID(event.EventV2Base),
		MessageID:    callbackContextMessageID(event),
		ChatID:       callbackContextChatID(event),
		ThreadID:     strings.TrimSpace(actionValues["thread_id"]),
		OperatorID:   callbackOperatorID(event),
		OperatorName: "",
		ActionValue:  actionValues,
		RawRef:       callbackContextMessageID(event),
	}
}

func convertCardActionResult(result *CardActionResult) *callback.CardActionTriggerResponse {
	if result == nil {
		return nil
	}
	response := &callback.CardActionTriggerResponse{}
	if strings.TrimSpace(result.Toast) != "" {
		response.Toast = &callback.Toast{
			Type:    "info",
			Content: strings.TrimSpace(result.Toast),
		}
	}
	if result.UpdatedCard != nil {
		response.Card = &callback.Card{
			Type: "raw",
			Data: result.UpdatedCard,
		}
	}
	return response
}

func combinePayload(combined map[string][][]byte, messageID string, sum int, seq int, payload []byte) []byte {
	if sum <= 1 || messageID == "" {
		return payload
	}
	buffer := combined[messageID]
	if buffer == nil {
		buffer = make([][]byte, sum)
		combined[messageID] = buffer
	}
	if seq >= 0 && seq < len(buffer) {
		buffer[seq] = payload
	}

	total := 0
	for _, part := range buffer {
		if len(part) == 0 {
			return nil
		}
		total += len(part)
	}

	merged := make([]byte, 0, total)
	for _, part := range buffer {
		merged = append(merged, part...)
	}
	delete(combined, messageID)
	return merged
}

func parseHandshakeError(resp *http.Response) error {
	code := headerInt(resp.Header.Get(larkws.HeaderHandshakeStatus))
	message := resp.Header.Get(larkws.HeaderHandshakeMsg)
	switch code {
	case larkws.AuthFailed, larkws.Forbidden:
		return larkws.NewClientError(code, message)
	default:
		return larkws.NewServerError(code, message)
	}
}

func headerInt(value string) int {
	number, _ := parseInt32(value)
	return int(number)
}

func parseInt32(value string) (int32, error) {
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 32)
	if err != nil {
		return 0, err
	}
	return int32(parsed), nil
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func senderOpenID(sender *larkim.EventSender) string {
	if sender == nil {
		return ""
	}
	return userIDOpenID(sender.SenderId)
}

func userIDOpenID(userID *larkim.UserId) string {
	if userID == nil || userID.OpenId == nil {
		return ""
	}
	return strings.TrimSpace(*userID.OpenId)
}

func messageTime(value *string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return ""
	}
	millis, err := time.ParseDuration(strings.TrimSpace(*value) + "ms")
	if err != nil {
		return ""
	}
	return time.UnixMilli(millis.Milliseconds()).UTC().Format(time.RFC3339)
}

func headerEventID(base *larkevent.EventV2Base) string {
	if base == nil || base.Header == nil {
		return ""
	}
	return strings.TrimSpace(base.Header.EventID)
}

func callbackContextMessageID(event *callback.CardActionTriggerEvent) string {
	if event == nil || event.Event == nil || event.Event.Context == nil {
		return ""
	}
	return strings.TrimSpace(event.Event.Context.OpenMessageID)
}

func callbackContextChatID(event *callback.CardActionTriggerEvent) string {
	if event == nil || event.Event == nil || event.Event.Context == nil {
		return ""
	}
	return strings.TrimSpace(event.Event.Context.OpenChatID)
}

func callbackOperatorID(event *callback.CardActionTriggerEvent) string {
	if event == nil || event.Event == nil || event.Event.Operator == nil {
		return ""
	}
	return strings.TrimSpace(event.Event.Operator.OpenID)
}
