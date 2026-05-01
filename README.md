# Watch My Token Burn

A zero-dependency terminal dashboard for tracking token usage, context windows, rate limits, and cost signals for **Claude Code** and **OpenAI Codex** sessions.

The production implementation is still the Node.js app in `src/`. This repo now also includes:

- a persisted scan index under `~/.config/token-gauge/` to avoid re-parsing unchanged `.jsonl` logs on every refresh
- benchmark tooling for comparing indexed versus full rescans
- contributor docs for the staged Go migration
- an experimental Go workspace that mirrors the package boundaries we plan to port next

## Why this exists

`token-gauge` reads local session logs directly from:

- `~/.claude/sessions/` and `~/.claude/projects/`
- `~/.codex/session_index.jsonl` and `~/.codex/sessions/`

It renders that data as either:

- a fullscreen terminal dashboard
- an inline status/footer snapshot
- structured JSON for hooks and scripts
- an MCP server for agent/tool queries

Runtime defaults can now also come from `~/.config/token-gauge/config.json`, with CLI flags taking precedence over the config file.

## Current architecture

| Module | Role |
|--------|------|
| `src/collector.js` | Claude collector, project billing lookup, and indexed `.jsonl` aggregation |
| `src/codex.js` | Codex collector and indexed session-log parsing |
| `src/scan-index.js` | Versioned persisted scan index used to skip unchanged files and parse append-only deltas |
| `src/tracker.js` | Claude weekly persistence and actual-cost fallback from `~/.claude.json` |
| `src/codex-tracker.js` | Codex weekly persistence and estimated-cost aggregation |
| `src/snapshot.js` | Shared snapshot schema for inline mode and hook adapters |
| `src/ui.js` | Fullscreen TUI renderer |
| `src/inline.js` | Inline/status-line renderer |
| `src/state.js` | CLI parsing, config-file loading, and keyboard state transitions |
| `src/main.js` | Entry point routing for standalone mode and hook mode |

The deeper migration notes live in:

- [CLAUDE.md](./CLAUDE.md)
- [Architecture And Go Migration](./docs/architecture-and-go-migration.md)
- [Roadmap](./docs/roadmap.md)

## Indexed scan strategy

The hot path is Codex log parsing, not terminal rendering. To reduce refresh overhead:

- each provider keeps a versioned scan index in `~/.config/token-gauge/`
- unchanged files are reused without reopening the log
- append-only files are parsed from the last indexed byte offset
- truncated, rotated, deleted, or version-mismatched files are rebuilt file-by-file

The first run can still be expensive. The steady-state goal is fast repeated refreshes without changing the user-facing output contract.

## Quick start

```sh
git clone https://github.com/zenzenzen/watch-my-token-burn.git
cd watch-my-token-burn
node src/main.js
```

Or install globally for `tg`:

```sh
npm install -g .
tg
```

## Usage

```text
token-gauge [options]

Common options:
  --host <name>          standalone | claude | codex
  --mode <name>          fullscreen | inline
  --format <name>        ansi | plain | json
  --rows <n>             Inline output rows
  --provider <name>      Initial provider tab: claude | codex
  --ascii                Force ASCII-safe rendering
  --once                 Print once and exit
  -h, --help             Show help

Standalone fullscreen options:
  -i, --interval <ms>    Refresh interval in ms
  --autoclear <min>      Auto-clear stale Claude sessions
  --view <mode>          compact | detail
  --budget <amount>      Budget target in USD

Fullscreen detail controls:
  [ / ]                  Switch provider tabs
  , / .                  Cycle detail sub-tabs
  s                      Open settings for the current provider
  a g t m b d p          Toggle Activity / Scoring / Tools / MCP / Bash / Advisor / Period Summary
  e                      Re-enable all analytics panels for the current provider
```

### Config file

`token-gauge` will read defaults from:

```text
~/.config/token-gauge/config.json
```

Precedence is:

- CLI flags
- config file values
- built-in defaults

Example:

```json
{
  "provider": "codex",
  "viewMode": "detail",
  "refreshInterval": 5000,
  "budget": 50,
  "aggregateDir": "/Users/dev/Dropbox/token-gauge-shared",
  "ascii": false
}
```

Supported keys mirror the main CLI settings, including:

- `host`
- `mode`
- `format`
- `rows`
- `provider`
- `view` or `viewMode`
- `interval` or `refreshInterval`
- `autoclear` or `autoClearMinutes`
- `budget`
- `aggregateDir` or `sharedWeeklyDir`
- `ascii`

### Multi-machine weekly aggregation

To combine weekly summaries across multiple machines, point each machine at the same shared directory in `config.json`:

```json
{
  "aggregateDir": "/Users/dev/Dropbox/token-gauge-shared"
}
```

When this is set:

- each machine still keeps its own local weekly files under `~/.config/token-gauge/`
- Claude mirrors to `claude-weekly-<machine>.json`
- Codex mirrors to `codex-weekly-<machine>.json`
- the weekly summary panels merge those machine files into one aggregate view

Claude billed cost remains local-only, so aggregated Claude weekly views intentionally fall back to estimated cost across machines.

### Fullscreen examples

```sh
tg
tg --view detail
tg --provider codex
tg --budget 50
```

In `detail` view, `tg` now keeps the main session overview visible while moving the longer analytics sections into sub-tabs:

- `Overview`
- `Activity`
- `Scoring`
- `Breakdown`
- `Advisor`
- `Summary`
- `Settings`

The `Scoring` sub-tab ranks chats in the selected reporting window by token and context efficiency per turn, making it easier to spot long threads that are doing useful work versus threads that are burning context for each exchange.

The `Settings` sub-tab lets you enable or disable analytics sections independently for Claude and Codex. All analytics panels start enabled by default, and changes are saved back to `~/.config/token-gauge/config.json` so they persist across launches.

### Inline examples

```sh
tg --mode inline --once
tg --mode inline --provider codex --format plain
tg --mode inline --format json --once
```

### Standalone JSON export

```sh
tg --once --format json
```

This emits the full standalone state blob, including:

- Claude sessions
- Claude project billing metrics
- Claude weekly summary
- Codex active/recent session state
- Codex weekly summary

### MCP server

```sh
token-gauge-mcp
```

This starts a stdio MCP server that reuses the standalone full-state JSON shape instead of defining a second schema.

Exposed surfaces:

- resource: `token-gauge://standalone-state`
- tool: `get_standalone_state`

`get_standalone_state` accepts optional overrides for:

- `provider`
- `viewMode`
- `budget`
- `cwd`
- `aggregateDir`

The tool returns the full standalone state in `structuredContent`, and the resource returns the same blob as `application/json`.

Example MCP config:

```json
{
  "mcpServers": {
    "token-gauge": {
      "command": "token-gauge-mcp"
    }
  }
}
```

### Claude Code status line

```json
{
  "statusLine": {
    "type": "command",
    "command": "tg --host claude --mode inline --rows 2"
  }
}
```

### Codex hook adapter

```sh
echo '{"session_id":"s1","context_window":{"current_tokens":24800,"context_window_size":258400},"usage":{"total_tokens":83100}}' \
  | tg --host codex --mode inline --rows 2 --format plain
```

## Benchmarks and tests

Run the test suite:

```sh
node --test
```

Compare full rescans with indexed steady-state collection:

```sh
npm run bench:collectors
```

## Go migration status

This repo now includes an **experimental Go workspace**:

- `cmd/token-gauge`
- `internal/config`
- `internal/scanindex`
- `internal/snapshot`

It is intentionally not the default runtime yet. The Node.js implementation remains the reference behavior until Go collector, snapshot, inline, and TUI parity land.

The Go workspace is there so contributors can start learning and porting the architecture in the planned sequence instead of waiting for a big-bang rewrite.

For local staging, build the Go launcher and keep the Node behavior as a fallback:

```sh
./scripts/build-go-preview.sh
./scripts/tg-local.sh --help
```

`scripts/tg-local.sh` prefers the staged Go binary at `.build/token-gauge-go`, and the Go binary delegates to `src/main.js` until native parity is ready.

## Requirements

- Node.js `>= 18`
- Go `>= 1.22` if you want to explore the experimental Go workspace
- macOS or Linux with local Claude/Codex session directories

## License

MIT
