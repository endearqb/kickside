package feishu

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
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

const (
	feishuDispatchShardCount = 32
	feishuFragmentTTL        = 2 * time.Minute
)

type dispatchShards struct {
	locks []sync.Mutex
}

type combinedPayload struct {
	createdAt time.Time
	parts     [][]byte
}

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

func (c *Client) BotOpenID(ctx context.Context) (string, error) {
	tokenBody, _ := json.Marshal(map[string]string{"app_id": c.appID, "app_secret": c.appSecret})
	tokenRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, c.domain+"/open-apis/auth/v3/tenant_access_token/internal", bytes.NewReader(tokenBody))
	if err != nil {
		return "", err
	}
	tokenRequest.Header.Set("Content-Type", "application/json")
	tokenResponse, err := c.httpClient.Do(tokenRequest)
	if err != nil {
		return "", err
	}
	defer tokenResponse.Body.Close()
	var tokenPayload struct {
		Code  int    `json:"code"`
		Msg   string `json:"msg"`
		Token string `json:"tenant_access_token"`
	}
	if err := json.NewDecoder(io.LimitReader(tokenResponse.Body, 1<<20)).Decode(&tokenPayload); err != nil {
		return "", err
	}
	if tokenResponse.StatusCode != http.StatusOK || tokenPayload.Code != 0 || strings.TrimSpace(tokenPayload.Token) == "" {
		return "", &APIError{Operation: "bot_identity_token", Code: tokenPayload.Code, Message: tokenPayload.Msg, HTTPStatus: tokenResponse.StatusCode}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.domain+"/open-apis/bot/v3/info", nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+tokenPayload.Token)
	response, err := c.httpClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	var payload struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Bot  struct {
			OpenID string `json:"open_id"`
		} `json:"bot"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload); err != nil {
		return "", err
	}
	if response.StatusCode != http.StatusOK || payload.Code != 0 || strings.TrimSpace(payload.Bot.OpenID) == "" {
		return "", &APIError{Operation: "bot_identity", Code: payload.Code, Message: payload.Msg, HTTPStatus: response.StatusCode}
	}
	return strings.TrimSpace(payload.Bot.OpenID), nil
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

func (c *Client) CreateMessage(ctx context.Context, request SendMessageRequest) (*SendMessageResult, error) {
	body := larkim.NewCreateMessageReqBodyBuilder().
		ReceiveId(strings.TrimSpace(request.ChatID)).
		MsgType(strings.TrimSpace(request.MessageType)).
		Content(request.Content)
	if request.UUID != "" {
		body = body.Uuid(request.UUID)
	}
	req := larkim.NewCreateMessageReqBuilder().
		ReceiveIdType("chat_id").
		Body(body.Build()).
		Build()
	resp, err := c.api.Im.V1.Message.Create(ctx, req)
	if err != nil {
		return nil, err
	}
	if resp == nil || !resp.Success() {
		if resp == nil {
			return nil, &APIError{Operation: "create_message", Message: "empty response"}
		}
		return nil, &APIError{Operation: "create_message", Code: int(resp.Code), Message: resp.Msg}
	}
	return &SendMessageResult{
		MessageID: stringValue(resp.Data.MessageId),
		RootID:    stringValue(resp.Data.RootId),
		ThreadID:  stringValue(resp.Data.ThreadId),
	}, nil
}

func (c *Client) PatchMessage(ctx context.Context, messageID string, content string) error {
	body := larkim.NewPatchMessageReqBodyBuilder().
		Content(content).
		Build()
	req := larkim.NewPatchMessageReqBuilder().
		MessageId(strings.TrimSpace(messageID)).
		Body(body).
		Build()
	resp, err := c.api.Im.V1.Message.Patch(ctx, req)
	if err != nil {
		return err
	}
	if resp == nil || !resp.Success() {
		if resp == nil {
			return &APIError{Operation: "patch_message", Message: "empty response"}
		}
		return &APIError{Operation: "patch_message", Code: int(resp.Code), Message: resp.Msg}
	}
	return nil
}

func (c *Client) DownloadImage(ctx context.Context, imageKey string) (*DownloadedResource, error) {
	req := larkim.NewGetImageReqBuilder().ImageKey(strings.TrimSpace(imageKey)).Build()
	resp, err := c.api.Im.V1.Image.Get(ctx, req)
	if err != nil {
		return nil, err
	}
	if resp == nil || resp.File == nil {
		return nil, &APIError{Operation: "download_image", Message: "empty image response"}
	}
	raw, err := io.ReadAll(resp.File)
	if err != nil {
		return nil, &APIError{Operation: "download_image", Message: err.Error()}
	}
	return &DownloadedResource{
		FileName:  fallbackResourceName(imageKey, ".png"),
		MimeType:  http.DetectContentType(raw),
		SizeBytes: int64(len(raw)),
		Content:   raw,
	}, nil
}

func (c *Client) DownloadFile(ctx context.Context, fileKey string) (*DownloadedResource, error) {
	req := larkim.NewGetFileReqBuilder().FileKey(strings.TrimSpace(fileKey)).Build()
	resp, err := c.api.Im.V1.File.Get(ctx, req)
	if err != nil {
		return nil, err
	}
	if resp == nil || resp.File == nil {
		return nil, &APIError{Operation: "download_file", Message: "empty file response"}
	}
	raw, err := io.ReadAll(resp.File)
	if err != nil {
		return nil, &APIError{Operation: "download_file", Message: err.Error()}
	}
	return &DownloadedResource{
		FileName:  fallbackResourceName(fileKey, ".bin"),
		MimeType:  http.DetectContentType(raw),
		SizeBytes: int64(len(raw)),
		Content:   raw,
	}, nil
}

func (c *Client) UploadImage(ctx context.Context, localPath string) (*UploadedResource, error) {
	body, err := larkim.NewCreateImagePathReqBodyBuilder().
		ImageType("message").
		ImagePath(strings.TrimSpace(localPath)).
		Build()
	if err != nil {
		return nil, err
	}
	req := larkim.NewCreateImageReqBuilder().Body(body).Build()
	resp, err := c.api.Im.V1.Image.Create(ctx, req)
	if err != nil {
		return nil, err
	}
	if resp == nil || !resp.Success() {
		if resp == nil {
			return nil, &APIError{Operation: "upload_image", Message: "empty response"}
		}
		return nil, &APIError{Operation: "upload_image", Code: int(resp.Code), Message: resp.Msg}
	}
	return &UploadedResource{Key: stringValue(resp.Data.ImageKey)}, nil
}

func (c *Client) UploadFile(ctx context.Context, localPath string, fileName string) (*UploadedResource, error) {
	name := strings.TrimSpace(fileName)
	if name == "" {
		name = filepath.Base(strings.TrimSpace(localPath))
	}
	body, err := larkim.NewCreateFilePathReqBodyBuilder().
		FileType("stream").
		FileName(name).
		FilePath(strings.TrimSpace(localPath)).
		Build()
	if err != nil {
		return nil, err
	}
	req := larkim.NewCreateFileReqBuilder().Body(body).Build()
	resp, err := c.api.Im.V1.File.Create(ctx, req)
	if err != nil {
		return nil, err
	}
	if resp == nil || !resp.Success() {
		if resp == nil {
			return nil, &APIError{Operation: "upload_file", Message: "empty response"}
		}
		return nil, &APIError{Operation: "upload_file", Code: int(resp.Code), Message: resp.Msg}
	}
	return &UploadedResource{Key: stringValue(resp.Data.FileKey)}, nil
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

	combined := map[string]*combinedPayload{}
	shards := newDispatchShards(feishuDispatchShardCount)
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
			if err := c.handleDataFrame(ctx, conn, writeMu, dispatch, shards, combined, frame); err != nil {
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

func (c *Client) logf(format string, args ...any) {
	if c.logger != nil {
		c.logger.Printf(format, args...)
	}
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
	shards *dispatchShards,
	combined map[string]*combinedPayload,
	frame *larkws.Frame,
) error {
	headers := larkws.Headers(frame.Headers)
	sum := headers.GetInt(larkws.HeaderSum)
	seq := headers.GetInt(larkws.HeaderSeq)
	messageID := headers.GetString(larkws.HeaderMessageID)
	messageType := larkws.MessageType(headers.GetString(larkws.HeaderType))

	payload := frame.Payload
	if sum > 1 {
		c.pruneCombinedPayloads(combined, time.Now())
		payload = combinePayload(combined, messageID, sum, seq, payload, c.logger)
		if payload == nil {
			return nil
		}
	}

	startedAt := time.Now()
	switch messageType {
	case larkws.MessageTypeEvent:
		if err := c.writeDataResponse(conn, writeMu, headers, frame, startedAt, http.StatusOK, nil); err != nil {
			return err
		}
		key := dispatchKey(payload, messageID)
		shards.Go(ctx, key, func() {
			if _, err := dispatch.Do(ctx, payload); err != nil {
				c.logf("feishu async event dispatch failed key=%s err=%q", key, err.Error())
			}
		})
		return nil
	case larkws.MessageTypeCard:
		responseData, err := dispatch.Do(ctx, payload)
		status := http.StatusOK
		if err != nil {
			var notFound *dispatcher.NotFoundEventHandlerErr
			if !errors.As(err, &notFound) {
				status = http.StatusInternalServerError
			}
		}
		if writeErr := c.writeDataResponse(conn, writeMu, headers, frame, startedAt, status, responseData); writeErr != nil {
			return writeErr
		}
		return err
	default:
		return nil
	}
}

func (c *Client) writeDataResponse(
	conn *socket.Conn,
	writeMu *sync.Mutex,
	headers larkws.Headers,
	frame *larkws.Frame,
	startedAt time.Time,
	status int,
	responseData any,
) error {
	response := larkws.NewResponseByCode(status)
	if responseData != nil {
		data, err := json.Marshal(responseData)
		if err != nil {
			return reliability.Wrap("payload_invalid", err)
		}
		response.Data = data
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
			Key:  stringValue(mention.Key),
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
		SenderType:  senderType(sender),
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
			Type: "card_json",
			Data: result.UpdatedCard,
		}
	}
	return response
}

func newDispatchShards(count int) *dispatchShards {
	if count <= 0 {
		count = 1
	}
	return &dispatchShards{locks: make([]sync.Mutex, count)}
}

func (s *dispatchShards) Go(ctx context.Context, key string, fn func()) {
	if s == nil || len(s.locks) == 0 {
		go fn()
		return
	}
	index := int(hashString(key) % uint32(len(s.locks)))
	go func() {
		lock := &s.locks[index]
		lock.Lock()
		defer lock.Unlock()
		if ctx.Err() != nil {
			return
		}
		fn()
	}()
}

func hashString(value string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return h.Sum32()
}

func (c *Client) pruneCombinedPayloads(combined map[string]*combinedPayload, now time.Time) {
	for messageID, entry := range combined {
		if now.Sub(entry.createdAt) > feishuFragmentTTL {
			delete(combined, messageID)
			c.logf("feishu dropped stale fragmented frame messageID=%s", messageID)
		}
	}
}

func combinePayload(combined map[string]*combinedPayload, messageID string, sum int, seq int, payload []byte, logger Logger) []byte {
	if sum <= 1 || messageID == "" {
		return payload
	}
	if seq < 0 || seq >= sum {
		if logger != nil {
			logger.Printf("feishu dropped fragmented frame with invalid seq messageID=%s sum=%d seq=%d", messageID, sum, seq)
		}
		return nil
	}
	entry := combined[messageID]
	if entry == nil || len(entry.parts) != sum {
		entry = &combinedPayload{createdAt: time.Now(), parts: make([][]byte, sum)}
		combined[messageID] = entry
	}
	entry.parts[seq] = payload

	total := 0
	for _, part := range entry.parts {
		if len(part) == 0 {
			return nil
		}
		total += len(part)
	}

	merged := make([]byte, 0, total)
	for _, part := range entry.parts {
		merged = append(merged, part...)
	}
	delete(combined, messageID)
	return merged
}

func dispatchKey(payload []byte, fallback string) string {
	var value any
	if err := json.Unmarshal(payload, &value); err == nil {
		if chatID := nestedString(value, "event", "message", "chat_id"); chatID != "" {
			return chatID
		}
		if chatID := nestedString(value, "event", "context", "open_chat_id"); chatID != "" {
			return chatID
		}
		if eventID := nestedString(value, "header", "event_id"); eventID != "" {
			return eventID
		}
	}
	if strings.TrimSpace(fallback) != "" {
		return strings.TrimSpace(fallback)
	}
	return "default"
}

func nestedString(value any, path ...string) string {
	current := value
	for _, key := range path {
		mapped, ok := current.(map[string]any)
		if !ok {
			return ""
		}
		current = mapped[key]
	}
	text, _ := current.(string)
	return strings.TrimSpace(text)
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

func fallbackResourceName(key string, extension string) string {
	base := strings.TrimSpace(key)
	if base == "" {
		base = "resource"
	}
	if strings.ContainsRune(base, os.PathSeparator) {
		base = filepath.Base(base)
	}
	if extension != "" && filepath.Ext(base) == "" {
		base += extension
	}
	return base
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

func senderType(sender *larkim.EventSender) string {
	if sender == nil {
		return ""
	}
	return stringValue(sender.SenderType)
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
