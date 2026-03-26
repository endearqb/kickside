package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const bridgeSkillsAuthFileName = "bridge_skill_auth.json"

type bridgeSkillsAuthPayload struct {
	AdminBaseURL     string `json:"admin_base_url"`
	AdminToken       string `json:"admin_token"`
	HostControlURL   string `json:"host_control_url,omitempty"`
	HostControlToken string `json:"host_control_token,omitempty"`
	GeneratedAt      string `json:"generated_at"`
}

func writeBridgeSkillsAuthFile(options Options) (string, error) {
	dir := filepath.Dir(strings.TrimSpace(options.DBPath))
	if strings.TrimSpace(dir) == "" {
		return "", fmt.Errorf("bridge db path is required to write skill auth file")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create bridge auth file directory: %w", err)
	}

	path := filepath.Join(dir, bridgeSkillsAuthFileName)
	payload := bridgeSkillsAuthPayload{
		AdminBaseURL:     fmt.Sprintf("http://127.0.0.1:%d", options.AdminPort),
		AdminToken:       strings.TrimSpace(options.AdminToken),
		HostControlURL:   strings.TrimSpace(options.HostControlURL),
		HostControlToken: strings.TrimSpace(options.HostControlToken),
		GeneratedAt:      time.Now().UTC().Format(time.RFC3339),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal bridge skill auth payload: %w", err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return "", fmt.Errorf("write bridge skill auth file: %w", err)
	}
	return path, nil
}

func cleanupBridgeSkillsAuthFile(path string) {
	path = strings.TrimSpace(path)
	if path == "" {
		return
	}
	_ = os.Remove(path)
}
