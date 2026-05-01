import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveTokenGaugeConfigDir } from './scan-index.js';

export const DEFAULT_REFRESH_INTERVAL = 15000;
export const DEFAULT_AUTOCLEAR_MINUTES = 30;
export const DEFAULT_PROVIDER = 'claude';
export const DEFAULT_VIEW_MODE = 'compact';
export const DEFAULT_PERIOD = '7d';
export const DEFAULT_DETAIL_TAB = 'overview';
export const DEFAULT_HOST = 'standalone';
export const DEFAULT_MODE = 'fullscreen';
export const DEFAULT_FORMAT = 'ansi';
export const DEFAULT_INLINE_ROWS = 1;
export const DEFAULT_CONFIG_FILENAME = 'config.json';

const PROVIDERS = new Set(['claude', 'codex']);
const VIEW_MODES = new Set(['compact', 'detail']);
const PERIODS = new Set(['today', '7d', '30d', 'month']);
const DETAIL_TABS = new Set(['overview', 'activity', 'scoring', 'breakdown', 'advisor', 'summary', 'settings']);
const HOSTS = new Set(['standalone', 'claude', 'codex']);
const MODES = new Set(['fullscreen', 'inline']);
const FORMATS = new Set(['ansi', 'plain', 'json']);
const ANALYTICS_PANELS = ['activity', 'scoring', 'tools', 'mcp', 'bash', 'advisor', 'summary'];

const DEFAULT_ANALYTICS_VISIBILITY = Object.freeze({
  claude: Object.freeze({
    activity: true,
    scoring: true,
    tools: true,
    mcp: true,
    bash: true,
    advisor: true,
    summary: true,
  }),
  codex: Object.freeze({
    activity: true,
    scoring: true,
    tools: true,
    mcp: true,
    bash: true,
    advisor: true,
    summary: true,
  }),
});

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

export function normalizePeriod(value) {
  return PERIODS.has(value) ? value : DEFAULT_PERIOD;
}

export function normalizeDetailTab(value) {
  return DETAIL_TABS.has(value) ? value : DEFAULT_DETAIL_TAB;
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

function cloneDefaultAnalyticsVisibility() {
  return {
    claude: { ...DEFAULT_ANALYTICS_VISIBILITY.claude },
    codex: { ...DEFAULT_ANALYTICS_VISIBILITY.codex },
  };
}

export function normalizeAnalyticsVisibility(value) {
  const normalized = cloneDefaultAnalyticsVisibility();

  if (!value || typeof value !== 'object') {
    return normalized;
  }

  for (const provider of PROVIDERS) {
    const candidate = value[provider];
    if (!candidate || typeof candidate !== 'object') continue;

    for (const panel of ANALYTICS_PANELS) {
      if (typeof candidate[panel] === 'boolean') {
        normalized[provider][panel] = candidate[panel];
      }
    }
  }

  return normalized;
}

export function getDetailTabsForProvider(provider, analyticsVisibility) {
  const normalizedProvider = normalizeProvider(provider);
  const visibility = normalizeAnalyticsVisibility(analyticsVisibility)[normalizedProvider];
  const tabs = ['overview'];

  if (visibility.activity) tabs.push('activity');
  if (visibility.scoring) tabs.push('scoring');
  if (visibility.tools || visibility.mcp || visibility.bash) tabs.push('breakdown');
  if (visibility.advisor) tabs.push('advisor');
  if (visibility.summary) tabs.push('summary');

  tabs.push('settings');
  return tabs;
}

export function ensureDetailTab(detailTab, provider, analyticsVisibility) {
  const tabs = getDetailTabsForProvider(provider, analyticsVisibility);
  const normalized = normalizeDetailTab(detailTab);
  return tabs.includes(normalized) ? normalized : tabs[0];
}

export function cycleDetailTab(current, provider, analyticsVisibility, step = 1) {
  const tabs = getDetailTabsForProvider(provider, analyticsVisibility);
  const currentTab = ensureDetailTab(current, provider, analyticsVisibility);
  const idx = Math.max(0, tabs.indexOf(currentTab));
  return tabs[(idx + step + tabs.length) % tabs.length];
}

export function toggleAnalyticsPanel(analyticsVisibility, provider, panel) {
  const normalizedProvider = normalizeProvider(provider);
  if (!ANALYTICS_PANELS.includes(panel)) {
    return normalizeAnalyticsVisibility(analyticsVisibility);
  }

  const next = normalizeAnalyticsVisibility(analyticsVisibility);
  next[normalizedProvider][panel] = !next[normalizedProvider][panel];
  return next;
}

export function enableAllAnalyticsPanels(analyticsVisibility, provider) {
  const normalizedProvider = normalizeProvider(provider);
  const next = normalizeAnalyticsVisibility(analyticsVisibility);

  for (const panel of ANALYTICS_PANELS) {
    next[normalizedProvider][panel] = true;
  }

  return next;
}

export function parseCliArgs(args, opts = {}) {
  const fileConfig = loadConfigFile(opts);
  const configFilePath = resolveConfigFilePath(opts);

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
  const cliPeriod = findOption(args, '--period');
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
    period: normalizePeriod(cliPeriod ?? fileConfig.period),
    detailTab: normalizeDetailTab(fileConfig.detailTab),
    analyticsVisibility: normalizeAnalyticsVisibility(fileConfig.analyticsVisibility),
    configFilePath,
    budget: parsePositiveFloat(cliBudget ?? fileConfig.budget, 0),
    aggregateDir: typeof (fileConfig.aggregateDir ?? fileConfig.sharedWeeklyDir) === 'string'
      ? (fileConfig.aggregateDir ?? fileConfig.sharedWeeklyDir).trim() || null
      : null,
    ascii: args.includes('--ascii') || parseBoolean(fileConfig.ascii, false),
    once: args.includes('--once'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

export function saveAnalyticsVisibilityConfig(analyticsVisibility, opts = {}) {
  const configFilePath = resolveConfigFilePath(opts);
  const nextConfig = {
    ...loadConfigFile({ configFilePath }),
    analyticsVisibility: normalizeAnalyticsVisibility(analyticsVisibility),
  };

  mkdirSync(dirname(configFilePath), { recursive: true });
  writeFileSync(configFilePath, `${JSON.stringify(nextConfig, null, 2)}\n`);

  return configFilePath;
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
    period: normalizePeriod(state.period),
    detailTab: ensureDetailTab(state.detailTab, state.provider, state.analyticsVisibility),
    analyticsVisibility: normalizeAnalyticsVisibility(state.analyticsVisibility),
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
      nextState.detailTab = ensureDetailTab(nextState.detailTab, nextState.provider, nextState.analyticsVisibility);
      return { state: nextState, action: 'redraw' };
    case '[':
      nextState.provider = cycleProvider(nextState.provider, -1);
      nextState.detailTab = ensureDetailTab(nextState.detailTab, nextState.provider, nextState.analyticsVisibility);
      return { state: nextState, action: 'redraw' };
    case ']':
      nextState.provider = cycleProvider(nextState.provider, 1);
      nextState.detailTab = ensureDetailTab(nextState.detailTab, nextState.provider, nextState.analyticsVisibility);
      return { state: nextState, action: 'redraw' };
    case ',':
      if (nextState.viewMode !== 'detail') {
        return { state: nextState, action: 'noop' };
      }
      nextState.detailTab = cycleDetailTab(nextState.detailTab, nextState.provider, nextState.analyticsVisibility, -1);
      return { state: nextState, action: 'redraw' };
    case '.':
      if (nextState.viewMode !== 'detail') {
        return { state: nextState, action: 'noop' };
      }
      nextState.detailTab = cycleDetailTab(nextState.detailTab, nextState.provider, nextState.analyticsVisibility, 1);
      return { state: nextState, action: 'redraw' };
    case 's':
      if (nextState.viewMode !== 'detail') {
        return { state: nextState, action: 'noop' };
      }
      nextState.detailTab = 'settings';
      return { state: nextState, action: 'redraw' };
    case 'a':
      if (nextState.viewMode !== 'detail' || nextState.detailTab !== 'settings') {
        return { state: nextState, action: 'noop' };
      }
      nextState.analyticsVisibility = toggleAnalyticsPanel(nextState.analyticsVisibility, nextState.provider, 'activity');
      nextState.detailTab = ensureDetailTab(nextState.detailTab, nextState.provider, nextState.analyticsVisibility);
      return { state: nextState, action: 'redraw' };
    case 't':
      if (nextState.viewMode !== 'detail' || nextState.detailTab !== 'settings') {
        return { state: nextState, action: 'noop' };
      }
      nextState.analyticsVisibility = toggleAnalyticsPanel(nextState.analyticsVisibility, nextState.provider, 'tools');
      nextState.detailTab = ensureDetailTab(nextState.detailTab, nextState.provider, nextState.analyticsVisibility);
      return { state: nextState, action: 'redraw' };
    case 'g':
      if (nextState.viewMode !== 'detail' || nextState.detailTab !== 'settings') {
        return { state: nextState, action: 'noop' };
      }
      nextState.analyticsVisibility = toggleAnalyticsPanel(nextState.analyticsVisibility, nextState.provider, 'scoring');
      nextState.detailTab = ensureDetailTab(nextState.detailTab, nextState.provider, nextState.analyticsVisibility);
      return { state: nextState, action: 'redraw' };
    case 'm':
      if (nextState.viewMode !== 'detail' || nextState.detailTab !== 'settings') {
        return { state: nextState, action: 'noop' };
      }
      nextState.analyticsVisibility = toggleAnalyticsPanel(nextState.analyticsVisibility, nextState.provider, 'mcp');
      nextState.detailTab = ensureDetailTab(nextState.detailTab, nextState.provider, nextState.analyticsVisibility);
      return { state: nextState, action: 'redraw' };
    case 'b':
      if (nextState.viewMode !== 'detail' || nextState.detailTab !== 'settings') {
        return { state: nextState, action: 'noop' };
      }
      nextState.analyticsVisibility = toggleAnalyticsPanel(nextState.analyticsVisibility, nextState.provider, 'bash');
      nextState.detailTab = ensureDetailTab(nextState.detailTab, nextState.provider, nextState.analyticsVisibility);
      return { state: nextState, action: 'redraw' };
    case 'd':
      if (nextState.viewMode !== 'detail' || nextState.detailTab !== 'settings') {
        return { state: nextState, action: 'noop' };
      }
      nextState.analyticsVisibility = toggleAnalyticsPanel(nextState.analyticsVisibility, nextState.provider, 'advisor');
      nextState.detailTab = ensureDetailTab(nextState.detailTab, nextState.provider, nextState.analyticsVisibility);
      return { state: nextState, action: 'redraw' };
    case 'p':
      if (nextState.viewMode !== 'detail' || nextState.detailTab !== 'settings') {
        return { state: nextState, action: 'noop' };
      }
      nextState.analyticsVisibility = toggleAnalyticsPanel(nextState.analyticsVisibility, nextState.provider, 'summary');
      nextState.detailTab = ensureDetailTab(nextState.detailTab, nextState.provider, nextState.analyticsVisibility);
      return { state: nextState, action: 'redraw' };
    case 'e':
      if (nextState.viewMode !== 'detail' || nextState.detailTab !== 'settings') {
        return { state: nextState, action: 'noop' };
      }
      nextState.analyticsVisibility = enableAllAnalyticsPanels(nextState.analyticsVisibility, nextState.provider);
      nextState.detailTab = ensureDetailTab(nextState.detailTab, nextState.provider, nextState.analyticsVisibility);
      return { state: nextState, action: 'redraw' };
    case 'c':
      if (nextState.provider === 'claude' && nextState.viewMode === 'detail') {
        return { state: nextState, action: 'clear' };
      }
      return { state: nextState, action: 'noop' };
    case '1':
      nextState.period = 'today';
      return { state: nextState, action: 'refresh' };
    case '2':
      nextState.period = '7d';
      return { state: nextState, action: 'refresh' };
    case '3':
      nextState.period = '30d';
      return { state: nextState, action: 'refresh' };
    case '4':
      nextState.period = 'month';
      return { state: nextState, action: 'refresh' };
    default:
      return { state: nextState, action: 'noop' };
  }
}
