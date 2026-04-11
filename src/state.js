import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTokenGaugeConfigDir } from './scan-index.js';

export const DEFAULT_REFRESH_INTERVAL = 15000;
export const DEFAULT_AUTOCLEAR_MINUTES = 30;
export const DEFAULT_PROVIDER = 'claude';
export const DEFAULT_VIEW_MODE = 'compact';
export const DEFAULT_HOST = 'standalone';
export const DEFAULT_MODE = 'fullscreen';
export const DEFAULT_FORMAT = 'ansi';
export const DEFAULT_INLINE_ROWS = 1;
export const DEFAULT_CONFIG_FILENAME = 'config.json';

const PROVIDERS = new Set(['claude', 'codex']);
const VIEW_MODES = new Set(['compact', 'detail']);
const HOSTS = new Set(['standalone', 'claude', 'codex']);
const MODES = new Set(['fullscreen', 'inline']);
const FORMATS = new Set(['ansi', 'plain', 'json']);

function findOption(args, name) {
  const idx = args.findIndex(arg => arg === name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

export function resolveConfigFilePath({ configDir = null, configFilePath = null } = {}) {
  if (configFilePath) return configFilePath;
  return join(resolveTokenGaugeConfigDir(configDir), DEFAULT_CONFIG_FILENAME);
}

function loadConfigFile({ configDir = null, configFilePath = null } = {}) {
  const path = resolveConfigFilePath({ configDir, configFilePath });

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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

export function parseCliArgs(args, opts = {}) {
  const fileConfig = loadConfigFile(opts);

  const cliHost = findOption(args, '--host');
  const cliMode = findOption(args, '--mode');
  const host = normalizeHost(cliHost ?? fileConfig.host);
  const mode = normalizeMode(cliMode ?? fileConfig.mode, host);
  const cliInterval = findOption(args, '-i') || findOption(args, '--interval');
  const cliAutoClear = findOption(args, '--autoclear');
  const cliRows = findOption(args, '--rows');
  const cliBudget = findOption(args, '--budget');
  const cliProvider = findOption(args, '--provider');
  const cliViewMode = findOption(args, '--view');
  const cliFormat = findOption(args, '--format');

  return {
    host,
    mode,
    format: normalizeFormat(cliFormat ?? fileConfig.format),
    rows: parsePositiveInt(cliRows ?? fileConfig.rows, DEFAULT_INLINE_ROWS),
    refreshInterval: parsePositiveInt(
      cliInterval ?? fileConfig.refreshInterval ?? fileConfig.interval,
      DEFAULT_REFRESH_INTERVAL,
    ),
    autoClearMinutes: parsePositiveInt(
      cliAutoClear ?? fileConfig.autoClearMinutes ?? fileConfig.autoclear,
      DEFAULT_AUTOCLEAR_MINUTES,
    ),
    provider: normalizeProvider(cliProvider ?? fileConfig.provider),
    viewMode: normalizeViewMode(cliViewMode ?? fileConfig.viewMode ?? fileConfig.view),
    budget: parsePositiveFloat(cliBudget ?? fileConfig.budget, 0),
    aggregateDir: typeof (fileConfig.aggregateDir ?? fileConfig.sharedWeeklyDir) === 'string'
      ? (fileConfig.aggregateDir ?? fileConfig.sharedWeeklyDir).trim() || null
      : null,
    ascii: args.includes('--ascii') || parseBoolean(fileConfig.ascii, false),
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
      return { state: nextState, action: 'noop' };
  }
}
