package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

func main() {
	locator := flag.String("locator", strings.TrimSpace(os.Getenv("KIMI_APP_RUNTIME_LOCATOR_FILE")), "path to kimi_runtime_locator.json")
	sessionList := flag.String("sessions", "", "optional comma-separated existing Session IDs")
	timeout := flag.Duration("timeout", 5*time.Second, "per-request timeout")
	observerCounts := flag.String("observer-counts", "", "optional comma-separated SessionObserver subscription counts")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout*5)
	defer cancel()
	report := bridgeruntime.ProbeRuntimeCapabilities(ctx, bridgeruntime.RuntimeCapabilityProbeOptions{
		RuntimeLocatorPath: strings.TrimSpace(*locator),
		SessionIDs:         splitSessionIDs(*sessionList),
		Timeout:            *timeout,
		ObserverCounts:     splitCounts(*observerCounts),
	})
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		fmt.Fprintln(os.Stderr, "encode runtime capability report failed")
		os.Exit(1)
	}
}

func splitCounts(value string) []int {
	var counts []int
	for _, raw := range strings.Split(value, ",") {
		var count int
		if _, err := fmt.Sscan(strings.TrimSpace(raw), &count); err == nil && count > 0 {
			counts = append(counts, count)
		}
	}
	return counts
}

func splitSessionIDs(value string) []string {
	var ids []string
	for _, id := range strings.Split(value, ",") {
		if id = strings.TrimSpace(id); id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}
