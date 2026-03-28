package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteBridgeSkillsAuthFilePersistsExpectedFields(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path, err := writeBridgeSkillsAuthFile(Options{
		DBPath:           filepath.Join(dir, "bridge.db"),
		AdminPort:        60110,
		AdminToken:       "admin-token",
		HostControlURL:   "http://127.0.0.1:60111",
		HostControlToken: "host-token",
	})
	if err != nil {
		t.Fatalf("writeBridgeSkillsAuthFile returned error: %v", err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}

	var payload bridgeSkillsAuthPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("Unmarshal returned error: %v", err)
	}
	if payload.AdminBaseURL != "http://127.0.0.1:60110" {
		t.Fatalf("unexpected admin base url: %+v", payload)
	}
	if payload.AdminToken != "admin-token" || payload.HostControlToken != "host-token" {
		t.Fatalf("unexpected auth payload tokens: %+v", payload)
	}
	if payload.GeneratedAt == "" {
		t.Fatalf("expected generated_at to be populated: %+v", payload)
	}
}

func TestCleanupBridgeSkillsAuthFileRemovesFile(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, bridgeSkillsAuthFileName)
	if err := os.WriteFile(path, []byte("{}"), 0o600); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	cleanupBridgeSkillsAuthFile(path)

	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected auth file to be removed, got err=%v", err)
	}
}
