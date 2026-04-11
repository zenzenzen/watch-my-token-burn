# CLAUDE.md — AI Assistant Guide for watch-my-token-burn

## Project Overview

**watch-my-token-burn** (npm package: `token-gauge`) is a zero-dependency Node.js terminal dashboard that tracks token usage, context window consumption, and estimated costs for Claude Code and OpenAI Codex sessions in real time.

- **Binary names:** `tg` and `token-gauge` (both point to `src/main.js`)
- **Runtime:** Node.js >= 18, ES Modules (`"type": "module"`)
- **Zero dependencies:** uses only Node.js stdlib (fs, path, os, assert, node:test)
- **Platforms:** macOS and Linux

---

## Repository Structure

```
watch-my-token-burn/
├── src/
│   ├── main.js        # Entry point — routes fullscreen, inline, and hook modes
│   ├── state.js       # CLI arg parsing and keyboard input state machine
│   ├── collector.js   # Claude Code session data reader (~/.claude/)
│   ├── codex.js       # OpenAI Codex session data reader (~/.codex/)
│   ├── snapshot.js    # Normalizes collector/hook data into unified snapshot shape
│   ├── tracker.js     # 7-day rolling token aggregates (~/.config/token-gauge/)
│   ├── ui.js          # Fullscreen TUI renderer (compact + detail views)
│   └── inline.js      # Inline/status-bar renderer
├── test/
│   ├── collector.test.js
│   ├── codex.test.js
│   ├── inline.test.js
│   ├── snapshot.test.js
│   ├── state.test.js
│   ├── ui.test.js
│   └── fixtures/
│       ├── claude/.claude/     # Sample Claude session JSON + JSONL files
│       └── codex/.codex/       # Sample Codex session_index.jsonl + session logs
├── scripts/
│   └── install-tg.sh   # Global install + Claude/Codex hook configuration
├── package.json
└── README.md
```

---

## Development Commands

```sh
npm start                 # Run the dashboard (node src/main.js)
npm run dev               # Run with live reload (node --watch src/main.js)
npm test                  # Run all tests (node --test)
npm run install:local     # Global install + hook setup via scripts/install-tg.sh
npm run install:dry-run   # Preview install steps without executing
```

### Running a Specific Test File

```sh
node --test test/collector.test.js
node --test test/ui.test.js
```

---

## Architecture & Data Flow

```
Local Mode:
  ~/.claude/sessions/   →  collector.js
  ~/.claude/projects/   →  collector.js  →  snapshot.js  →  ui.js / inline.js
  ~/.codex/             →  codex.js      →  snapshot.js  →  ui.js / inline.js
  ~/.config/token-gauge/ ← tracker.js (persists weekly data)

Hook Mode (stdin):
  Claude statusLine JSON  →  main.js (readStdinJson)  →  snapshot.js  →  inline.js
  Codex hook JSON         →  main.js (readStdinJson)  →  snapshot.js  →  inline.js
```

All paths converge on a single **unified snapshot shape** (defined in `src/snapshot.js`) before rendering. Both local collection and hook stdin payloads produce the same snapshot object.

---

## Key Module Roles

| Module | Responsibility |
|--------|---------------|
| `src/main.js` | Entry point; `FullscreenApp` class (TUI loop), `InlineApp` class, hook adapter, signal handlers |
| `src/state.js` | `parseCliArgs()`, `reduceInput()` (keyboard FSM), `cycleProvider()`, normalize helpers |
| `src/collector.js` | Reads `~/.claude/sessions/*.json` and `~/.claude/projects/**/*.jsonl`; exports `collectSessions()` and `collectSessionsInRange()` |
| `src/codex.js` | Reads `~/.codex/session_index.jsonl` and `~/.codex/sessions/YYYY/MM/DD/*.jsonl`; exports `collectCodexData()` |
| `src/snapshot.js` | Exports `collectLocalSnapshot()`, `createClaudeHookSnapshot()`, `createCodexHookSnapshot()`; contains hardcoded model pricing |
| `src/tracker.js` | Persists 7-day rolling totals to `~/.config/token-gauge/weekly.json`; exports `refreshWeeklyData()` |
| `src/ui.js` | Exports `renderDashboard(state)`; handles compact/detail for both providers; powerline rendering, context bars, weekly chart |
| `src/inline.js` | Exports `renderInlineSnapshot(snapshot, options)`; builds colored badge segments |

---

## Unified Snapshot Shape

All rendering functions consume this shape (defined in `src/snapshot.js`):

```javascript
{
  version: 1,
  host,           // 'standalone' | 'claude' | 'codex'
  provider,       // 'claude' | 'codex'
  sessionId,
  title,
  sessionLabel,
  workspaceLabel,
  cwd,
  modelId,
  modelLabel,
  statusLabel,
  totalTokens,
  contextTokens,
  contextWindow,
  costUsd,
  lastTokens,
  primaryLimit,   // { label, usedPercent, resetsAt }
  secondaryLimit,
  meta: { /* provider-specific */ }
}
```

---

## Session Data Shapes

### Claude Session (from `collector.js`)

```javascript
{
  sessionId, shortId, pid, alive, cwd, projectName, startedAt, kind, model,
  context: { active, loaded, stale, total },
  totals: {
    totalInput, totalOutput, totalCacheRead, totalCacheCreate, totalTokens,
    latestInput, latestOutput, latestTotal, messageCount
  }
}
```

- Source: `~/.claude/sessions/[PID].json` (metadata) + `~/.claude/projects/*/[sessionId].jsonl` (usage events)
- Alive check: `process.kill(pid, 0)` — sessions with no alive PID are stale

### Codex Session (from `codex.js`)

```javascript
{
  id, threadName, cwd, workspaceLabel, latestTimestamp, providerLabel, modelLabel,
  totalTokens, totalInputTokens, totalCachedInputTokens, totalOutputTokens,
  totalReasoningOutputTokens, lastTokens, lastInputTokens, lastCachedInputTokens,
  lastOutputTokens, lastReasoningOutputTokens, currentContextTokens, modelContextWindow,
  rateLimits, liveDataFound, filePath
}
```

- Source: `~/.codex/session_index.jsonl` (index) + `~/.codex/sessions/YYYY/MM/DD/*.jsonl` (events)
- Active session selection: matches on `cwd`, falls back to most recent

---

## Persistent Storage

| File | Purpose |
|------|---------|
| `~/.config/token-gauge/weekly.json` | 7-day rolling daily token aggregates |

No SQL databases. No external APIs. No `.env` files — configuration is via CLI args only.

---

## Model Pricing (hardcoded in `src/snapshot.js` and `src/ui.js`)

Per 1M tokens:

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| Opus 4.6 | $15 | $75 | $1.875 | $18.75 |
| Sonnet 4.6 | $3 | $15 | $0.375 | $3.75 |
| Haiku 4.5 | $0.80 | $4 | $0.08 | $1 |

When adding support for new models, update the pricing tables in **both** `src/snapshot.js` and `src/ui.js`.

---

## CLI Flags & Defaults

Parsed by `parseCliArgs()` in `src/state.js`:

| Flag | Values | Default |
|------|--------|---------|
| `--host` | `standalone \| claude \| codex` | `standalone` |
| `--mode` | `fullscreen \| inline` | `fullscreen` |
| `--provider` | `claude \| codex` | `claude` |
| `--view` | `compact \| detail` | `compact` |
| `--format` | `ansi \| plain \| json` | `ansi` |
| `--rows` | integer | `1` |
| `--interval` / `-i` | ms | `15000` |
| `--autoclear` | minutes | `30` |
| `--ascii` | boolean flag | auto-detected from locale |
| `--once` | boolean flag | `false` |
| `--watch` | boolean flag | `false` |
| `--help` / `-h` | boolean flag | — |

---

## Keyboard Shortcuts (Fullscreen Mode)

Handled by `reduceInput()` in `src/state.js`:

| Key | Action |
|-----|--------|
| `q` / `Ctrl+C` | Quit |
| `r` / `Space` | Force refresh |
| `v` | Toggle compact/detail |
| `[` | Previous provider tab |
| `]` | Next provider tab |
| `c` | Clear stale sessions (Claude detail view only) |

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `LC_ALL`, `LC_CTYPE`, `LANG` | Locale detection for ASCII fallback |
| `TG_ASCII` | Force ASCII mode if set to `'1'` or `'true'` |
| `HOME` | Resolved via `os.homedir()` for `~/.claude/`, `~/.codex/`, `~/.config/` paths |

---

## Testing

**Framework:** Node.js built-in `node:test` + `node:assert/strict`

**Run all tests:**
```sh
npm test
# or
node --test
```

Test files are in `test/` and use file-based fixtures in `test/fixtures/`:
- `test/fixtures/claude/.claude/` — Claude session JSON + project JSONL files
- `test/fixtures/codex/.codex/` — Codex session index + session JSONL files

### Test Fixture Data

- **Claude fixture:** Opus 4.6 session, 5,500 total tokens, 3,400 context tokens, 1 message
- **Codex fixture:** Two sessions — one with 83,100 tokens matching cwd `/Users/dev/ai-gen-tooling`, one with 0 tokens

When adding new collector features, add matching fixture data rather than mocking filesystem calls. Fixture files live alongside other fixtures and are committed to the repo.

---

## Rendering Conventions

### ANSI Terminal Control

- ESC prefix: `'\x1b['`
- 24-bit RGB colors: `\x1b[38;2;R;G;Bm` (foreground), `\x1b[48;2;R;G;Bm` (background)
- Reset: `\x1b[0m`
- Cursor: `\x1b[?25l` (hide), `\x1b[?25h` (show)
- Alternate screen: `\x1b[?1049h` / `\x1b[?1049l`

### ASCII Fallback

Auto-detected from locale env vars; can be forced with `--ascii` or `TG_ASCII=1`. In ASCII mode:
- Powerline arrows (`◄`) → `>`
- Line glyphs (`─`) → `-`
- Bullet glyphs (`●`, `○`) → `*`, `o`
- Ellipsis (`…`) → `...`

### Width Constraints

- Max content width: 140 characters (respects narrower terminals)
- `fitAnsiLine()` in `src/ui.js` truncates with ellipsis while preserving ANSI escape codes

### Powerline Segments

Rendered by `renderPowerline(segments)` in `src/ui.js`. Each segment:
```javascript
{ text: string, fg: [r,g,b], bg: [r,g,b] }
```

---

## Code Conventions

1. **Pure functions preferred** — formatting helpers (tokens, cost, duration, colors) are side-effect-free
2. **Defensive file I/O** — always wrap `readFileSync` / `JSON.parse` in try-catch; use `existsSync` before reading
3. **No global state mutations** — state is passed as parameters and returned as new objects
4. **Normalize at boundaries** — raw provider data is normalized in collector/codex modules before being passed to snapshot; snapshot normalizes before reaching renderers
5. **Fallback gracefully** — missing fields should degrade to zero/empty rather than throwing
6. **Rate limit field name variants** — Codex rate limit objects use inconsistent field names (`used_percent` vs `used_percentage`, `resets_at` vs `reset_at`); handle all variants in `src/snapshot.js`
7. **Lifecycle cleanup** — always restore terminal state (show cursor, leave alt screen, restore stdin raw mode) in SIGINT/SIGTERM handlers and quit paths

---

## Adding a New Provider

1. Create `src/<provider>.js` with a `collect<Provider>Data(opts)` export returning a normalized session array
2. Add `create<Provider>LocalSnapshot()` and `create<Provider>HookSnapshot()` in `src/snapshot.js`
3. Add compact and detail rendering functions to `src/ui.js`
4. Add inline segment building in `src/inline.js`
5. Register the provider in `normalizeProvider()` in `src/state.js`
6. Add tab cycling support in `cycleProvider()` in `src/state.js`
7. Add fixture files under `test/fixtures/<provider>/` and write tests in `test/<provider>.test.js`

---

## Install Script (`scripts/install-tg.sh`)

Handles end-user global setup. Flags:
- `--dry-run` — preview without executing
- `--no-global` — skip `npm install -g`
- `--claude-only` / `--codex-only` — target one host only
- `--force-global` — reinstall even if `tg` already exists

The script injects a `statusLine` config into `~/.claude/settings.json` via an embedded Node.js snippet and stages a Codex adapter snippet at `~/.codex/token-gauge.codex-snippet.txt`.

---

## What This Project Is Not

- Not a web app — no HTTP server, no frontend framework
- Not a database-backed app — only flat JSON files on disk
- Not an API consumer — no outbound network calls; all data is local
- Not a build step required — run directly with `node src/main.js`
