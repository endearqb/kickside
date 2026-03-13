package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const defaultBaseURL = "https://api.telegram.org"

type APIError struct {
	Method      string
	ErrorCode   int
	Description string
}

func (e *APIError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("telegram %s failed (%d): %s", e.Method, e.ErrorCode, e.Description)
}

func (e *APIError) IsInvalidToken() bool {
	return e != nil && e.ErrorCode == http.StatusUnauthorized
}

func (e *APIError) IsParseModeError() bool {
	if e == nil {
		return false
	}
	description := strings.ToLower(e.Description)
	return e.ErrorCode == http.StatusBadRequest && (strings.Contains(description, "parse entities") || strings.Contains(description, "can't parse"))
}

type Client struct {
	baseURL    string
	httpClient *http.Client
}

type ClientOptions struct {
	BaseURL    string
	HTTPClient *http.Client
}

func NewClient(botToken string, options ClientOptions) *Client {
	baseURL := strings.TrimSpace(options.BaseURL)
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	baseURL = strings.TrimRight(baseURL, "/") + "/bot" + strings.TrimSpace(botToken)

	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 35 * time.Second}
	}

	return &Client{
		baseURL:    baseURL,
		httpClient: httpClient,
	}
}

func (c *Client) GetMe(ctx context.Context) (*getMeResponse, error) {
	var result getMeResponse
	if err := c.call(ctx, "getMe", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *Client) GetWebhookInfo(ctx context.Context) (*webhookInfo, error) {
	var result webhookInfo
	if err := c.call(ctx, "getWebhookInfo", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *Client) GetUpdates(ctx context.Context, request getUpdatesRequest) ([]update, error) {
	var result []update
	if err := c.call(ctx, "getUpdates", request, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func (c *Client) SendMessage(ctx context.Context, request sendMessageRequest) (*message, error) {
	var result message
	if err := c.call(ctx, "sendMessage", request, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *Client) EditMessageText(ctx context.Context, request editMessageTextRequest) error {
	var result message
	return c.call(ctx, "editMessageText", request, &result)
}

func (c *Client) AnswerCallbackQuery(ctx context.Context, request answerCallbackQueryRequest) error {
	var result bool
	return c.call(ctx, "answerCallbackQuery", request, &result)
}

func (c *Client) call(ctx context.Context, method string, requestBody any, target any) error {
	var body []byte
	var err error
	if requestBody != nil {
		body, err = json.Marshal(requestBody)
		if err != nil {
			return fmt.Errorf("marshal telegram %s request: %w", method, err)
		}
	} else {
		body = []byte("{}")
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/"+method, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create telegram %s request: %w", method, err)
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("telegram %s request failed: %w", method, err)
	}
	defer response.Body.Close()

	var envelope apiResponse[json.RawMessage]
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		return fmt.Errorf("decode telegram %s response: %w", method, err)
	}
	if !envelope.OK {
		return &APIError{
			Method:      method,
			ErrorCode:   envelope.ErrorCode,
			Description: envelope.Description,
		}
	}
	if target == nil {
		return nil
	}
	if len(envelope.Result) == 0 || string(envelope.Result) == "null" {
		return nil
	}
	if err := json.Unmarshal(envelope.Result, target); err != nil {
		return fmt.Errorf("decode telegram %s result: %w", method, err)
	}
	return nil
}
