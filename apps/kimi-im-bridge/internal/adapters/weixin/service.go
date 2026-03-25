package weixin

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/adapterkit"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

const (
	platformID             = "weixin"
	weixinOffsetKind       = "weixin_get_updates_buf"
	defaultLongPollTimeout = 35_000
	defaultChannelVersion  = "kimi-im-bridge"
)

type BindingRouter interface {
	ResolveBinding(context.Context, domain.BindingKey) (*domain.SessionBinding, error)
	CreateBinding(context.Context, domain.BindingKey, string, string, string) (*domain.SessionBinding, error)
	UpdateBindingContextToken(context.Context, string, string) error
}

type ChannelStore interface {
	GetOffset(context.Context, string, string) (string, bool, error)
	UpdateChannelState(context.Context, string, domain.ChannelRuntimeState, string, string) error
	UpdateChannelOffset(context.Context, string, string, string) error
	TouchChannelInbound(context.Context, string, string) error
	TouchChannelOutbound(context.Context, string, string) error
}

type Logger interface {
	Printf(string, ...any)
}

type Config struct {
	ConnectorID    string
	ConnectorLabel string
	BotToken       string
	BaseURL        string
	AccountID      string
	OwnerUserID    string
	DefaultWorkDir string
}

type Options struct {
	Config        Config
	BindingRouter BindingRouter
	Orchestrator  bridgecore.InboundExecutor
	Store         ChannelStore
	Logger        Logger
	Client        *Client
}

type Service struct {
	config       Config
	client       *Client
	bindings     BindingRouter
	orchestrator bridgecore.InboundExecutor
	store        ChannelStore
	logger       Logger

	mu      sync.RWMutex
	started bool
	done    chan struct{}
}

func NewService(options Options) *Service {
	client := options.Client
	if client == nil && strings.TrimSpace(options.Config.BotToken) != "" {
		client = NewClient(options.Config.BaseURL, options.Config.BotToken)
	}
	return &Service{
		config:       options.Config,
		client:       client,
		bindings:     options.BindingRouter,
		orchestrator: options.Orchestrator,
		store:        options.Store,
		logger:       options.Logger,
		done:         closedDone(),
	}
}

func (s *Service) Name() string {
	if value := strings.TrimSpace(s.config.ConnectorLabel); value != "" {
		return value
	}
	if value := strings.TrimSpace(s.config.ConnectorID); value != "" {
		return value
	}
	return platformID
}

func (s *Service) Done() <-chan struct{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.done
}

func (s *Service) Start(ctx context.Context) error {
	if strings.TrimSpace(s.config.BotToken) == "" {
		return s.failStart(ctx, "invalid_credentials", fmt.Errorf("weixin bot token is required"))
	}
	if strings.TrimSpace(s.config.AccountID) == "" {
		return s.failStart(ctx, "invalid_credentials", fmt.Errorf("weixin account id is required"))
	}
	if strings.TrimSpace(s.config.OwnerUserID) == "" {
		return s.failStart(ctx, "invalid_credentials", fmt.Errorf("weixin owner user id is required"))
	}
	if s.client == nil {
		return s.failStart(ctx, "invalid_credentials", fmt.Errorf("weixin client is not configured"))
	}
	if s.bindings == nil || s.orchestrator == nil || s.store == nil {
		return s.failStart(ctx, "unknown", fmt.Errorf("weixin adapter dependencies are incomplete"))
	}

	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return nil
	}
	s.started = true
	s.done = make(chan struct{})
	done := s.done
	s.mu.Unlock()

	if err := s.store.UpdateChannelState(ctx, s.connectorID(), domain.ChannelStateConnecting, "", ""); err != nil {
		return s.abortStart(err)
	}

	getUpdatesBuf, err := s.loadOffset(ctx)
	if err != nil {
		return s.failAfterStart(ctx, "unknown", err)
	}
	if err := s.store.UpdateChannelState(ctx, s.connectorID(), domain.ChannelStateReady, "", ""); err != nil {
		return s.abortStart(err)
	}
	go s.pollLoop(ctx, getUpdatesBuf, done)
	return nil
}

func (s *Service) loadOffset(ctx context.Context) (string, error) {
	value, ok, err := s.store.GetOffset(ctx, s.connectorID(), weixinOffsetKind)
	if err != nil {
		return "", fmt.Errorf("read weixin offset: %w", err)
	}
	if !ok {
		return "", nil
	}
	return strings.TrimSpace(value), nil
}

func (s *Service) pollLoop(ctx context.Context, getUpdatesBuf string, done chan struct{}) {
	defer func() {
		close(done)
		s.mu.Lock()
		s.started = false
		s.mu.Unlock()
	}()

	backoff := time.Second
	timeoutMs := defaultLongPollTimeout

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		resp, err := s.client.GetUpdates(ctx, GetUpdatesRequest{
			GetUpdatesBuf: getUpdatesBuf,
			BaseInfo:      defaultBaseInfo(),
			TimeoutMS:     timeoutMs,
		})
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			s.logf("channel event=failure platform=%s operation=polling errorCode=%s err=%q", platformID, "platform_unavailable", err.Error())
			_ = s.store.UpdateChannelState(context.Background(), s.connectorID(), domain.ChannelStateDegraded, "platform_unavailable", err.Error())
			time.Sleep(backoff)
			backoff = nextBackoff(backoff)
			continue
		}

		if resp.LongPollingTimeoutMS > 0 {
			timeoutMs = resp.LongPollingTimeoutMS
		}
		if resp.ErrCode != 0 || resp.Ret != 0 {
			code := "upstream_error"
			if resp.ErrCode == -14 || resp.Ret == -14 {
				code = "session_expired"
			}
			state := domain.ChannelStateDegraded
			if code == "session_expired" {
				state = domain.ChannelStateError
			}
			errMsg := strings.TrimSpace(resp.ErrMsg)
			if errMsg == "" {
				errMsg = fmt.Sprintf("weixin upstream error ret=%d errcode=%d", resp.Ret, resp.ErrCode)
			}
			s.logf("channel event=failure platform=%s operation=polling errorCode=%s err=%q", platformID, code, errMsg)
			_ = s.store.UpdateChannelState(context.Background(), s.connectorID(), state, code, errMsg)
			if state == domain.ChannelStateError {
				return
			}
			time.Sleep(backoff)
			backoff = nextBackoff(backoff)
			continue
		}

		backoff = time.Second
		_ = s.store.UpdateChannelState(ctx, s.connectorID(), domain.ChannelStateReady, "", "")
		if strings.TrimSpace(resp.GetUpdatesBuf) != "" && resp.GetUpdatesBuf != getUpdatesBuf {
			if err := s.store.UpdateChannelOffset(ctx, s.connectorID(), weixinOffsetKind, resp.GetUpdatesBuf); err == nil {
				getUpdatesBuf = resp.GetUpdatesBuf
			}
		}

		for _, message := range resp.Messages {
			if err := s.processMessage(ctx, message); err != nil {
				_ = s.store.UpdateChannelState(context.Background(), s.connectorID(), domain.ChannelStateDegraded, "update_processing_failed", err.Error())
				s.logf("channel event=failure platform=%s operation=update_processing errorCode=%s err=%q", platformID, "update_processing_failed", err.Error())
				time.Sleep(backoff)
				backoff = nextBackoff(backoff)
				break
			}
		}
	}
}

func (s *Service) processMessage(ctx context.Context, message WeixinMessage) error {
	if strings.TrimSpace(message.GroupID) != "" {
		s.logf("channel event=ignored platform=%s reason=group_chat_unsupported connector=%s", platformID, s.connectorID())
		return nil
	}
	if strings.TrimSpace(message.FromUserID) == "" {
		return nil
	}
	if strings.TrimSpace(message.FromUserID) != strings.TrimSpace(s.config.OwnerUserID) {
		s.logf(
			"channel event=ignored platform=%s reason=owner_mismatch connector=%s sender=%s owner=%s",
			platformID,
			s.connectorID(),
			message.FromUserID,
			s.config.OwnerUserID,
		)
		return nil
	}

	text := extractInboundText(message.ItemList)
	if strings.TrimSpace(text) == "" {
		s.logf("channel event=ignored platform=%s reason=non_text_unsupported connector=%s", platformID, s.connectorID())
		return nil
	}

	receivedAt := nowRFC3339()
	if err := s.store.TouchChannelInbound(ctx, s.connectorID(), receivedAt); err != nil {
		return err
	}

	key := domain.BindingKey{
		ConnectorID: s.connectorID(),
		Platform:    platformID,
		AccountID:   strings.TrimSpace(s.config.AccountID),
		ChatID:      strings.TrimSpace(message.FromUserID),
		ThreadID:    "",
	}
	binding, err := s.resolveOrCreateBinding(ctx, key)
	if err != nil {
		return err
	}
	if contextToken := strings.TrimSpace(message.ContextToken); contextToken != "" {
		if binding.ContextToken != contextToken {
			if err := s.bindings.UpdateBindingContextToken(ctx, binding.BindingID, contextToken); err != nil {
				return err
			}
			binding.ContextToken = contextToken
		}
	}

	inbound := domain.InboundMessage{
		ConnectorID: s.connectorID(),
		Platform:    platformID,
		AccountID:   strings.TrimSpace(s.config.AccountID),
		MessageID:   normalizeMessageID(message.MessageID),
		ChatID:      key.ChatID,
		ThreadID:    "",
		SenderID:    key.ChatID,
		Text:        text,
		Mentions:    []string{},
		Attachments: []domain.InboundAttachment{},
		ReceivedAt:  receivedAt,
		RawRef:      fmt.Sprintf("weixin:%s", normalizeMessageID(message.MessageID)),
	}

	result, err := s.orchestrator.HandleInbound(ctx, adapterkit.FromDomainInbound(inbound, key), bridgecore.HandleOptions{
		DefaultWorkDir: strings.TrimSpace(s.config.DefaultWorkDir),
	}, func(event bridgecore.TurnEvent) error {
		return nil
	})
	if err != nil {
		return err
	}
	if strings.TrimSpace(result.ReplyText) == "" {
		return nil
	}
	return s.sendReply(ctx, result.Binding, result.ReplyText)
}

func (s *Service) resolveOrCreateBinding(ctx context.Context, key domain.BindingKey) (*domain.SessionBinding, error) {
	binding, err := s.bindings.ResolveBinding(ctx, key)
	if err != nil {
		return nil, err
	}
	if binding != nil {
		if binding.WorkDir == "" {
			binding.WorkDir = strings.TrimSpace(s.config.DefaultWorkDir)
		}
		return binding, nil
	}
	return s.bindings.CreateBinding(ctx, key, uuid.NewString(), strings.TrimSpace(s.config.DefaultWorkDir), "auto")
}

func (s *Service) sendReply(ctx context.Context, binding domain.SessionBinding, text string) error {
	request := SendMessageRequest{
		Message: OutboundWeixinMessage{
			FromUserID:   "",
			ToUserID:     strings.TrimSpace(binding.Key.ChatID),
			ClientID:     uuid.NewString(),
			MessageType:  2,
			MessageState: 2,
			ItemList: []MessageItem{
				{
					Type:     1,
					TextItem: &TextItem{Text: text},
				},
			},
		},
		BaseInfo: defaultBaseInfo(),
	}
	if strings.TrimSpace(binding.ContextToken) != "" {
		request.Message.ContextToken = strings.TrimSpace(binding.ContextToken)
	}
	if err := s.client.SendMessage(ctx, request); err != nil {
		return err
	}
	return s.store.TouchChannelOutbound(ctx, s.connectorID(), nowRFC3339())
}

func (s *Service) failStart(ctx context.Context, code string, err error) error {
	_ = s.store.UpdateChannelState(ctx, s.connectorID(), domain.ChannelStateError, code, err.Error())
	return err
}

func (s *Service) failAfterStart(ctx context.Context, code string, err error) error {
	_ = s.store.UpdateChannelState(ctx, s.connectorID(), domain.ChannelStateError, code, err.Error())
	return s.abortStart(err)
}

func (s *Service) abortStart(err error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.done != nil {
		close(s.done)
	}
	s.done = closedDone()
	s.started = false
	return err
}

func (s *Service) connectorID() string {
	if value := strings.TrimSpace(s.config.ConnectorID); value != "" {
		return value
	}
	return platformID
}

func (s *Service) logf(format string, args ...any) {
	if s.logger != nil {
		s.logger.Printf(format, args...)
	}
}

type Client struct {
	baseURL    string
	botToken   string
	httpClient *http.Client
}

type BaseInfo struct {
	ChannelVersion string `json:"channel_version,omitempty"`
}

func NewClient(baseURL string, botToken string) *Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = "https://ilinkai.weixin.qq.com"
	}
	return &Client{
		baseURL:  baseURL,
		botToken: strings.TrimSpace(botToken),
		httpClient: &http.Client{
			Timeout: 45 * time.Second,
		},
	}
}

func (c *Client) GetUpdates(ctx context.Context, input GetUpdatesRequest) (GetUpdatesResponse, error) {
	var response GetUpdatesResponse
	err := c.postJSON(ctx, "ilink/bot/getupdates", input, &response)
	return response, err
}

func (c *Client) SendMessage(ctx context.Context, input SendMessageRequest) error {
	return c.postJSON(ctx, "ilink/bot/sendmessage", input, &map[string]any{})
}

func (c *Client) postJSON(ctx context.Context, path string, payload any, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal weixin request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/"+path, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build weixin request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("AuthorizationType", "ilink_bot_token")
	request.Header.Set("Authorization", "Bearer "+c.botToken)
	request.Header.Set("X-WECHAT-UIN", randomWechatUIN())
	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("request weixin api %s: %w", path, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("weixin api %s returned %s", path, response.Status)
	}
	if out == nil {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(out); err != nil {
		return fmt.Errorf("decode weixin api %s response: %w", path, err)
	}
	return nil
}

type GetUpdatesRequest struct {
	GetUpdatesBuf string   `json:"get_updates_buf"`
	BaseInfo      BaseInfo `json:"base_info"`
	TimeoutMS     int      `json:"-"`
}

type GetUpdatesResponse struct {
	Ret                  int             `json:"ret"`
	ErrCode              int             `json:"errcode"`
	ErrMsg               string          `json:"errmsg"`
	Messages             []WeixinMessage `json:"msgs"`
	GetUpdatesBuf        string          `json:"get_updates_buf"`
	LongPollingTimeoutMS int             `json:"longpolling_timeout_ms"`
}

type SendMessageRequest struct {
	Message  OutboundWeixinMessage `json:"msg"`
	BaseInfo BaseInfo              `json:"base_info"`
}

type OutboundWeixinMessage struct {
	FromUserID   string        `json:"from_user_id,omitempty"`
	ToUserID     string        `json:"to_user_id"`
	ClientID     string        `json:"client_id,omitempty"`
	MessageType  int           `json:"message_type,omitempty"`
	MessageState int           `json:"message_state,omitempty"`
	ContextToken string        `json:"context_token,omitempty"`
	ItemList     []MessageItem `json:"item_list"`
}

type WeixinMessage struct {
	MessageID    int64         `json:"message_id"`
	FromUserID   string        `json:"from_user_id"`
	GroupID      string        `json:"group_id"`
	ContextToken string        `json:"context_token"`
	ItemList     []MessageItem `json:"item_list"`
}

type MessageItem struct {
	Type     int       `json:"type"`
	TextItem *TextItem `json:"text_item,omitempty"`
}

type TextItem struct {
	Text string `json:"text"`
}

func extractInboundText(items []MessageItem) string {
	for _, item := range items {
		if item.Type == 1 && item.TextItem != nil {
			return strings.TrimSpace(item.TextItem.Text)
		}
	}
	return ""
}

func normalizeMessageID(messageID int64) string {
	if messageID == 0 {
		return uuid.NewString()
	}
	return strconv.FormatInt(messageID, 10)
}

func randomWechatUIN() string {
	value := rand.Uint32()
	return base64.StdEncoding.EncodeToString([]byte(strconv.FormatUint(uint64(value), 10)))
}

func defaultBaseInfo() BaseInfo {
	return BaseInfo{ChannelVersion: defaultChannelVersion}
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func closedDone() chan struct{} {
	ch := make(chan struct{})
	close(ch)
	return ch
}

func nextBackoff(current time.Duration) time.Duration {
	switch {
	case current < time.Second:
		return time.Second
	case current < 2*time.Second:
		return 2 * time.Second
	default:
		return 5 * time.Second
	}
}
