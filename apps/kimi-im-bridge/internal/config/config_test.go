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

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
