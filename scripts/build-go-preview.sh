#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUT_DIR="${REPO_DIR}/.build"
OUT_BIN="${OUT_DIR}/token-gauge-go"

mkdir -p "${OUT_DIR}"
go build -o "${OUT_BIN}" ./cmd/token-gauge

printf '%s\n' "${OUT_BIN}"
