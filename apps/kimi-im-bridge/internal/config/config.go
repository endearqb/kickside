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
	PlatformTelegram = "telegram"
	PlatformFeishu   = "feishu"

	DefaultTelegramConnectorID = "telegram-default"
	DefaultFeishuConnectorID   = "feishu-default"

	FeishuReplyRendererPost        = "post"
	FeishuReplyRendererInteractive = "interactive"
)

type BridgeSettings struct {
	Enabled        bool              `json:"enabled"`
	AdminPort      int               `json:"adminPort"`
	AutoStart      bool              `json:"autoStart"`
	Connectors     []ConnectorConfig `json:"connectors"`
	DefaultWorkDir string            `json:"defaultWorkDir,omitempty"`
	WorkDirPresets []WorkDirPreset   `json:"workDirPresets"`
	LogLevel       string            `json:"logLevel"`

	Channels            []ConnectorConfig `json:"-"`
	FeishuAutoApprove   bool              `json:"-"`
	FeishuReplyRenderer string            `json:"-"`
}

type ConnectorConfig struct {
	ID                  string `json:"id"`
	Platform            string `json:"platform"`
	Label               string `json:"label"`
	Enabled             bool   `json:"enabled"`
	Mode                string `json:"mode"`
	FeishuAutoApprove   bool   `json:"feishuAutoApprove,omitempty"`
	FeishuReplyRenderer string `json:"feishuReplyRenderer,omitempty"`
}

type ChannelConfig = ConnectorConfig

type WorkDirPreset struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type BridgeSecrets struct {
	Connectors map[string]ConnectorSecrets `json:"connectors,omitempty"`

	Telegram *TelegramSecrets `json:"-"`
	Feishu   *FeishuSecrets   `json:"-"`
}

type ConnectorSecrets struct {
	Telegram *TelegramSecrets `json:"telegram,omitempty"`
	Feishu   *FeishuSecrets   `json:"feishu,omitempty"`
}

type TelegramSecrets struct {
	BotToken string `json:"botToken"`
}

type FeishuSecrets struct {
	AppID             string `json:"appId"`
	AppSecret         string `json:"appSecret"`
	VerificationToken string `json:"verificationToken"`
	EncryptKey        string `json:"encryptKey"`
}

type legacySettingsFile struct {
	Enabled             bool                  `json:"enabled"`
	AdminPort           int                   `json:"adminPort"`
	AutoStart           bool                  `json:"autoStart"`
	Connectors          []ConnectorConfig     `json:"connectors"`
	Channels            []legacyChannelConfig `json:"channels"`
	DefaultWorkDir      string                `json:"defaultWorkDir,omitempty"`
	WorkDirPresets      []WorkDirPreset       `json:"workDirPresets"`
	FeishuAutoApprove   *bool                 `json:"feishuAutoApprove,omitempty"`
	FeishuReplyRenderer string                `json:"feishuReplyRenderer,omitempty"`
	FeishuReplyCards    *bool                 `json:"feishuReplyCards,omitempty"`
	LogLevel            string                `json:"logLevel"`
}

type legacyChannelConfig struct {
	Platform     string `json:"platform"`
	Enabled      bool   `json:"enabled"`
	AccountLabel string `json:"accountLabel"`
	Mode         string `json:"mode"`
}

type legacySecretsFile struct {
	Connectors map[string]ConnectorSecrets `json:"connectors"`
	Telegram   *TelegramSecrets            `json:"telegram,omitempty"`
	Feishu     *FeishuSecrets              `json:"feishu,omitempty"`
}

func DefaultSettings() BridgeSettings {
	return populateLegacyView(BridgeSettings{
		Enabled:        false,
		AdminPort:      DefaultAdminPort,
		AutoStart:      false,
		Connectors:     []ConnectorConfig{},
		WorkDirPresets: []WorkDirPreset{},
		LogLevel:       "info",
	})
}

func DefaultSecrets() BridgeSecrets {
	return populateLegacySecretsView(BridgeSecrets{
		Connectors: map[string]ConnectorSecrets{},
	})
}

func LoadOrCreateSettings(path string) (BridgeSettings, error) {
	defaults := DefaultSettings()
	var payload legacySettingsFile
	if err := loadOrCreateJSON(path, &payload, legacySettingsFile{
		Enabled:        defaults.Enabled,
		AdminPort:      defaults.AdminPort,
		AutoStart:      defaults.AutoStart,
		Connectors:     defaults.Connectors,
		DefaultWorkDir: defaults.DefaultWorkDir,
		WorkDirPresets: defaults.WorkDirPresets,
		LogLevel:       defaults.LogLevel,
	}); err != nil {
		return BridgeSettings{}, err
	}
	return normalizeSettings(payload)
}

func LoadOrCreateSecrets(path string) (BridgeSecrets, error) {
	defaults := DefaultSecrets()
	var payload legacySecretsFile
	if err := loadOrCreateJSON(path, &payload, legacySecretsFile{
		Connectors: defaults.Connectors,
	}); err != nil {
		return BridgeSecrets{}, err
	}
	return normalizeSecrets(payload), nil
}

func ReconcileSettingsWithSecrets(
	settings BridgeSettings,
	secrets BridgeSecrets,
) BridgeSettings {
	if len(secrets.Connectors) == 0 {
		return settings
	}

	connectors := append([]ConnectorConfig(nil), settings.Connectors...)
	seenIDs := make(map[string]struct{}, len(connectors))
	for _, connector := range connectors {
		if strings.TrimSpace(connector.ID) == "" {
			continue
		}
		seenIDs[strings.TrimSpace(connector.ID)] = struct{}{}
	}

	for connectorID, connectorSecrets := range secrets.Connectors {
		connectorID = strings.TrimSpace(connectorID)
		if connectorID == "" {
			continue
		}
		if _, exists := seenIDs[connectorID]; exists {
			continue
		}

		platform := platformForConnectorSecrets(connectorID, connectorSecrets)
		if platform == "" {
			continue
		}
		connectors = append(connectors, ConnectorConfig{
			ID:                  connectorID,
			Platform:            platform,
			Label:               defaultConnectorLabel(platform),
			Enabled:             false,
			Mode:                defaultConnectorMode(platform),
			FeishuAutoApprove:   defaultFeishuAutoApprove(),
			FeishuReplyRenderer: defaultFeishuReplyRenderer(),
		})
		seenIDs[connectorID] = struct{}{}
	}

	settings.Connectors = normalizeConnectors(connectors)
	return populateLegacyView(settings)
}

func normalizeSettings(payload legacySettingsFile) (BridgeSettings, error) {
	defaults := DefaultSettings()

	connectors := payload.Connectors
	if len(connectors) == 0 {
		connectors = migrateLegacyChannels(payload.Channels, payload.FeishuAutoApprove, payload.FeishuReplyRenderer, payload.FeishuReplyCards)
	}

	settings := BridgeSettings{
		Enabled:        payload.Enabled,
		AdminPort:      payload.AdminPort,
		AutoStart:      payload.AutoStart,
		Connectors:     normalizeConnectors(connectors),
		DefaultWorkDir: strings.TrimSpace(payload.DefaultWorkDir),
		WorkDirPresets: normalizeWorkDirPresets(payload.WorkDirPresets),
		LogLevel:       strings.TrimSpace(payload.LogLevel),
	}
	if settings.AdminPort == 0 {
		settings.AdminPort = defaults.AdminPort
	}
	if settings.LogLevel == "" {
		settings.LogLevel = defaults.LogLevel
	}
	if settings.AdminPort <= 0 || settings.AdminPort > 65535 {
		return BridgeSettings{}, fmt.Errorf("adminPort must be between 1 and 65535")
	}
	return populateLegacyView(settings), nil
}

func normalizeSecrets(payload legacySecretsFile) BridgeSecrets {
	connectors := map[string]ConnectorSecrets{}
	for connectorID, connectorSecrets := range payload.Connectors {
		normalized := normalizeConnectorSecrets(connectorSecrets)
		if !hasConnectorSecrets(normalized) {
			continue
		}
		connectors[strings.TrimSpace(connectorID)] = normalized
	}

	if payload.Telegram != nil && strings.TrimSpace(payload.Telegram.BotToken) != "" {
		connectors[DefaultTelegramConnectorID] = normalizeConnectorSecrets(ConnectorSecrets{
			Telegram: payload.Telegram,
		})
	}
	if payload.Feishu != nil &&
		(strings.TrimSpace(payload.Feishu.AppID) != "" ||
			strings.TrimSpace(payload.Feishu.AppSecret) != "" ||
			strings.TrimSpace(payload.Feishu.VerificationToken) != "" ||
			strings.TrimSpace(payload.Feishu.EncryptKey) != "") {
		connectors[DefaultFeishuConnectorID] = normalizeConnectorSecrets(ConnectorSecrets{
			Feishu: payload.Feishu,
		})
	}

	if len(connectors) == 0 {
		return DefaultSecrets()
	}
	return populateLegacySecretsView(BridgeSecrets{Connectors: connectors})
}

func normalizeConnectors(connectors []ConnectorConfig) []ConnectorConfig {
	if len(connectors) == 0 {
		return []ConnectorConfig{}
	}

	normalized := make([]ConnectorConfig, 0, len(connectors))
	seenIDs := map[string]struct{}{}
	seenLabels := map[string]int{}
	perPlatformCounts := map[string]int{}
	for _, connector := range connectors {
		platform := normalizePlatform(connector.Platform)
		if platform == "" {
			continue
		}
		perPlatformCounts[platform]++

		connectorID := strings.TrimSpace(connector.ID)
		if connectorID == "" {
			connectorID = generateConnectorID(platform, perPlatformCounts[platform])
		}
		if _, exists := seenIDs[connectorID]; exists {
			connectorID = generateConnectorID(platform, perPlatformCounts[platform])
		}
		seenIDs[connectorID] = struct{}{}

		label := strings.TrimSpace(connector.Label)
		if label == "" {
			label = defaultConnectorLabel(platform)
		}
		labelKey := strings.ToLower(label)
		seenLabels[labelKey]++
		if seenLabels[labelKey] > 1 {
			label = fmt.Sprintf("%s %d", label, seenLabels[labelKey])
		}

		item := ConnectorConfig{
			ID:                  connectorID,
			Platform:            platform,
			Label:               label,
			Enabled:             connector.Enabled,
			Mode:                normalizeConnectorMode(platform, connector.Mode),
			FeishuAutoApprove:   connector.FeishuAutoApprove,
			FeishuReplyRenderer: normalizeFeishuReplyRenderer(connector.FeishuReplyRenderer, nil),
		}
		if platform == PlatformFeishu {
			if connector.FeishuReplyRenderer == "" {
				item.FeishuReplyRenderer = defaultFeishuReplyRenderer()
			}
			if !connector.FeishuAutoApprove {
				item.FeishuAutoApprove = connector.FeishuAutoApprove
			}
		} else {
			item.FeishuReplyRenderer = ""
			item.FeishuAutoApprove = false
		}
		if platform == PlatformFeishu && connector.FeishuReplyRenderer == "" && !connector.FeishuAutoApprove {
			item.FeishuAutoApprove = defaultFeishuAutoApprove()
		}
		normalized = append(normalized, item)
	}
	return normalized
}

func normalizeConnectorSecrets(value ConnectorSecrets) ConnectorSecrets {
	normalized := ConnectorSecrets{}
	if value.Telegram != nil {
		token := strings.TrimSpace(value.Telegram.BotToken)
		if token != "" {
			normalized.Telegram = &TelegramSecrets{BotToken: token}
		}
	}
	if value.Feishu != nil {
		secret := FeishuSecrets{
			AppID:             strings.TrimSpace(value.Feishu.AppID),
			AppSecret:         strings.TrimSpace(value.Feishu.AppSecret),
			VerificationToken: strings.TrimSpace(value.Feishu.VerificationToken),
			EncryptKey:        strings.TrimSpace(value.Feishu.EncryptKey),
		}
		if secret.AppID != "" || secret.AppSecret != "" || secret.VerificationToken != "" || secret.EncryptKey != "" {
			normalized.Feishu = &secret
		}
	}
	return normalized
}

func hasConnectorSecrets(value ConnectorSecrets) bool {
	return value.Telegram != nil || value.Feishu != nil
}

func migrateLegacyChannels(
	channels []legacyChannelConfig,
	legacyFeishuAutoApprove *bool,
	legacyFeishuReplyRenderer string,
	legacyFeishuReplyCards *bool,
) []ConnectorConfig {
	connectors := make([]ConnectorConfig, 0, len(channels))
	for _, channel := range channels {
		platform := normalizePlatform(channel.Platform)
		if platform == "" || !legacyChannelShouldMigrate(channel, platform) {
			continue
		}
		connector := ConnectorConfig{
			ID:       defaultConnectorID(platform),
			Platform: platform,
			Label:    strings.TrimSpace(channel.AccountLabel),
			Enabled:  channel.Enabled,
			Mode:     normalizeConnectorMode(platform, channel.Mode),
		}
		if connector.Label == "" {
			connector.Label = defaultConnectorLabel(platform)
		}
		if platform == PlatformFeishu {
			connector.FeishuAutoApprove = defaultFeishuAutoApprove()
			if legacyFeishuAutoApprove != nil {
				connector.FeishuAutoApprove = *legacyFeishuAutoApprove
			}
			connector.FeishuReplyRenderer = normalizeFeishuReplyRenderer(legacyFeishuReplyRenderer, legacyFeishuReplyCards)
		}
		connectors = append(connectors, connector)
	}
	return connectors
}

func legacyChannelShouldMigrate(channel legacyChannelConfig, platform string) bool {
	if channel.Enabled {
		return true
	}
	label := strings.TrimSpace(channel.AccountLabel)
	if label != "" && label != defaultLegacyAccountLabel(platform) {
		return true
	}
	mode := strings.TrimSpace(channel.Mode)
	return mode != "" && mode != defaultConnectorMode(platform)
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

func normalizePlatform(platform string) string {
	switch strings.TrimSpace(strings.ToLower(platform)) {
	case PlatformTelegram:
		return PlatformTelegram
	case PlatformFeishu:
		return PlatformFeishu
	default:
		return ""
	}
}

func normalizeConnectorMode(platform string, mode string) string {
	normalized := strings.TrimSpace(strings.ToLower(mode))
	if normalized != "" {
		return normalized
	}
	return defaultConnectorMode(platform)
}

func defaultConnectorMode(platform string) string {
	switch platform {
	case PlatformFeishu:
		return "websocket"
	case PlatformTelegram:
		return "polling"
	default:
		return "polling"
	}
}

func defaultConnectorID(platform string) string {
	switch platform {
	case PlatformFeishu:
		return DefaultFeishuConnectorID
	case PlatformTelegram:
		return DefaultTelegramConnectorID
	default:
		return fmt.Sprintf("%s-default", platform)
	}
}

func generateConnectorID(platform string, index int) string {
	if index <= 1 {
		return defaultConnectorID(platform)
	}
	return fmt.Sprintf("%s-%d", platform, index)
}

func defaultConnectorLabel(platform string) string {
	switch platform {
	case PlatformFeishu:
		return "Feishu"
	case PlatformTelegram:
		return "Telegram"
	default:
		return strings.Title(platform)
	}
}

func defaultLegacyAccountLabel(platform string) string {
	return defaultConnectorLabel(platform)
}

func defaultFeishuAutoApprove() bool {
	return true
}

func defaultFeishuReplyRenderer() string {
	return FeishuReplyRendererInteractive
}

func platformForConnectorSecrets(connectorID string, value ConnectorSecrets) string {
	if value.Feishu != nil {
		return PlatformFeishu
	}
	if value.Telegram != nil {
		return PlatformTelegram
	}
	switch strings.TrimSpace(connectorID) {
	case DefaultFeishuConnectorID:
		return PlatformFeishu
	case DefaultTelegramConnectorID:
		return PlatformTelegram
	default:
		return ""
	}
}

func populateLegacyView(settings BridgeSettings) BridgeSettings {
	settings.Channels = append([]ConnectorConfig(nil), settings.Connectors...)
	settings.FeishuAutoApprove = defaultFeishuAutoApprove()
	settings.FeishuReplyRenderer = defaultFeishuReplyRenderer()
	for _, connector := range settings.Connectors {
		if connector.Platform != PlatformFeishu {
			continue
		}
		settings.FeishuAutoApprove = connector.FeishuAutoApprove
		settings.FeishuReplyRenderer = connector.FeishuReplyRenderer
		break
	}
	return settings
}

func populateLegacySecretsView(secrets BridgeSecrets) BridgeSecrets {
	if secrets.Connectors == nil {
		secrets.Connectors = map[string]ConnectorSecrets{}
	}
	for connectorID, connector := range secrets.Connectors {
		switch platformForConnectorSecrets(connectorID, connector) {
		case PlatformTelegram:
			if secrets.Telegram == nil && connector.Telegram != nil {
				copy := *connector.Telegram
				secrets.Telegram = &copy
			}
		case PlatformFeishu:
			if secrets.Feishu == nil && connector.Feishu != nil {
				copy := *connector.Feishu
				secrets.Feishu = &copy
			}
		}
	}
	return secrets
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
