package logging

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
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

func TestLoggerCreatesPrivateLogFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows does not report POSIX file permissions through os.FileMode")
	}
	path := filepath.Join(t.TempDir(), "bridge.log")
	logger, err := New(path)
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}
	if err := logger.Close(); err != nil {
		t.Fatalf("close logger: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat log: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("expected log mode 0600, got %04o", got)
	}
}

func TestLoggerRotatesOversizedLogFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bridge.log")
	if err := os.WriteFile(path, bytes.Repeat([]byte("x"), maxLogFileBytes+1), 0o600); err != nil {
		t.Fatalf("seed oversized log: %v", err)
	}

	logger, err := New(path)
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}
	logger.Printf("fresh")
	if err := logger.Close(); err != nil {
		t.Fatalf("close logger: %v", err)
	}

	if _, err := os.Stat(path + ".1"); err != nil {
		t.Fatalf("expected rotated log: %v", err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fresh log: %v", err)
	}
	if !strings.Contains(string(content), "fresh") {
		t.Fatalf("expected fresh log content, got %q", string(content))
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
