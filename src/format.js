const ANSI_REGEX = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(value) {
  return String(value || '').replace(ANSI_REGEX, '');
}

export function formatModelName(model) {
  if (model === 'claude-opus-4-6') return 'Opus 4.6';
  if (model === 'claude-sonnet-4-6') return 'Sonnet 4.6';
  if (model === 'claude-haiku-4-5-20251001') return 'Haiku 4.5';
  if (!model || model === 'unknown') return 'unknown';
  return model.replace(/^claude-/, '').replace(/-/g, ' ');
}

export function basenameLabel(path) {
  if (!path) return 'unknown';
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.split('/').pop() || trimmed;
}

export function primaryClaudeSession(sessions) {
  return sessions.find(session => session.alive) || sessions[0] || null;
}
