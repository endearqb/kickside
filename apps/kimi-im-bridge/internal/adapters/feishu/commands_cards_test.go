package feishu

import (
	"fmt"
	"strings"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

func TestParseBridgeCommandTextSupportsWorkDirAddAlias(t *testing.T) {
	t.Parallel()

	command, ok := parseBridgeCommandText("/bridge cwd add D:/repo path")
	if !ok {
		t.Fatal("expected cwd add alias to parse")
	}
	if command.Kind != bridgeCommandCwdSet {
		t.Fatalf("expected cwd set kind, got %q", command.Kind)
	}
	if command.Arg != "D:/repo path" {
		t.Fatalf("expected work dir arg to be preserved, got %q", command.Arg)
	}
}

func TestParseBridgeCommandTextSupportsWorkDirRemoveAlias(t *testing.T) {
	t.Parallel()

	command, ok := parseBridgeCommandText("/bridge cwd remove")
	if !ok {
		t.Fatal("expected cwd remove alias to parse")
	}
	if command.Kind != bridgeCommandCwdClear {
		t.Fatalf("expected cwd clear kind, got %q", command.Kind)
	}
}

func TestBuildBridgeHelpCardMentionsWorkDirAliases(t *testing.T) {
	t.Parallel()

	card := buildBridgeHelpCard(domain.BindingKey{
		Platform: platformID,
		ChatID:   "chat-1",
		ThreadID: "thread-1",
	})
	elements, ok := card["elements"].([]any)
	if !ok || len(elements) == 0 {
		t.Fatal("expected help card elements")
	}

	foundAddAlias := false
	foundRemoveAlias := false
	foundPresetHint := false
	foundStartCommand := false
	foundDoctorCommand := false
	foundPanelAction := false
	for _, raw := range elements {
		element, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if tag, _ := element["tag"].(string); tag == "action" {
			foundPanelAction = true
		}
		text, ok := element["text"].(map[string]string)
		if !ok {
			continue
		}
		content := text["content"]
		if strings.Contains(content, "/bridge cwd add <path>") {
			foundAddAlias = true
		}
		if strings.Contains(content, "/bridge cwd remove") {
			foundRemoveAlias = true
		}
		if strings.Contains(content, "clickable work directory presets") {
			foundPresetHint = true
		}
		if strings.Contains(content, "/bridge start") {
			foundStartCommand = true
		}
		if strings.Contains(content, "/bridge doctor") {
			foundDoctorCommand = true
		}
	}

	if !foundAddAlias || !foundRemoveAlias || !foundPresetHint || !foundStartCommand || !foundDoctorCommand || !foundPanelAction {
		t.Fatalf("expected help card to mention cwd add/remove aliases, got %+v", elements)
	}
}

func TestParseBridgeCommandTextSupportsStartAndDoctor(t *testing.T) {
	t.Parallel()

	start, ok := parseBridgeCommandText("/bridge start")
	if !ok || start.Kind != bridgeCommandStart {
		t.Fatalf("expected /bridge start to parse, got %+v ok=%v", start, ok)
	}
	doctor, ok := parseBridgeCommandText("/bridge doctor")
	if !ok || doctor.Kind != bridgeCommandDoctor {
		t.Fatalf("expected /bridge doctor to parse, got %+v ok=%v", doctor, ok)
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
