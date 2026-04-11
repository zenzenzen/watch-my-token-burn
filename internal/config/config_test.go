package config

import "testing"

func TestParseNormalizesDefaults(t *testing.T) {
	cfg, err := Parse([]string{"--host", "nope", "--rows", "0", "--format", "bad"})
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	if cfg.Host != DefaultHost {
		t.Fatalf("expected default host, got %q", cfg.Host)
	}
	if cfg.Rows != DefaultRows {
		t.Fatalf("expected default rows, got %d", cfg.Rows)
	}
	if cfg.Format != DefaultFormat {
		t.Fatalf("expected default format, got %q", cfg.Format)
	}
}

func TestParseForHookHostDefaultsToInlineMode(t *testing.T) {
	cfg, err := Parse([]string{"--host", "claude"})
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	if cfg.Host != "claude" {
		t.Fatalf("expected claude host, got %q", cfg.Host)
	}
	if cfg.Mode != "inline" {
		t.Fatalf("expected hook host to default to inline mode, got %q", cfg.Mode)
	}
}

func TestParsePreservesExplicitValidValues(t *testing.T) {
	cfg, err := Parse([]string{
		"--host", "codex",
		"--provider", "codex",
		"--mode", "fullscreen",
		"--view", "detail",
		"--format", "json",
		"--rows", "2",
		"--interval", "5000",
		"--autoclear", "15",
		"--ascii",
		"--once",
	})
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	if cfg.Host != "codex" || cfg.Provider != "codex" {
		t.Fatalf("expected codex host/provider, got %+v", cfg)
	}
	if cfg.Mode != "fullscreen" || cfg.View != "detail" || cfg.Format != "json" {
		t.Fatalf("expected explicit mode/view/format to be preserved, got %+v", cfg)
	}
	if cfg.Rows != 2 || cfg.RefreshInterval != 5000 || cfg.AutoClearMin != 15 {
		t.Fatalf("expected explicit numeric values to be preserved, got %+v", cfg)
	}
	if !cfg.ASCII || !cfg.Once {
		t.Fatalf("expected boolean flags to be preserved, got %+v", cfg)
	}
}
