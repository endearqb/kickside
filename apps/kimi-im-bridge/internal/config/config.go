package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const DefaultAdminPort = 60110

const (
	FeishuReplyRendererPost        = "post"
	FeishuReplyRendererInteractive = "interactive"
)

type BridgeSettings struct {
	Enabled              bool            `json:"enabled"`
	AdminPort            int             `json:"adminPort"`
	AutoStart            bool            `json:"autoStart"`
	Channels             []ChannelConfig `json:"channels"`
	DefaultWorkDir       string          `json:"defaultWorkDir,omitempty"`
	WorkDirPresets       []WorkDirPreset `json:"workDirPresets"`
	FeishuReplyRenderer  string          `json:"feishuReplyRenderer,omitempty"`
	FeishuReplyCards     *bool           `json:"feishuReplyCards,omitempty"`
	LogLevel             string          `json:"logLevel"`
}

type WorkDirPreset struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type ChannelConfig struct {
	Platform     string `json:"platform"`
	Enabled      bool   `json:"enabled"`
	AccountLabel string `json:"accountLabel"`
	Mode         string `json:"mode"`
}

type BridgeSecrets struct {
	Telegram *TelegramSecrets `json:"telegram,omitempty"`
	Feishu   *FeishuSecrets   `json:"feishu,omitempty"`
}

type TelegramSecrets struct {
	BotToken string `json:"botToken"`
}

type FeishuSecrets struct {
	AppID     string `json:"appId"`
	AppSecret string `json:"appSecret"`
}

func DefaultSettings() BridgeSettings {
	return BridgeSettings{
		Enabled:   false,
		AdminPort: DefaultAdminPort,
		AutoStart: false,
		Channels: []ChannelConfig{
			{
				Platform:     "telegram",
				Enabled:      false,
				AccountLabel: "Telegram",
				Mode:         "polling",
			},
			{
				Platform:     "feishu",
				Enabled:      false,
				AccountLabel: "Feishu",
				Mode:         "websocket",
			},
		},
		WorkDirPresets:      []WorkDirPreset{},
		FeishuReplyRenderer: FeishuReplyRendererInteractive,
		LogLevel:            "info",
	}
}

func DefaultSecrets() BridgeSecrets {
	return BridgeSecrets{}
}

func LoadOrCreateSettings(path string) (BridgeSettings, error) {
	settings := DefaultSettings()
	if err := loadOrCreateJSON(path, &settings, DefaultSettings()); err != nil {
		return BridgeSettings{}, err
	}
	return normalizeSettings(settings)
}

func LoadOrCreateSecrets(path string) (BridgeSecrets, error) {
	secrets := DefaultSecrets()
	if err := loadOrCreateJSON(path, &secrets, DefaultSecrets()); err != nil {
		return BridgeSecrets{}, err
	}
	return secrets, nil
}

func normalizeSettings(settings BridgeSettings) (BridgeSettings, error) {
	defaults := DefaultSettings()
	if settings.AdminPort == 0 {
		settings.AdminPort = defaults.AdminPort
	}
	if settings.LogLevel == "" {
		settings.LogLevel = defaults.LogLevel
	}
	settings.FeishuReplyRenderer = normalizeFeishuReplyRenderer(settings.FeishuReplyRenderer, settings.FeishuReplyCards)
	settings.FeishuReplyCards = nil
	settings.WorkDirPresets = normalizeWorkDirPresets(settings.WorkDirPresets)
	if len(settings.Channels) == 0 {
		settings.Channels = defaults.Channels
	}

	seen := map[string]bool{}
	normalized := make([]ChannelConfig, 0, len(defaults.Channels))
	for _, candidate := range defaults.Channels {
		var current ChannelConfig
		found := false
		for _, channel := range settings.Channels {
			if channel.Platform == candidate.Platform {
				current = channel
				found = true
				break
			}
		}
		if !found {
			current = candidate
		}
		if current.Mode == "" {
			current.Mode = candidate.Mode
		}
		if current.AccountLabel == "" {
			current.AccountLabel = candidate.AccountLabel
		}
		seen[current.Platform] = true
		normalized = append(normalized, current)
	}

	for _, channel := range settings.Channels {
		if channel.Platform == "" || seen[channel.Platform] {
			continue
		}
		normalized = append(normalized, channel)
	}

	settings.Channels = normalized
	if settings.AdminPort <= 0 || settings.AdminPort > 65535 {
		return BridgeSettings{}, fmt.Errorf("adminPort must be between 1 and 65535")
	}
	return settings, nil
}

func normalizeFeishuReplyRenderer(renderer string, legacy *bool) string {
	switch strings.TrimSpace(strings.ToLower(renderer)) {
	case FeishuReplyRendererPost:
		return FeishuReplyRendererPost
	case FeishuReplyRendererInteractive:
		return FeishuReplyRendererInteractive
	}
	if legacy != nil {
		if *legacy {
			return FeishuReplyRendererInteractive
		}
		return FeishuReplyRendererPost
	}
	return FeishuReplyRendererInteractive
}

func normalizeWorkDirPresets(presets []WorkDirPreset) []WorkDirPreset {
	if len(presets) == 0 {
		return []WorkDirPreset{}
	}

	normalized := make([]WorkDirPreset, 0, len(presets))
	seenPaths := map[string]struct{}{}
	for _, preset := range presets {
		name := strings.TrimSpace(preset.Name)
		path := strings.TrimSpace(preset.Path)
		if name == "" || path == "" {
			continue
		}
		if _, exists := seenPaths[path]; exists {
			continue
		}
		seenPaths[path] = struct{}{}
		normalized = append(normalized, WorkDirPreset{
			Name: name,
			Path: path,
		})
	}
	return normalized
}

func loadOrCreateJSON[T any](path string, target *T, defaults T) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("failed to create parent directory for %s: %w", path, err)
	}
	if _, err := os.Stat(path); err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("failed to stat %s: %w", path, err)
		}
		raw, marshalErr := json.MarshalIndent(defaults, "", "  ")
		if marshalErr != nil {
			return fmt.Errorf("failed to serialize default config: %w", marshalErr)
		}
		if writeErr := os.WriteFile(path, raw, 0o600); writeErr != nil {
			return fmt.Errorf("failed to write default file %s: %w", path, writeErr)
		}
		*target = defaults
		return nil
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("failed to read %s: %w", path, err)
	}
	if len(raw) == 0 {
		raw, err = json.MarshalIndent(defaults, "", "  ")
		if err != nil {
			return fmt.Errorf("failed to serialize defaults for %s: %w", path, err)
		}
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			return fmt.Errorf("failed to rewrite empty file %s: %w", path, err)
		}
		*target = defaults
		return nil
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return fmt.Errorf("failed to decode %s: %w", path, err)
	}
	return nil
}
