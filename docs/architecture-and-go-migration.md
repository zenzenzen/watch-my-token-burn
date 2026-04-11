# Architecture And Go Migration

## Runtime architecture

The current production path is:

1. provider collector reads local session metadata
2. scan index decides whether each `.jsonl` file is unchanged, append-only, or needs rebuild
3. tracker builds weekly aggregates
4. snapshot normalizes local or hook payloads for inline mode
5. fullscreen UI renders directly from collector structs
6. inline renderer renders from snapshot structs

Important consequence:

- fullscreen and inline are intentionally separate data flows
- snapshot shape is a transport contract and should stay compact
- collector structs can stay richer without leaking into hook output

## Scan index lifecycle

Each provider keeps a versioned JSON index in `~/.config/token-gauge/`.

Each indexed file record stores:

- source path
- file size
- file mtime
- byte offset used for append-only delta parsing
- latest timestamp seen
- provider-specific parsed payload

Behavior rules:

- unchanged file: reuse payload, do not reopen the log
- appended file: read from last indexed byte offset, merge new records into prior payload
- truncated or rotated file: rebuild that file from byte zero
- missing file: prune the index entry
- version mismatch: discard old entries and rebuild on demand

This is the shared design target for the Go port too.

## JS module responsibilities

| JS module | Responsibility | Go destination |
|-----------|----------------|----------------|
| `src/scan-index.js` | persisted file index and delta reads | `internal/scanindex` |
| `src/collector.js` | Claude discovery and token aggregation | `internal/collector/claude` |
| `src/codex.js` | Codex discovery and token aggregation | `internal/collector/codex` |
| `src/tracker.js` | Claude weekly persistence | `internal/tracker` |
| `src/codex-tracker.js` | Codex weekly persistence | `internal/tracker` |
| `src/snapshot.js` | inline/hook snapshot transport | `internal/snapshot` |
| `src/inline.js` | inline rendering | `internal/render/inline` |
| `src/ui.js` | fullscreen TUI | `internal/render/tui` |
| `src/state.js` | CLI parsing, `~/.config/token-gauge/config.json` loading, and keyboard state | `internal/config` plus app state package |
| `src/main.js` | app routing | `cmd/token-gauge` and `internal/app` |

## Go translation conventions

Use these conventions consistently while porting:

- Package boundaries should follow responsibility, not file-for-file mirroring.
- Export only stable cross-package types; keep provider-specific parsing helpers unexported.
- Prefer explicit structs over `map[string]any` once a shape is known.
- Match snapshot JSON field names exactly with `json` tags.
- Use `time.Time` internally, but convert to epoch seconds or RFC3339 strings only at contract boundaries.
- Keep path joins in `filepath`, but be careful where the original JS behavior expects slash-style labels.
- Return `(value, error)` rather than silently swallowing failures, except where behavior intentionally degrades for unreadable local logs.
- Preserve “best effort” semantics: malformed JSONL lines should not kill collection.
- Keep append-only parsing byte-oriented and provider payload merging record-oriented.
- For rendering, start with deterministic text output and only then add ANSI/color helpers.
- Prefer table-driven tests for config parsing and golden tests for snapshot/render parity.

## Translation quirks from JS to Go

- JS frequently treats missing numbers as `0`; in Go, be explicit about zero values versus missing values when the JSON contract distinguishes them.
- JS object omission maps to pointer fields or `omitempty` tags in Go.
- JS `null` in snapshot output should usually map to `nil` pointers in Go, not zero-value structs.
- JS collectors are synchronous and forgiving; Go can still stay synchronous at first. Do not introduce concurrency until parity and benchmarks demand it.
- The TUI should not be the first Go target. The collector/index path provides more leverage and less behavior risk.

## Staged parity checklist

1. Port scan index read/write and file-state transitions.
2. Port Claude and Codex collectors against existing fixtures.
3. Port weekly trackers with temp-dir tests.
4. Port snapshot structs and snapshot builders.
5. Add inline renderer parity tests.
6. Port fullscreen TUI last, using the JS output as behavioral reference.

Node stays the production entrypoint until all six stages are green.
