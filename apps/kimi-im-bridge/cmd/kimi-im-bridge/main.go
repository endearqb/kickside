package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/app"
)

const version = "0.1.0-phase01"
const adminTokenEnv = "KIMI_IM_BRIDGE_ADMIN_TOKEN"
const adminTokenFileEnv = "KIMI_IM_BRIDGE_ADMIN_TOKEN_FILE"
const hostControlTokenEnv = "KIMI_IM_BRIDGE_HOST_CONTROL_TOKEN"
const hostControlTokenFileEnv = "KIMI_IM_BRIDGE_HOST_CONTROL_TOKEN_FILE"
const kimiRuntimeLocatorFileEnv = "KIMI_APP_RUNTIME_LOCATOR_FILE"

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
	return parseFlagsFrom(os.Args[1:], os.Getenv, os.ReadFile)
}

func parseFlagsFrom(args []string, getenv func(string) string, readFile func(string) ([]byte, error)) (app.Options, error) {
	var options app.Options
	var adminTokenFile string
	var hostControlTokenFile string

	flags := flag.NewFlagSet("kimi-im-bridge", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&options.ConfigPath, "config", "", "absolute path to bridge_settings.json")
	flags.StringVar(&options.SecretsPath, "secrets", "", "absolute path to bridge_secrets.json")
	flags.StringVar(&options.DBPath, "db", "", "absolute path to bridge.db")
	flags.StringVar(&options.LogFilePath, "log-file", "", "absolute path to bridge.log")
	flags.IntVar(&options.AdminPort, "admin-port", 60110, "loopback admin API port")
	flags.StringVar(&options.AdminToken, "admin-token", "", "deprecated: use KIMI_IM_BRIDGE_ADMIN_TOKEN or --admin-token-file")
	flags.StringVar(&adminTokenFile, "admin-token-file", "", "path to file containing loopback admin token")
	flags.StringVar(&options.HostControlURL, "host-control-url", "", "optional shell host-control base URL for bridge ops")
	flags.StringVar(&options.HostControlToken, "host-control-token", "", "deprecated: use KIMI_IM_BRIDGE_HOST_CONTROL_TOKEN or --host-control-token-file")
	flags.StringVar(&hostControlTokenFile, "host-control-token-file", "", "path to file containing shell host-control token")
	flags.StringVar(&options.KimiRuntimeLocatorPath, "kimi-runtime-locator", "", "optional shell-provided kimi-code runtime locator JSON file")
	flags.StringVar(&options.SkillsDir, "skills-dir", "", "optional skills directory mounted into Kimi CLI sessions")
	if err := flags.Parse(args); err != nil {
		return options, err
	}

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
	var err error
	options.AdminToken, err = resolveSecret("admin token", options.AdminToken, adminTokenFile, adminTokenEnv, adminTokenFileEnv, getenv, readFile)
	if err != nil {
		return options, err
	}
	options.HostControlToken, err = resolveSecret("host-control token", options.HostControlToken, hostControlTokenFile, hostControlTokenEnv, hostControlTokenFileEnv, getenv, readFile)
	if err != nil {
		return options, err
	}
	if options.AdminToken == "" {
		return options, fmt.Errorf("%s or %s is required", adminTokenEnv, adminTokenFileEnv)
	}
	if options.AdminPort <= 0 || options.AdminPort > 65535 {
		return options, fmt.Errorf("--admin-port must be between 1 and 65535")
	}
	if options.KimiRuntimeLocatorPath == "" {
		options.KimiRuntimeLocatorPath = strings.TrimSpace(getenv(kimiRuntimeLocatorFileEnv))
	}

	return options, nil
}

func resolveSecret(label string, flagValue string, flagFile string, envName string, envFileName string, getenv func(string) string, readFile func(string) ([]byte, error)) (string, error) {
	if value, ok, err := readSecretFile(label, flagFile, readFile); ok || err != nil {
		return value, err
	}
	if value, ok, err := readSecretFile(label, getenv(envFileName), readFile); ok || err != nil {
		return value, err
	}
	if value := strings.TrimSpace(getenv(envName)); value != "" {
		return value, nil
	}
	return strings.TrimSpace(flagValue), nil
}

func readSecretFile(label string, path string, readFile func(string) ([]byte, error)) (string, bool, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", false, nil
	}
	raw, err := readFile(path)
	if err != nil {
		return "", true, fmt.Errorf("read %s file: %w", label, err)
	}
	value := strings.TrimSpace(string(raw))
	if value == "" {
		return "", true, fmt.Errorf("%s file is empty", label)
	}
	return value, true, nil
}
