export const DEFAULT_REFRESH_INTERVAL = 15000;
export const DEFAULT_AUTOCLEAR_MINUTES = 30;
export const DEFAULT_PROVIDER = 'claude';
export const DEFAULT_VIEW_MODE = 'compact';
export const DEFAULT_HOST = 'standalone';
export const DEFAULT_MODE = 'fullscreen';
export const DEFAULT_FORMAT = 'ansi';
export const DEFAULT_INLINE_ROWS = 1;

const PROVIDERS = new Set(['claude', 'codex']);
const VIEW_MODES = new Set(['compact', 'detail']);
const HOSTS = new Set(['standalone', 'claude', 'codex']);
const MODES = new Set(['fullscreen', 'inline']);
const FORMATS = new Set(['ansi', 'plain', 'json']);

function findOption(args, name) {
  const idx = args.findIndex(arg => arg === name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

export function normalizeProvider(value) {
  return PROVIDERS.has(value) ? value : DEFAULT_PROVIDER;
}

export function normalizeViewMode(value) {
  return VIEW_MODES.has(value) ? value : DEFAULT_VIEW_MODE;
}

export function normalizeHost(value) {
  return HOSTS.has(value) ? value : DEFAULT_HOST;
}

export function normalizeMode(value, host = DEFAULT_HOST) {
  if (!value) return host === 'standalone' ? DEFAULT_MODE : 'inline';
  return MODES.has(value) ? value : (host === 'standalone' ? DEFAULT_MODE : 'inline');
}

export function normalizeFormat(value) {
  return FORMATS.has(value) ? value : DEFAULT_FORMAT;
}

export function parseCliArgs(args) {
  const interval = parseInt(findOption(args, '-i') || findOption(args, '--interval'), 10);
  const autoClear = parseInt(findOption(args, '--autoclear'), 10);
  const host = normalizeHost(findOption(args, '--host'));
  const mode = normalizeMode(findOption(args, '--mode'), host);
  const rows = parseInt(findOption(args, '--rows'), 10);

  return {
    host,
    mode,
    format: normalizeFormat(findOption(args, '--format')),
    rows: Number.isFinite(rows) && rows > 0 ? rows : DEFAULT_INLINE_ROWS,
    refreshInterval: Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_REFRESH_INTERVAL,
    autoClearMinutes: Number.isFinite(autoClear) && autoClear > 0 ? autoClear : DEFAULT_AUTOCLEAR_MINUTES,
    provider: normalizeProvider(findOption(args, '--provider')),
    viewMode: normalizeViewMode(findOption(args, '--view')),
    ascii: args.includes('--ascii'),
    watch: args.includes('--watch'),
    once: args.includes('--once'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

export function cycleProvider(current, step = 1) {
  const order = ['claude', 'codex'];
  const idx = Math.max(0, order.indexOf(normalizeProvider(current)));
  return order[(idx + step + order.length) % order.length];
}

export function reduceInput(state, key) {
  const nextState = {
    provider: normalizeProvider(state.provider),
    viewMode: normalizeViewMode(state.viewMode),
  };

  switch (key) {
    case 'q':
    case '\u0003':
      return { state: nextState, action: 'quit' };
    case 'r':
    case ' ':
      return { state: nextState, action: 'refresh' };
    case 'v':
      nextState.viewMode = nextState.viewMode === 'compact' ? 'detail' : 'compact';
      return { state: nextState, action: 'refresh' };
    case '[':
      nextState.provider = cycleProvider(nextState.provider, -1);
      return { state: nextState, action: 'refresh' };
    case ']':
      nextState.provider = cycleProvider(nextState.provider, 1);
      return { state: nextState, action: 'refresh' };
    case 'c':
      if (nextState.provider === 'claude' && nextState.viewMode === 'detail') {
        return { state: nextState, action: 'clear' };
      }
      return { state: nextState, action: 'noop' };
    default:
      return { state: nextState, action: 'refresh' };
  }
}
