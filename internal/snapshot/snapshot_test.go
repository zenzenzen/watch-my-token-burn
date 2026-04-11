package snapshot

import (
	"encoding/json"
	"testing"
)

func TestSnapshotJSONTagsMatchExpectedShape(t *testing.T) {
	cost := 1.25
	body, err := json.Marshal(Snapshot{
		Version:        1,
		Host:           "standalone",
		Provider:       "claude",
		Title:          "Example",
		SessionLabel:   "Example",
		WorkspaceLabel: "workspace",
		ModelLabel:     "Claude Sonnet 4.6",
		StatusLabel:    "active",
		TotalTokens:    15000,
		ContextTokens:  7700,
		ContextWindow:  200000,
		CostUSD:        &cost,
	})
	if err != nil {
		t.Fatalf("Marshal returned error: %v", err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("Unmarshal returned error: %v", err)
	}

	if decoded["provider"] != "claude" {
		t.Fatalf("expected provider to round-trip, got %#v", decoded["provider"])
	}
	if decoded["sessionLabel"] != "Example" {
		t.Fatalf("expected sessionLabel to use JS-compatible casing, got %#v", decoded["sessionLabel"])
	}
}
