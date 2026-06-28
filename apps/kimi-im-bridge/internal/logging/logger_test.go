package logging

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoggerRedactsRegisteredSecrets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bridge.log")
	logger, err := New(path)
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}
	logger.RegisterSecrets("admin-token-secret", "host-control-secret")

	logger.Printf("admin=%s host=host-control-secret", "admin-token-secret")
	if err := logger.Close(); err != nil {
		t.Fatalf("close logger: %v", err)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read log: %v", err)
	}
	output := string(content)
	if strings.Contains(output, "admin-token-secret") || strings.Contains(output, "host-control-secret") {
		t.Fatalf("log leaked registered secret: %s", output)
	}
	if count := strings.Count(output, "[REDACTED]"); count != 2 {
		t.Fatalf("expected 2 redactions, got %d in %q", count, output)
	}
}

func TestLoggerRedactsLongestSecretsFirst(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bridge.log")
	logger, err := New(path)
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}
	logger.RegisterSecrets("abcd", "abcdef")

	logger.Printf("token=abcdef")
	if err := logger.Close(); err != nil {
		t.Fatalf("close logger: %v", err)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read log: %v", err)
	}
	output := string(content)
	if strings.Contains(output, "abcdef") || strings.Contains(output, "abcd") {
		t.Fatalf("log leaked registered secret: %s", output)
	}
	if !strings.Contains(output, "token=[REDACTED]") {
		t.Fatalf("expected full secret redaction, got %q", output)
	}
}
