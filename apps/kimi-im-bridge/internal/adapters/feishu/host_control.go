package feishu

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const bridgeHostTokenHeader = "X-Bridge-Host-Token"

type bridgeHostControlClient struct {
	baseURL string
	token   string
	client  *http.Client
}

func NewHostControlClient(baseURL string, token string) HostController {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	token = strings.TrimSpace(token)
	if baseURL == "" || token == "" {
		return nil
	}
	return &bridgeHostControlClient{
		baseURL: baseURL,
		token:   token,
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (c *bridgeHostControlClient) RequestRestart(ctx context.Context) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/bridge/restart", nil)
	if err != nil {
		return fmt.Errorf("build restart request: %w", err)
	}
	request.Header.Set(bridgeHostTokenHeader, c.token)

	response, err := c.client.Do(request)
	if err != nil {
		return fmt.Errorf("request bridge restart: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusAccepted && response.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected bridge restart response: %s", response.Status)
	}
	return nil
}
