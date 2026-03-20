package kimi

import (
	"os"
	"testing"
)

func TestConfigureSDKDriverEnvironmentSetsAndClearsAuthFile(t *testing.T) {
	t.Parallel()

	original, hadOriginal := os.LookupEnv("KIMI_BRIDGE_AUTH_FILE")
	t.Cleanup(func() {
		if hadOriginal {
			_ = os.Setenv("KIMI_BRIDGE_AUTH_FILE", original)
		} else {
			_ = os.Unsetenv("KIMI_BRIDGE_AUTH_FILE")
		}
	})

	if err := configureSDKDriverEnvironment("D:/tmp/provider-bridge-skill-auth.json"); err != nil {
		t.Fatalf("configureSDKDriverEnvironment returned error: %v", err)
	}
	if got := os.Getenv("KIMI_BRIDGE_AUTH_FILE"); got != "D:/tmp/provider-bridge-skill-auth.json" {
		t.Fatalf("expected auth file env to be set, got %q", got)
	}

	if err := configureSDKDriverEnvironment(""); err != nil {
		t.Fatalf("configureSDKDriverEnvironment clear returned error: %v", err)
	}
	if got, ok := os.LookupEnv("KIMI_BRIDGE_AUTH_FILE"); ok {
		t.Fatalf("expected auth file env to be unset, got %q", got)
	}
}
