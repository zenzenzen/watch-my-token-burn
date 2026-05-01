#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLAUDE_SETTINGS="${HOME}/.claude/settings.json"
CODEX_CONFIG="${HOME}/.codex/config.toml"
CODEX_SNIPPET="${HOME}/.codex/token-gauge.codex-snippet.txt"

INSTALL_GLOBAL=1
INSTALL_CLAUDE=1
INSTALL_CODEX=1
DRY_RUN=0
FORCE_GLOBAL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --no-global)
      INSTALL_GLOBAL=0
      ;;
    --claude-only)
      INSTALL_CLAUDE=1
      INSTALL_CODEX=0
      ;;
    --codex-only)
      INSTALL_CLAUDE=0
      INSTALL_CODEX=1
      ;;
    --force-global)
      FORCE_GLOBAL=1
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

log() {
  printf '%s\n' "$*"
}

run_cmd() {
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

resolve_command() {
  if [[ -x "${REPO_DIR}/scripts/tg-local.sh" ]]; then
    printf '%s/scripts/tg-local.sh' "${REPO_DIR}"
  elif command -v tg >/dev/null 2>&1; then
    printf 'tg'
  elif command -v token-gauge >/dev/null 2>&1; then
    printf 'token-gauge'
  else
    printf 'node %s/src/main.js' "${REPO_DIR}"
  fi
}

install_global_package() {
  if [[ "${INSTALL_GLOBAL}" -ne 1 ]]; then
    return
  fi

  if command -v tg >/dev/null 2>&1 && [[ "${FORCE_GLOBAL}" -ne 1 ]]; then
    log "tg already installed; skipping global npm install"
    return
  fi

  run_cmd npm install -g "${REPO_DIR}"
}

configure_claude() {
  local command
  command="$(resolve_command) --host claude --mode inline --rows 2"

  if [[ "${INSTALL_CLAUDE}" -ne 1 ]]; then
    return
  fi

  run_cmd mkdir -p "${HOME}/.claude"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    log "[dry-run] inject Claude statusLine into ${CLAUDE_SETTINGS}"
    return
  fi

  node - "${CLAUDE_SETTINGS}" "${command}" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const [settingsPath, command] = process.argv.slice(2);
const resolvedPath = fs.existsSync(settingsPath)
  ? fs.realpathSync(settingsPath)
  : settingsPath;

let data = {};
if (fs.existsSync(resolvedPath)) {
  try {
    data = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (error) {
    console.error(`Failed to parse ${resolvedPath}: ${error.message}`);
    process.exit(1);
  }
}

const next = {
  ...data,
  statusLine: {
    ...(data.statusLine || {}),
    type: 'command',
    command,
  },
};

fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
fs.writeFileSync(resolvedPath, `${JSON.stringify(next, null, 2)}\n`);
NODE

  log "Configured Claude statusLine in ${CLAUDE_SETTINGS}"
}

configure_codex() {
  local command
  command="$(resolve_command) --host codex --mode inline --rows 2"

  if [[ "${INSTALL_CODEX}" -ne 1 ]]; then
    return
  fi

  run_cmd mkdir -p "${HOME}/.codex"

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    log "[dry-run] stage Codex adapter snippet in ${CODEX_SNIPPET}"
    log "[dry-run] annotate ${CODEX_CONFIG} with token-gauge comment block"
    return
  fi

  cat > "${CODEX_SNIPPET}" <<EOF
# token-gauge Codex adapter
#
# Native footer/status-line injection is not currently configured through
# ~/.codex/config.toml in this installer because a supported footer command
# key has not been confirmed locally.
#
# Adapter command when a host/footer hook becomes available:
${command}
EOF

  touch "${CODEX_CONFIG}"
  if ! grep -q "token-gauge Codex adapter" "${CODEX_CONFIG}"; then
    {
      printf '\n'
      printf '# token-gauge Codex adapter\n'
      printf '# Native footer injection is not enabled here because no supported\n'
      printf '# config.toml footer/statusLine key was confirmed locally.\n'
      printf '# Prepared adapter command:\n'
      printf '# %s\n' "${command}"
      printf '# See: %s\n' "${CODEX_SNIPPET}"
    } >> "${CODEX_CONFIG}"
  fi

  log "Staged Codex adapter note in ${CODEX_SNIPPET}"
}

install_global_package
configure_claude
configure_codex

log "Done"
