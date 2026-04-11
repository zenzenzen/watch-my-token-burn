# Post-Optimization Roadmap

This backlog starts **after** the indexed scan/parsing work. The priorities below are ordered by leverage and dependency, not by novelty.

Provider abstraction is intentionally deferred until after Go parity lands so we do not abstract unstable behavior twice.

## P0

### [P0] Add cache hit ratio to compact/detail/inline views

- Surface a first-class cache efficiency signal for Claude and Codex.
- Use existing collector totals rather than inventing new storage.
- Dependency: none beyond the indexed collector work.

### [P0] Add tracker persistence tests for Claude and Codex weekly stores

- Expand file-I/O regression coverage beyond the current temp-dir tests.
- Focus on pruning, date bucketing, serialization, and fallback behavior.
- Dependency: none.

### [P0] Split Claude cost display into estimated session cost vs billed project cost

- Wire `collectProjectMetrics` into a visible project billing panel.
- Distinguish local token-derived estimates from `~/.claude.json` billing snapshots.
- Dependency: none.

## P1

### [P1] Add full-state JSON export for standalone `--once`

- Emit a complete structured state blob for scripting and external aggregation.
- Keep existing inline JSON snapshot behavior unchanged.
- Dependency: stable snapshot and collector contracts.

### [P1] Add Claude rate-limit persistence and detail-panel parity

- Persist or merge Claude hook-sourced rate-limit data into the standalone detail view.
- Dependency: snapshot/local data contract decision.

### [P1] Add config file support under `~/.config/token-gauge/config.json`

- Config should provide defaults that CLI flags override.
- Dependency: no major dependency, but easier after current config behavior is well documented.

### [P1] Add session burn-rate and timeline view

- Introduce an intra-session token/time visualization.
- Dependency: reliable per-session time-series extraction.

## P2

### [P2] Add token efficiency advisor

- Turn collected metrics into suggestions about cache churn, context pressure, and rate-limit patterns.
- Dependency: cache ratio, burn rate, and clearer cost semantics.

### [P2] Expose token-gauge data via MCP

- Make current usage queryable from other agent tools and sessions.
- Dependency: stable full-state JSON shape.

### [P2] Add multi-machine weekly aggregation

- Merge multiple weekly summaries into one aggregate view.
- Dependency: stable weekly schema and exported state shape.

### [P2] Evaluate provider abstraction after Go parity lands

- Revisit interface extraction only once the Go and Node implementations agree on stable boundaries.
- Dependency: Go collector/snapshot parity.
