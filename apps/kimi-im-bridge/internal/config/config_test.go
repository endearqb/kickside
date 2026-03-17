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
	if settings.FeishuReplyRenderer != FeishuReplyRendererInteractive {
		t.Fatalf("expected feishuReplyRenderer to default interactive, got %q", settings.FeishuReplyRenderer)
	}
	if len(settings.WorkDirPresets) != 0 {
		t.Fatalf("expected workDirPresets to default empty, got %d", len(settings.WorkDirPresets))
	}
	if len(settings.Channels) != 2 {
		t.Fatalf("expected 2 default channels, got %d", len(settings.Channels))
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

	if len(settings.Channels) != 2 {
		t.Fatalf("expected normalized channels length 2, got %d", len(settings.Channels))
	}
	if settings.Channels[0].Mode == "" {
		t.Fatalf("expected telegram mode to be filled from defaults")
	}
	if settings.Channels[1].Platform != "feishu" {
		t.Fatalf("expected feishu default channel to be restored, got %+v", settings.Channels[1])
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
	raw := []byte(`{"enabled":true,"adminPort":60110,"autoStart":false,"feishuReplyRenderer":"post","channels":[{"platform":"telegram","enabled":true}]}`)
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
