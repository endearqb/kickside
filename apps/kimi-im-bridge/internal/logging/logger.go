package logging

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
)

type Logger struct {
	mu     sync.Mutex
	file   *os.File
	logger *log.Logger
}

func New(path string) (*Logger, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("failed to create log directory for %s: %w", path, err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("failed to open log file %s: %w", path, err)
	}
	return &Logger{
		file:   file,
		logger: log.New(file, "", log.LstdFlags|log.LUTC),
	}, nil
}

func (l *Logger) Printf(format string, args ...any) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.logger.Printf(format, args...)
}

func (l *Logger) Close() error {
	if l == nil || l.file == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.file.Close()
}
