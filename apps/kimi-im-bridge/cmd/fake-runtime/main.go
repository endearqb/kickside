package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime/fakeruntime"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:0", "loopback listen address")
	tokenPath := flag.String("token-file", "", "path to bearer token file")
	transcript := flag.Bool("transcript", true, "enable transcript endpoint")
	flag.Parse()
	if strings.TrimSpace(*tokenPath) == "" {
		log.Fatal("--token-file is required")
	}
	host, _, err := net.SplitHostPort(*addr)
	if err != nil || (host != "127.0.0.1" && host != "localhost" && host != "::1") {
		log.Fatal("--addr must be loopback")
	}
	runtime, err := fakeruntime.New(fakeruntime.Config{TokenPath: *tokenPath, Transcript: *transcript})
	if err != nil {
		log.Fatal(err)
	}
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatal(err)
	}
	origin := "http://" + listener.Addr().String()
	// Locator output contains only the token path, never the token value.
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"origin": origin, "tokenPath": *tokenPath, "health": "ready", "epoch": runtime.Epoch()})
	fmt.Fprintln(os.Stderr, "fake runtime listening on loopback")
	log.Fatal(http.Serve(listener, runtime))
}
