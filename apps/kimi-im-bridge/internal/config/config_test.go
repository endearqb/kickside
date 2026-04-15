package config

import (
	"os"
	"path/filepath"
	"testing"
)

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
	if !settings.FeishuAutoApprove {
		t.Fatalf("expected feishuAutoApprove to default true")
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

func TestLoadOrCreateSettingsBackfillsMissingFeishuAutoApprove(t *testing.T) {
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

	if !settings.FeishuAutoApprove {
		t.Fatalf("expected missing feishuAutoApprove to default true")
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