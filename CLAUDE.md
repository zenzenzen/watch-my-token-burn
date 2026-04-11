# Contributor Context

## Current truth

- The Node.js implementation in `src/` is the production reference.
- The Go workspace is intentionally parallel and incomplete; do not treat it as source-of-truth behavior yet.
- Refresh cost is dominated by Codex log parsing. Optimize collection before touching rendering.

## Working sequence

1. Keep Node behavior correct while improving scan/index performance.
2. Use docs in `docs/` as the canonical migration spec.
3. Port Go in this order:
   - scan/index
   - collectors
   - tracker/snapshot
   - inline renderer
   - fullscreen TUI
   - install and packaging

## Architecture boundaries

- `collector.js` and `codex.js` own provider-specific file discovery and parsing.
- `scan-index.js` owns persisted file reuse and append-only delta parsing.
- `tracker.js` and `codex-tracker.js` own weekly persisted summaries.
- `snapshot.js` is the transport contract. Keep its JSON shape stable.
- `ui.js` is fullscreen-only. Do not couple fullscreen concerns back into snapshot transport.
- `inline.js` is the compact output contract for hooks and scripting.

## Rules for changes

- Preserve CLI flags and output semantics unless a user-facing behavior change is explicit.
- Prefer benchmarkable collector changes over speculative abstraction.
- Provider abstraction is deferred until after the Go port reaches parity.
- When adding tests, favor temp-dir fixtures for file I/O and golden-ish assertions for snapshot/render parity.

## Local commands

```sh
node --test
npm run bench:collectors
go test ./...
go run ./cmd/token-gauge --help
```

## Migration mindset

- JS is optimized for shipping and behavior reference.
- Go is optimized for long-term runtime efficiency and stronger typing.
- During the migration, the highest-value docs are the ones that explain why modules exist and what contracts must not drift.
