package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/app"
)

const version = "0.1.0-phase01"

func main() {
	options, err := parseFlags()
	if err != nil {
		fatalStartup("parse_flags", err, 2)
	}

	service, err := app.New(options)
	if err != nil {
		fatalStartup("initialize", err, 1)
	}
	defer service.Close()

	if err := service.Start(); err != nil {
		fatalStartup("start", err, 1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case <-ctx.Done():
	case <-service.StopRequested():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := service.Shutdown(shutdownCtx); err != nil {
		fatalStartup("shutdown", err, 1)
	}
}

func fatalStartup(phase string, err error, code int) {
	fmt.Fprintf(os.Stderr, "bridge startup phase=%s error=%v\n", phase, err)
	os.Exit(code)
}

func parseFlags() (app.Options, error) {
	var options app.Options

	flag.StringVar(&options.ConfigPath, "config", "", "absolute path to bridge_settings.json")
	flag.StringVar(&options.SecretsPath, "secrets", "", "absolute path to bridge_secrets.json")
	flag.StringVar(&options.DBPath, "db", "", "absolute path to bridge.db")
	flag.StringVar(&options.LogFilePath, "log-file", "", "absolute path to bridge.log")
	flag.IntVar(&options.AdminPort, "admin-port", 60110, "loopback admin API port")
	flag.StringVar(&options.AdminToken, "admin-token", "", "shell-provided loopback admin token")
	flag.Parse()

	options.Version = version
	if options.ConfigPath == "" {
		return options, fmt.Errorf("--config is required")
	}
	if options.SecretsPath == "" {
		return options, fmt.Errorf("--secrets is required")
	}
	if options.DBPath == "" {
		return options, fmt.Errorf("--db is required")
	}
	if options.LogFilePath == "" {
		return options, fmt.Errorf("--log-file is required")
	}
	if options.AdminToken == "" {
		return options, fmt.Errorf("--admin-token is required")
	}
	if options.AdminPort <= 0 || options.AdminPort > 65535 {
		return options, fmt.Errorf("--admin-port must be between 1 and 65535")
	}

	return options, nil
}
