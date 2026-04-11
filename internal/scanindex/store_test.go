package scanindex

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultConfigDirEndsWithTokenGaugeConfigPath(t *testing.T) {
	dir := DefaultConfigDir()
	if dir == "" {
		t.Fatal("expected non-empty config dir")
	}
	if !strings.HasSuffix(dir, filepath.Join(".config", "token-gauge")) {
		t.Fatalf("expected token-gauge config path suffix, got %q", dir)
	}
}

func TestFileJSONRoundTripPreservesEntryShape(t *testing.T) {
	rawPayload := json.RawMessage(`{"kind":"codex-session","parsed":{"latestTimestamp":"2026-04-12T10:00:00Z"}}`)
	original := File{
		Version:   1,
		UpdatedAt: "2026-04-12T10:00:00Z",
		Files: map[string]*Entry{
			"/tmp/example.jsonl": {
				Version:          1,
				Path:             "/tmp/example.jsonl",
				Size:             2048,
				ModTimeUnixMilli: 1712916000000,
				Offset:           1536,
				LatestTimestamp:  "2026-04-12T09:59:59Z",
				Payload:          rawPayload,
			},
		},
	}

	body, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("Marshal returned error: %v", err)
	}

	var decoded File
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("Unmarshal returned error: %v", err)
	}

	entry := decoded.Files["/tmp/example.jsonl"]
	if entry == nil {
		t.Fatalf("expected indexed entry to survive round-trip, got %#v", decoded.Files)
	}
	if entry.Offset != 1536 || entry.Size != 2048 {
		t.Fatalf("expected numeric fields to survive round-trip, got %#v", entry)
	}
	if string(entry.Payload) != string(rawPayload) {
		t.Fatalf("expected payload to survive round-trip, got %s", entry.Payload)
	}
}
