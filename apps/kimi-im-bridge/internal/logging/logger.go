package logging

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Logger struct {
	mu      sync.Mutex
	file    *os.File
	logger  *log.Logger
	secrets []string
}

const maxLogFileBytes = 5 << 20

func New(path string) (*Logger, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("failed to create log directory for %s: %w", path, err)
	}
	if err := rotateOversizedLog(path); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("failed to open log file %s: %w", path, err)
	}
	return &Logger{
		file:   file,
		logger: log.New(file, "", 0),
	}, nil
}

func rotateOversizedLog(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("failed to stat log file %s: %w", path, err)
	}
	if info.Size() <= maxLogFileBytes {
		return nil
	}

	rotatedPath := path + ".1"
	_ = os.Remove(rotatedPath)
	if err := os.Rename(path, rotatedPath); err != nil {
		return fmt.Errorf("failed to rotate log file %s: %w", path, err)
	}
	return nil
}

func (l *Logger) Printf(format string, args ...any) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	prefix := time.Now().Format("2006/01/02 15:04:05 -07:00 ")
	message := fmt.Sprintf(format, args...)
	l.logger.Print(prefix + l.redactLocked(message))
}

func (l *Logger) RegisterSecret(value string) {
	if l == nil {
		return
	}
	secret := strings.TrimSpace(value)
	if len(secret) < 4 {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, existing := range l.secrets {
		if existing == secret {
			return
		}
	}
	l.secrets = append(l.secrets, secret)
	sort.Slice(l.secrets, func(i, j int) bool {
		return len(l.secrets[i]) > len(l.secrets[j])
	})
}

func (l *Logger) RegisterSecrets(values ...string) {
	for _, value := range values {
		l.RegisterSecret(value)
	}
}

func (l *Logger) redactLocked(message string) string {
	redacted := message
	for _, secret := range l.secrets {
		redacted = strings.ReplaceAll(redacted, secret, "[REDACTED]")
	}
	return redacted
}

func (l *Logger) Close() error {
	if l == nil || l.file == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.file.Close()
}
