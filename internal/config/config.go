package config

import (
	"flag"
	"fmt"
	"io"
)

const (
	DefaultHost            = "standalone"
	DefaultProvider        = "claude"
	DefaultMode            = "fullscreen"
	DefaultView            = "compact"
	DefaultFormat          = "ansi"
	DefaultRows            = 1
	DefaultRefreshInterval = 15000
	DefaultAutoClearMin    = 30
)

type Config struct {
	Host            string
	Provider        string
	Mode            string
	View            string
	Format          string
	Rows            int
	RefreshInterval int
	AutoClearMin    int
	ASCII           bool
	Once            bool
	Help            bool
}

func Parse(args []string) (Config, error) {
	cfg := Config{
		Host:            DefaultHost,
		Provider:        DefaultProvider,
		View:            DefaultView,
		Format:          DefaultFormat,
		Rows:            DefaultRows,
		RefreshInterval: DefaultRefreshInterval,
		AutoClearMin:    DefaultAutoClearMin,
	}

	fs := flag.NewFlagSet("token-gauge", flag.ContinueOnError)
	fs.SetOutput(io.Discard)

	fs.StringVar(&cfg.Host, "host", cfg.Host, "")
	fs.StringVar(&cfg.Provider, "provider", cfg.Provider, "")
	fs.StringVar(&cfg.Mode, "mode", cfg.Mode, "")
	fs.StringVar(&cfg.View, "view", cfg.View, "")
	fs.StringVar(&cfg.Format, "format", cfg.Format, "")
	fs.IntVar(&cfg.Rows, "rows", cfg.Rows, "")
	fs.IntVar(&cfg.RefreshInterval, "interval", cfg.RefreshInterval, "")
	fs.IntVar(&cfg.AutoClearMin, "autoclear", cfg.AutoClearMin, "")
	fs.BoolVar(&cfg.ASCII, "ascii", false, "")
	fs.BoolVar(&cfg.Once, "once", false, "")
	fs.BoolVar(&cfg.Help, "help", false, "")

	if err := fs.Parse(args); err != nil {
		return Config{}, err
	}

	return normalize(cfg), nil
}

func normalize(cfg Config) Config {
	switch cfg.Host {
	case "standalone", "claude", "codex":
	default:
		cfg.Host = DefaultHost
	}

	switch cfg.Provider {
	case "claude", "codex":
	default:
		cfg.Provider = DefaultProvider
	}

	switch cfg.Mode {
	case "fullscreen", "inline":
	default:
		if cfg.Host == "standalone" {
			cfg.Mode = DefaultMode
		} else {
			cfg.Mode = "inline"
		}
	}

	switch cfg.View {
	case "compact", "detail":
	default:
		cfg.View = DefaultView
	}

	switch cfg.Format {
	case "ansi", "plain", "json":
	default:
		cfg.Format = DefaultFormat
	}

	if cfg.Rows <= 0 {
		cfg.Rows = DefaultRows
	}
	if cfg.RefreshInterval <= 0 {
		cfg.RefreshInterval = DefaultRefreshInterval
	}
	if cfg.AutoClearMin <= 0 {
		cfg.AutoClearMin = DefaultAutoClearMin
	}

	return cfg
}

func HelpText() string {
	return fmt.Sprintf(`token-gauge (Go preview)

This is the staged Go workspace for the token-gauge migration.
The Node.js implementation remains the production entrypoint until parity lands.

Flags:
  --host <name>          standalone | claude | codex
  --mode <name>          fullscreen | inline
  --format <name>        ansi | plain | json
  --rows <n>             Inline rows
  --provider <name>      claude | codex
  --view <mode>          compact | detail
  --interval <ms>        Refresh interval
  --autoclear <min>      Claude stale-session cleanup
  --ascii                ASCII-safe rendering
  --once                 Print once and exit
  --help                 Show help
`)
}
