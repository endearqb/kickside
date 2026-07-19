package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadOrCreateSettingsPreservesConnectorWorkDirContract(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "bridge_settings.json")
	raw := []byte(`{"enabled":true,"adminPort":60110,"defaultWorkDir":"D:/global","connectors":[{"id":"telegram-one","platform":"telegram","label":"Telegram","enabled":true,"mode":"polling","defaultWorkDir":" D:/telegram ","resetBindingSessionOnStart":true},{"id":"feishu-one","platform":"feishu","label":"Feishu 1","enabled":true,"mode":"websocket","defaultWorkDir":"D:/feishu-1","resetBindingSessionOnStart":false},{"id":"feishu-two","platform":"feishu","label":"Feishu 2","enabled":true,"mode":"websocket","defaultWorkDir":"D:/feishu-2"},{"id":"weixin-one","platform":"weixin","label":"Weixin","enabled":true,"mode":"polling","defaultWorkDir":"D:/weixin"}]}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("seed settings: %v", err)
	}

	settings, err := LoadOrCreateSettings(path)
	if err != nil {
		t.Fatalf("LoadOrCreateSettings returned error: %v", err)
	}
	wantWorkDirs := []string{"D:/telegram", "D:/feishu-1", "D:/feishu-2", "D:/weixin"}
	if len(settings.Connectors) != len(wantWorkDirs) {
		t.Fatalf("expected four connectors, got %d", len(settings.Connectors))
	}
	for index, want := range wantWorkDirs {
		if got := settings.Connectors[index].DefaultWorkDir; got != want {
			t.Fatalf("connector %d workdir: got %q, want %q", index, got, want)
		}
	}
	if settings.Connectors[0].ResetBindingSessionOnStart == nil || !*settings.Connectors[0].ResetBindingSessionOnStart {
		t.Fatal("expected explicit resetBindingSessionOnStart=true to survive normalization")
	}
	if settings.Connectors[1].ResetBindingSessionOnStart == nil || *settings.Connectors[1].ResetBindingSessionOnStart {
		t.Fatal("expected explicit resetBindingSessionOnStart=false to survive normalization")
	}
	if settings.Connectors[2].ResetBindingSessionOnStart != nil {
		t.Fatal("expected omitted resetBindingSessionOnStart to remain omitted")
	}

	encoded, err := json.Marshal(settings.Connectors[0])
	if err != nil {
		t.Fatalf("marshal connector: %v", err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatalf("decode connector fields: %v", err)
	}
	if _, ok := fields["defaultWorkDir"]; !ok {
		t.Fatal("missing Rust-compatible defaultWorkDir JSON field")
	}
	if _, ok := fields["resetBindingSessionOnStart"]; !ok {
		t.Fatal("missing Rust-compatible resetBindingSessionOnStart JSON field")
	}
	var roundTripped ConnectorConfig
	if err := json.Unmarshal(encoded, &roundTripped); err != nil {
		t.Fatalf("round-trip connector: %v", err)
	}
	if roundTripped.DefaultWorkDir != "D:/telegram" || roundTripped.ResetBindingSessionOnStart == nil || !*roundTripped.ResetBindingSessionOnStart {
		t.Fatalf("connector fields changed during round-trip: %+v", roundTripped)
	}
}

func TestLoadOrCreateSettingsKeepsLegacyGlobalWorkDir(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "bridge_settings.json")
	raw := []byte(`{"enabled":true,"adminPort":60110,"defaultWorkDir":" D:/legacy ","channels":[{"platform":"telegram","enabled":true}]}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("seed legacy settings: %v", err)
	}

	settings, err := LoadOrCreateSettings(path)
	if err != nil {
		t.Fatalf("LoadOrCreateSettings returned error: %v", err)
	}
	if settings.DefaultWorkDir != "D:/legacy" || len(settings.Connectors) != 1 || settings.Connectors[0].DefaultWorkDir != "" {
		t.Fatalf("unexpected legacy settings normalization: %+v", settings)
	}
}

func TestLoadOrCreateSettingsWritesDefaults(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "bridge_settings.json")

	settings, err := LoadOrCreateSettings(path)
	if err != nil {
		t.Fatalf("LoadOrCreateSettings returned error: %v", err)
	}

	if !fileExists(path) {
		t.Fatalf("expected settings file to be created")
	}
	if settings.AdminPort != DefaultAdminPort {
		t.Fatalf("expected admin port %d, got %d", DefaultAdminPort, settings.AdminPort)
	}
	if settings.FeishuReplyRenderer != FeishuReplyRendererStreaming {
		t.Fatalf("expected feishuReplyRenderer to default streaming, got %q", settings.FeishuReplyRenderer)
	}
	if settings.FeishuAutoApprove {
		t.Fatalf("expected feishuAutoApprove to default false")
	}
	if len(settings.WorkDirPresets) != 0 {
		t.Fatalf("expected workDirPresets to default empty, got %d", len(settings.WorkDirPresets))
	}
	if len(settings.Connectors) != 0 {
		t.Fatalf("expected no default connectors, got %d", len(settings.Connectors))
	}
}

func TestLoadOrCreateSettingsNormalizesMissingChannelDefaults(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "bridge_settings.json")
	raw := []byte(`{"enabled":true,"adminPort":60110,"autoStart":false,"channels":[{"platform":"telegram","enabled":true}]}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("failed to seed settings file: %v", err)
	}

	settings, err := LoadOrCreateSettings(path)
	if err != nil {
		t.Fatalf("LoadOrCreateSettings returned error: %v", err)
	}

	if len(settings.Connectors) != 1 {
		t.Fatalf("expected normalized connectors length 1, got %d", len(settings.Connectors))
	}
	if settings.Connectors[0].Mode == "" {
		t.Fatalf("expected telegram mode to be filled from defaults")
	}
	if settings.Connectors[0].Platform != "telegram" {
		t.Fatalf("expected telegram connector to be preserved, got %+v", settings.Connectors[0])
	}
}

func TestLoadOrCreateSettingsNormalizesLegacyFeishuReplyCardsFlag(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "bridge_settings.json")
	raw := []byte(`{"enabled":true,"adminPort":60110,"autoStart":false,"feishuReplyCards":true,"channels":[{"platform":"telegram","enabled":true}]}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("failed to seed settings file: %v", err)
	}

	settings, err := LoadOrCreateSettings(path)
	if err != nil {
		t.Fatalf("LoadOrCreateSettings returned error: %v", err)
	}

	if settings.FeishuReplyRenderer != FeishuReplyRendererInteractive {
		t.Fatalf("expected legacy feishuReplyCards=true to map to interactive, got %q", settings.FeishuReplyRenderer)
	}
}

func TestLoadOrCreateSettingsPreservesFeishuReplyRenderer(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "bridge_settings.json")
	raw := []byte(`{"enabled":true,"adminPort":60110,"autoStart":false,"feishuReplyRenderer":"post","channels":[{"platform":"feishu","enabled":true}]}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("failed to seed settings file: %v", err)
	}

	settings, err := LoadOrCreateSettings(path)
	if err != nil {
		t.Fatalf("LoadOrCreateSettings returned error: %v", err)
	}

	if settings.FeishuReplyRenderer != FeishuReplyRendererPost {
		t.Fatalf("expected feishuReplyRenderer to be preserved, got %q", settings.FeishuReplyRenderer)
	}
}

func TestLoadOrCreateSettingsDefaultsWeixinReplyMode(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "bridge_settings.json")
	raw := []byte(`{"enabled":true,"adminPort":60110,"autoStart":false,"connectors":[{"id":"weixin-default","platform":"weixin","enabled":true,"mode":"polling","label":"Weixin"}]}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("failed to seed settings file: %v", err)
	}

	settings, err := LoadOrCreateSettings(path)
	if err != nil {
		t.Fatalf("LoadOrCreateSettings returned error: %v", err)
	}

	if len(settings.Connectors) != 1 {
		t.Fatalf("expected one connector, got %d", len(settings.Connectors))
	}
	if settings.Connectors[0].WeixinReplyMode != WeixinReplyModeStatusOnly {
		t.Fatalf("expected weixinReplyMode to default status_only, got %q", settings.Connectors[0].WeixinReplyMode)
	}
}

func TestLoadOrCreateSettingsBackfillsMissingFeishuAutoApproveToFalse(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "bridge_settings.json")
	raw := []byte(`{"enabled":true,"adminPort":60110,"autoStart":false,"channels":[{"platform":"telegram","enabled":true}]}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("failed to seed settings file: %v", err)
	}

	settings, err := LoadOrCreateSettings(path)
	if err != nil {
		t.Fatalf("LoadOrCreateSettings returned error: %v", err)
	}

	if settings.FeishuAutoApprove {
		t.Fatalf("expected missing feishuAutoApprove to default false")
	}
}

func TestLoadOrCreateSettingsPreservesFeishuAutoApproveTrue(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "bridge_settings.json")
	raw := []byte(`{"enabled":true,"adminPort":60110,"autoStart":false,"feishuAutoApprove":true,"channels":[{"platform":"feishu","enabled":true}]}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("failed to seed settings file: %v", err)
	}

	settings, err := LoadOrCreateSettings(path)
	if err != nil {
		t.Fatalf("LoadOrCreateSettings returned error: %v", err)
	}

	if !settings.FeishuAutoApprove {
		t.Fatalf("expected explicit feishuAutoApprove=true to be preserved")
	}
}

func TestLoadOrCreateSettingsPreservesFeishuAutoApproveFalse(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "bridge_settings.json")
	raw := []byte(`{"enabled":true,"adminPort":60110,"autoStart":false,"feishuAutoApprove":false,"channels":[{"platform":"feishu","enabled":true}]}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("failed to seed settings file: %v", err)
	}

	settings, err := LoadOrCreateSettings(path)
	if err != nil {
		t.Fatalf("LoadOrCreateSettings returned error: %v", err)
	}

	if settings.FeishuAutoApprove {
		t.Fatalf("expected explicit feishuAutoApprove=false to be preserved")
	}
}

func TestLoadOrCreateSettingsNormalizesWorkDirPresets(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "bridge_settings.json")
	raw := []byte(`{"enabled":true,"adminPort":60110,"autoStart":false,"workDirPresets":[{"name":" Repo ","path":" D:/repo "},{"name":" ","path":"D:/skip"},{"name":"Duplicate","path":"D:/repo"},{"name":"Docs","path":"D:/docs"}],"channels":[{"platform":"telegram","enabled":true}]}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("failed to seed settings file: %v", err)
	}

	settings, err := LoadOrCreateSettings(path)
	if err != nil {
		t.Fatalf("LoadOrCreateSettings returned error: %v", err)
	}

	if len(settings.WorkDirPresets) != 2 {
		t.Fatalf("expected 2 normalized presets, got %+v", settings.WorkDirPresets)
	}
	if settings.WorkDirPresets[0].Name != "Repo" || settings.WorkDirPresets[0].Path != "D:/repo" {
		t.Fatalf("unexpected first preset: %+v", settings.WorkDirPresets[0])
	}
	if settings.WorkDirPresets[1].Name != "Docs" || settings.WorkDirPresets[1].Path != "D:/docs" {
		t.Fatalf("unexpected second preset: %+v", settings.WorkDirPresets[1])
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
