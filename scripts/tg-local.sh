#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GO_BIN="${REPO_DIR}/.build/token-gauge-go"
NODE_ENTRY="${REPO_DIR}/src/main.js"

if [[ -x "${GO_BIN}" ]]; then
  if TOKEN_GAUGE_REPO_DIR="${REPO_DIR}" TOKEN_GAUGE_NODE_ENTRYPOINT="${NODE_ENTRY}" "${GO_BIN}" "$@"; then
    exit 0
  fi
  printf 'token-gauge launcher: Go preview failed, falling back to Node.js\n' >&2
fi

exec node "${NODE_ENTRY}" "$@"
