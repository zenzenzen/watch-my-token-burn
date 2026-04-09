# Watch My Token Burn

A zero-dependency terminal dashboard that tracks token usage, context window consumption, and estimated costs for **Claude Code** and **OpenAI Codex** sessions in real time.

![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

## 💸🔥 Why 🔥💸

I kept seeing memes about people's API bills looking like mortgage payments and thought "haha, couldn't be me" — and then it was me. I had no idea how fast tokens evaporate until I watched an Opus session mass-produce cache write tokens like it was getting paid by the million. (It was. By me.)

So I built this. Not to stop the bleeding — let's be honest, I'm not going to stop — but to at least watch the money leave in real time with nice color-coded bars, like a gas gauge for my mass burn. It doesn't make it hurt less, but it does make it *aesthetic* 😎💸🔥💰🔥

Anyway, `token-gauge` reads session data directly from `~/.claude/` and `~/.codex/` and renders live dashboards so you too can experience the thrill of watching your context window fill up and your wallet empty out simultaneously.

💸🔥💸🔥💸🔥💸🔥💸🔥💸🔥💸🔥💸🔥💸🔥💸🔥💸🔥💸🔥💸🔥💸🔥💸🔥💸

## Features

- **Fullscreen dashboard** — context window breakdown, session tokens, cost estimates, weekly usage chart
- **Inline mode** — single- or multi-line summary for embedding in status bars
- **Claude Code `statusLine` hook** — reads Claude's hook JSON from stdin and renders a footer
- **Codex adapter** — same concept for OpenAI Codex sessions
- **Model-aware pricing** — knows Opus 4.6, Sonnet 4.6, and Haiku 4.5 rates (input, output, cache read/write)
- **Weekly tracker** — persists daily token aggregates to `~/.config/token-gauge/weekly.json`
- **Zero dependencies** — pure Node.js, no npm install required to run
- **ASCII fallback** — auto-detects non-UTF-8 locales and degrades gracefully

## Quick Start

```sh
# Run directly (no install)
git clone https://github.com/zenzenzen/watch-my-token-burn.git
cd watch-my-token-burn
node src/main.js

# Or install globally for the `tg` shortcut
npm install -g .
tg
```

## Usage

```
token-gauge [options]

Options:
  --host <name>        standalone | claude | codex    (default: standalone)
  --mode <name>        fullscreen | inline            (default: fullscreen)
  --format <name>      ansi | plain | json            (default: ansi)
  --rows <n>           Inline output rows             (default: 1)
  --provider <name>    Initial tab: claude | codex    (default: claude)
  --ascii              Force ASCII-safe rendering
  --once               Print once and exit
  --watch              Keep refreshing inline mode
  -i, --interval <ms>  Refresh interval               (default: 15000)
  --autoclear <min>    Auto-clear stale sessions       (default: 30)
  --view <mode>        compact | detail                (default: compact)
  -h, --help           Show help
```

### Fullscreen Dashboard

```sh
tg                          # default: compact view, Claude tab
tg --view detail            # detailed view with context bars and weekly chart
tg --provider codex         # start on the Codex tab
```

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `q` / `Ctrl+C` | Quit |
| `r` / `Space` | Force refresh |
| `v` | Toggle compact/detail |
| `[` / `]` | Switch Claude/Codex tabs |
| `c` | Clear stale sessions (Claude detail only) |

### Inline Mode

```sh
tg --mode inline --once                    # one-shot snapshot
tg --mode inline --watch                   # live-updating strip
tg --mode inline --provider codex --once   # Codex snapshot
tg --mode inline --format json             # structured output
```

### Claude Code Status Line

Wire `token-gauge` into Claude Code's footer by adding this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "tg --host claude --mode inline --rows 2"
  }
}
```

Or run the installer to set it up automatically:

```sh
./scripts/install-tg.sh
```

The installer:
1. Installs `tg` globally via npm
2. Configures Claude Code's `statusLine` in `~/.claude/settings.json`
3. Stages a Codex adapter snippet in `~/.codex/`

Use `--dry-run` to preview what it would do, or `--claude-only` / `--codex-only` to target one host.

### Codex Adapter

Pipe Codex hook JSON through stdin:

```sh
echo '{"session_id":"s1","context_window":{"current_tokens":24800,"context_window_size":258400},"usage":{"total_tokens":83100}}' \
  | tg --host codex --mode inline --rows 2 --format plain
```

## How It Works

| Module | Role |
|--------|------|
| `src/collector.js` | Reads Claude session metadata from `~/.claude/sessions/` and parses `.jsonl` logs for token usage |
| `src/codex.js` | Reads Codex session data from `~/.codex/sessions/` and the session index |
| `src/snapshot.js` | Normalizes session data into a unified snapshot shape for both local and hook modes |
| `src/tracker.js` | Persists and queries 7-day rolling token aggregates |
| `src/ui.js` | Renders the fullscreen TUI (compact + detail views, powerline segments, context bars) |
| `src/inline.js` | Renders the compact inline/status-line output |
| `src/state.js` | CLI argument parsing, input handling, state transitions |
| `src/main.js` | Entry point — routes to fullscreen app, inline app, or hook adapter |

## Model Pricing

Built-in rates used for cost estimates (per 1M tokens):

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| Opus 4.6 | $15 | $75 | $1.875 | $18.75 |
| Sonnet 4.6 | $3 | $15 | $0.375 | $3.75 |
| Haiku 4.5 | $0.80 | $4 | $0.08 | $1 |

## Tests

```sh
node --test
```

## Requirements

- Node.js >= 18
- macOS or Linux (reads `~/.claude/` and `~/.codex/` directories)

## License

MIT
