package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseFlagsReadsAdminTokenFromEnv(t *testing.T) {
	t.Parallel()

	options, err := parseFlagsFrom(requiredArgs(), func(name string) string {
		if name == adminTokenEnv {
			return " env-admin-token "
		}
		return ""
	}, os.ReadFile)
	if err != nil {
		t.Fatalf("parseFlagsFrom returned error: %v", err)
	}
	if options.AdminToken != "env-admin-token" {
		t.Fatalf("expected env admin token, got %q", options.AdminToken)
	}
}

func TestParseFlagsReadsTokensFromFilesBeforeLegacyFlags(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	adminPath := filepath.Join(dir, "admin.token")
	hostPath := filepath.Join(dir, "host.token")
	if err := os.WriteFile(adminPath, []byte(" file-admin-token \n"), 0o600); err != nil {
		t.Fatalf("write admin token: %v", err)
	}
	if err := os.WriteFile(hostPath, []byte(" file-host-token \n"), 0o600); err != nil {
		t.Fatalf("write host token: %v", err)
	}

	args := append(requiredArgs(),
		"--admin-token", "legacy-admin-token",
		"--host-control-token", "legacy-host-token",
		"--admin-token-file", adminPath,
		"--host-control-token-file", hostPath,
	)
	options, err := parseFlagsFrom(args, func(string) string { return "" }, os.ReadFile)
	if err != nil {
		t.Fatalf("parseFlagsFrom returned error: %v", err)
	}
	if options.AdminToken != "file-admin-token" {
		t.Fatalf("expected file admin token, got %q", options.AdminToken)
	}
	if options.HostControlToken != "file-host-token" {
		t.Fatalf("expected file host token, got %q", options.HostControlToken)
	}
}

func TestParseFlagsRequiresSecureAdminTokenSource(t *testing.T) {
	t.Parallel()

	_, err := parseFlagsFrom(requiredArgs(), func(string) string { return "" }, os.ReadFile)
	if err == nil {
		t.Fatal("expected missing admin token error")
	}
	if !strings.Contains(err.Error(), adminTokenEnv) {
		t.Fatalf("expected env name in error, got %q", err.Error())
	}
}

func TestParseFlagsReadsRuntimeLocatorFromEnv(t *testing.T) {
	t.Parallel()

	options, err := parseFlagsFrom(requiredArgs(), func(name string) string {
		switch name {
		case adminTokenEnv:
			return "admin-token"
		case kimiRuntimeLocatorFileEnv:
			return "D:/kimi/kimi_runtime_locator.json"
		default:
			return ""
		}
	}, os.ReadFile)
	if err != nil {
		t.Fatalf("parseFlagsFrom returned error: %v", err)
	}
	if options.KimiRuntimeLocatorPath != "D:/kimi/kimi_runtime_locator.json" {
		t.Fatalf("expected runtime locator from env, got %q", options.KimiRuntimeLocatorPath)
	}
}

func TestParseFlagsAgentRoomFeatureFlagDefaultsOffAndValidates(t *testing.T) {
	t.Parallel()

	getenv := func(value string) func(string) string {
		return func(name string) string {
			if name == adminTokenEnv {
				return "admin-token"
			}
			if name == agentRoomEnabledEnv {
				return value
			}
			return ""
		}
	}
	options, err := parseFlagsFrom(requiredArgs(), getenv(""), os.ReadFile)
	if err != nil || options.AgentRoomEnabled {
		t.Fatalf("feature flag must default off: options=%+v err=%v", options, err)
	}
	options, err = parseFlagsFrom(requiredArgs(), getenv("true"), os.ReadFile)
	if err != nil || !options.AgentRoomEnabled {
		t.Fatalf("true must enable Agent Room: options=%+v err=%v", options, err)
	}
	if _, err := parseFlagsFrom(requiredArgs(), getenv("sometimes"), os.ReadFile); err == nil || !strings.Contains(err.Error(), agentRoomEnabledEnv) {
		t.Fatalf("invalid feature flag must be rejected, got %v", err)
	}
}

func requiredArgs() []string {
	return []string{
		"--config", "bridge_settings.json",
		"--secrets", "bridge_secrets.json",
		"--db", "bridge.db",
		"--log-file", "bridge.log",
	}
}
