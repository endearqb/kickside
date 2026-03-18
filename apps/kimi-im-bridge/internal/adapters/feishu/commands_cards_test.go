package feishu

import (
	"fmt"
	"strings"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

func TestParseBridgeCommandIgnoresBridgeTextCommands(t *testing.T) {
	t.Parallel()

	command, key, ok := parseBridgeCommand(&MessageEvent{
		ChatID:      "chat-1",
		ThreadID:    "thread-1",
		ChatType:    "p2p",
		MessageType: "text",
		Content:     `{"text":"/bridge doctor"}`,
	})
	if ok {
		t.Fatalf("expected /bridge command exposure to be disabled, got command=%+v key=%+v", command, key)
	}
}

func TestBuildBridgeHelpCardReturnsHiddenEntryMessage(t *testing.T) {
	t.Parallel()

	card := buildBridgeHelpCard(domain.BindingKey{
		Platform: platformID,
		ChatID:   "chat-1",
		ThreadID: "thread-1",
	})
	rendered := fmt.Sprintf("%+v", card)
	if !strings.Contains(rendered, "IM Bridge management hidden") {
		t.Fatalf("expected hidden bridge entry card, got %+v", card)
	}
	if strings.Contains(rendered, "/bridge") {
		t.Fatalf("expected no /bridge command hints in hidden card, got %+v", card)
	}
}

func TestBuildWorkDirCardShowsPresetButtonsAndLimit(t *testing.T) {
	t.Parallel()

	card := buildWorkDirCard(&domain.SessionBinding{
		KimiSessionID: "session-1",
		WorkDir:       "D:/repo",
	}, "D:/default", []WorkDirPreset{
		{Name: "Repo", Path: "D:/repo"},
		{Name: "Docs", Path: "D:/docs"},
		{Name: "A", Path: "D:/a"},
		{Name: "B", Path: "D:/b"},
		{Name: "C", Path: "D:/c"},
		{Name: "D", Path: "D:/d"},
		{Name: "E", Path: "D:/e"},
	}, domain.BindingKey{
		ChatID:   "chat-1",
		ThreadID: "thread-1",
	})

	elements, ok := card["elements"].([]any)
	if !ok {
		t.Fatalf("expected elements array, got %+v", card["elements"])
	}
	rendered := fmt.Sprintf("%+v", elements)

	actionRows := 0
	foundTruncationHint := false
	for _, raw := range elements {
		element, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if tag, _ := element["tag"].(string); tag == "action" {
			actionRows++
		}
		if text, ok := element["text"].(map[string]string); ok && strings.Contains(text["content"], "Showing the first 6 of 7 configured work directory presets.") {
			foundTruncationHint = true
		}
	}

	if actionRows < 3 {
		t.Fatalf("expected multiple action rows including presets and clear button, got %d", actionRows)
	}
	if !strings.Contains(rendered, "content:Repo") || !strings.Contains(rendered, "type:primary") {
		t.Fatalf("expected active preset button to be primary, got %+v", elements)
	}
	if !foundTruncationHint {
		t.Fatalf("expected truncation hint for preset overflow, got %+v", elements)
	}
}
