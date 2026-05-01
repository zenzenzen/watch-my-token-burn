import { MODEL_PRICING, CODEX_PRICING } from './pricing.js';
import { calculateCacheHitRate, formatModelName, basenameLabel, stripAnsi, primaryClaudeSession } from './format.js';
import { ensureDetailTab, getDetailTabsForProvider, normalizeAnalyticsVisibility } from './state.js';

// =============================================================================
// RENDERING ARCHITECTURE
// =============================================================================
// This module owns the fullscreen TUI renderer. It consumes two distinct data
// shapes that must NOT be unified:
//
//   Fullscreen path  — receives raw collector structs (ClaudeSession[] from
//     collector.js and CodexData from codex.js). These are richer than the
//     snapshot schema and drive the detail views.
//
//   Inline/hook path — operates on the versioned snapshot schema (snapshot.js)
//     and is handled entirely by inline.js. The snapshot schema is a transport
//     contract for Claude Code statusLine hooks and Codex adapters.
//
// Merging these two paths would require adding ~22 snapshot fields that the
// inline renderer never uses, creating a leaky abstraction. Keep them separate.
// =============================================================================

const ESC = '\x1b[';

function fgRgb(r, g, b) {
  return `${ESC}38;2;${r};${g};${b}m`;
}

function bgRgb(r, g, b) {
  return `${ESC}48;2;${r};${g};${b}m`;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function fgHex(hex) {
  const { r, g, b } = hexToRgb(hex);
  return fgRgb(r, g, b);
}

function bgHex(hex) {
  const { r, g, b } = hexToRgb(hex);
  return bgRgb(r, g, b);
}

const THEME = {
  bubblegum: '#ef476f',
  golden: '#ffd166',
  emerald: '#06d6a0',
  ocean: '#118ab2',
  darkTeal: '#073b4c',
  panel: '#1d2738',
  panelAlt: '#2d3b52',
  panelSoft: '#7f8aa3',
  ink: '#07131a',
  text: '#f4f7fb',
  muted: '#9fb0c1',
  line: '#5a6f84',
  quiet: '#121923',
};

const C = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  white: fgHex(THEME.text),
  black: fgHex(THEME.ink),
  grey: fgHex(THEME.muted),
  yellow: fgHex(THEME.golden),
  green: fgHex(THEME.emerald),
  blue: fgHex(THEME.ocean),
  purple: fgHex(THEME.bubblegum),
  cyan: fgHex(THEME.ocean),
  red: fgHex(THEME.bubblegum),
  line: fgHex(THEME.line),
  bgGrey: bgHex(THEME.panelSoft),
  bgYellow: bgHex(THEME.golden),
  bgGreen: bgHex(THEME.emerald),
  bgBlue: bgHex(THEME.ocean),
  bgPurple: bgHex(THEME.bubblegum),
  bgDark: bgHex(THEME.darkTeal),
  bgDarker: bgHex(THEME.panel),
};

const MODEL_CONTEXT_LIMITS = {
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  default: 200_000,
};

const DETAIL_TAB_LABELS = {
  overview: 'OVERVIEW',
  activity: 'ACTIVITY',
  scoring: 'SCORING',
  breakdown: 'BREAKDOWN',
  advisor: 'ADVISOR',
  summary: 'SUMMARY',
  settings: 'SETTINGS',
};


function getCodexSessionCost(session) {
  const pricing = CODEX_PRICING.default;
  return (
    session.totalInputTokens * pricing.input +
    session.totalOutputTokens * pricing.output +
    session.totalCachedInputTokens * pricing.cacheRead
  ) / 1_000_000;
}

function getCodexTotalCost(codexData) {
  if (!codexData) return 0;
  const pricing = CODEX_PRICING.default;
  return (
    (codexData.allTotalInputTokens || 0) * pricing.input +
    (codexData.allTotalOutputTokens || 0) * pricing.output +
    (codexData.allTotalCachedInputTokens || 0) * pricing.cacheRead
  ) / 1_000_000;
}

function getSessionCost(model, totals) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  return (
    totals.totalInput * pricing.input +
    totals.totalOutput * pricing.output +
    totals.totalCacheRead * pricing.cacheRead +
    totals.totalCacheCreate * pricing.cacheWrite
  ) / 1_000_000;
}

function getContextLimit(model) {
  return MODEL_CONTEXT_LIMITS[model] || MODEL_CONTEXT_LIMITS.default;
}

function formatTokens(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value || 0);
}

function formatCost(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function formatDuration(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

function normalizeTimestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatTimelineTime(value) {
  const timestampMs = normalizeTimestampMs(value);
  if (timestampMs === null) return '--:--';
  return new Date(timestampMs).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function sampleTimelinePoints(points, maxPoints) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (points.length <= maxPoints) return [...points];
  if (maxPoints <= 1) return [points[points.length - 1]];

  const sampled = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let index = 0; index < maxPoints; index++) {
    sampled.push(points[Math.round(index * step)]);
  }
  return sampled;
}

function renderSparkline(values, width, ascii = false) {
  const levels = ascii ? '._-:=+*#%@' : '▁▂▃▄▅▆▇█';
  if (!Array.isArray(values) || values.length === 0 || width <= 0) return '';

  const sampled = values.length > width
    ? sampleTimelinePoints(values.map(value => ({ value })), width).map(point => point.value)
    : values;
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);

  if (max === min) {
    return levels[Math.floor((levels.length - 1) / 2)].repeat(sampled.length);
  }

  return sampled.map(value => {
    const ratio = (value - min) / (max - min);
    const index = Math.min(levels.length - 1, Math.max(0, Math.round(ratio * (levels.length - 1))));
    return levels[index];
  }).join('');
}

function calculateAverageBurn(totalCost, startedAt, latestTimestamp, nowMs = Date.now()) {
  const startMs = normalizeTimestampMs(startedAt);
  const endMs = normalizeTimestampMs(latestTimestamp) ?? nowMs;
  const elapsedMs = startMs === null || endMs <= startMs ? null : endMs - startMs;

  if (elapsedMs === null || !Number.isFinite(totalCost)) {
    return { elapsedMs: null, costPerHour: null };
  }

  return {
    elapsedMs,
    costPerHour: elapsedMs > 0 ? totalCost / (elapsedMs / (60 * 60 * 1000)) : null,
  };
}

function renderSessionTimelinePanel(lines, {
  title = 'SESSION BURN',
  timeline = [],
  totalTokens = 0,
  totalCost = 0,
  startedAt = null,
  latestTimestamp = null,
  width,
  ascii = false,
  nowMs = Date.now(),
}) {
  const sparkWidth = Math.max(12, Math.min(36, width - 24));
  const sampled = sampleTimelinePoints(timeline, sparkWidth);
  const burn = calculateAverageBurn(totalCost, timeline[0]?.timestamp || startedAt, latestTimestamp || sampled[sampled.length - 1]?.timestamp, nowMs);
  const updateCount = Array.isArray(timeline) ? timeline.length : 0;

  lines.push('');

  if (sampled.length < 2) {
    lines.push(`  ${C.dim}${title}${C.reset}  ${C.dim}warming up${C.reset}  ${C.dim}(${updateCount} update${updateCount === 1 ? '' : 's'})${C.reset}`);
    return;
  }

  const values = sampled.map(point => point.totalTokens || 0);
  const sparkline = renderSparkline(values, sparkWidth, ascii);
  const avgBurnText = burn.costPerHour === null
    ? `${C.dim}avg --/hr${C.reset}`
    : `${C.dim}avg${C.reset} ${C.bold}${formatCost(burn.costPerHour)}${C.reset}${C.dim}/hr${C.reset}`;
  const elapsedText = burn.elapsedMs === null
    ? `${C.dim}elapsed --${C.reset}`
    : `${C.dim}${formatDuration(burn.elapsedMs)} elapsed${C.reset}`;

  lines.push(`  ${C.dim}${title}${C.reset}  ${avgBurnText}  ${elapsedText}  ${C.dim}${updateCount} updates${C.reset}`);
  lines.push(`  ${C.dim}${formatTimelineTime(sampled[0]?.timestamp)}${C.reset} ${C.bold}${sparkline}${C.reset} ${C.dim}${formatTimelineTime(sampled[sampled.length - 1]?.timestamp)}${C.reset}`);
  lines.push(`  ${C.dim}${formatTokens(values[0] || 0)}${C.reset} ${C.dim}->${C.reset} ${C.bold}${formatTokens(totalTokens || values[values.length - 1] || 0)}${C.reset} ${C.dim}tokens${C.reset}`);
}

function renderAdvisorPanel(lines, messages, width, ascii = false) {
  const bullet = ascii ? '-' : '•';
  lines.push('');
  lines.push(`  ${horizontalLine(width - 2)}`);
  lines.push(`  ${C.bold}${C.cyan}EFFICIENCY ADVISOR${C.reset}`);

  if (!messages.length) {
    lines.push(`  ${C.dim}No active coaching flags right now.${C.reset}`);
    return;
  }

  for (const message of messages.slice(0, 4)) {
    lines.push(`  ${C.dim}${bullet}${C.reset} ${message}`);
  }
}

function formatRate(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `${Math.round(value * 100)}%`;
}

function buildClaudeAdvisorMessages(sessions, summary, analytics, budget, nowMs) {
  if (!sessions.length) return [];

  const messages = [];
  const primary = primaryClaudeSession(sessions);
  const aggregateCacheHitRate = getClaudeAggregateCacheHitRate(sessions);
  const totalInputTraffic = sessions.reduce((sum, session) =>
    sum + (session.totals.totalInput || 0) + (session.totals.totalCacheRead || 0) + (session.totals.totalCacheCreate || 0), 0);
  const totalCacheCreate = sessions.reduce((sum, session) => sum + (session.totals.totalCacheCreate || 0), 0);
  const cacheCreateShare = totalInputTraffic > 0 ? (totalCacheCreate / totalInputTraffic) * 100 : null;
  const contextLimit = getContextLimit(primary?.model);
  const contextPercent = primary?.context?.total > 0 ? (primary.context.total / contextLimit) * 100 : null;
  const primaryCost = primary ? getSessionCost(primary.model, primary.totals) : 0;
  const burn = calculateAverageBurn(primaryCost, primary?.timeline?.[0]?.timestamp || primary?.startedAt, primary?.latestTimestamp, nowMs);

  if (aggregateCacheHitRate !== null) {
    if (aggregateCacheHitRate < 40) {
      messages.push(`Cache hits are only ${formatPercent(aggregateCacheHitRate)} across Claude sessions. Prompt setup looks churny; reuse stable context or seed more through CLAUDE.md.`);
    } else if (aggregateCacheHitRate >= 85) {
      messages.push(`Cache hits are ${formatPercent(aggregateCacheHitRate)} across Claude sessions. Prompt reuse looks efficient.`);
    }
  }

  if (cacheCreateShare !== null && cacheCreateShare >= 25) {
    messages.push(`Cache creation is ${formatPercent(cacheCreateShare)} of Claude input traffic. You're rewriting a lot of context instead of reusing it.`);
  }

  if (contextPercent !== null && contextPercent >= 70) {
    messages.push(`${primary.projectName} is sitting at ${formatPercent(contextPercent)} of context. Compaction pressure is getting close.`);
  }

  if (burn.costPerHour !== null && burn.costPerHour >= 5) {
    messages.push(`${primary.projectName} is averaging ${formatCost(burn.costPerHour)}/hr in the current burn window.`);
  }

  if (budget > 0 && (summary?.estimatedCost || 0) >= budget * 0.8) {
    messages.push(`Estimated spend is already ${formatCost(summary.estimatedCost)} against a ${formatCost(budget)} budget for this period.`);
  }

  const lowShot = analytics?.categoryBreakdown?.find(row =>
    (row.category === 'coding' || row.category === 'debugging')
    && row.oneShotRate !== null
    && row.oneShotRate < 0.5
  );
  if (lowShot) {
    messages.push(`${lowShot.category} one-shot rate is only ${formatRate(lowShot.oneShotRate)}. Token burn looks stuck in retry loops instead of landing on the first edit.`);
  }

  return messages;
}

function buildCodexAdvisorMessages(codexData, summary, analytics, budget, nowMs) {
  const active = codexData?.activeSession;
  if (!active) return [];

  const messages = [];
  const cacheHitRate = getCodexCacheHitRate(active);
  const contextPercent = active.modelContextWindow > 0 ? (active.currentContextTokens / active.modelContextWindow) * 100 : null;
  const primaryLimit = active.rateLimits?.primary?.usedPercent ?? null;
  const secondaryLimit = active.rateLimits?.secondary?.usedPercent ?? null;
  const sessionCost = getCodexSessionCost(active);
  const burn = calculateAverageBurn(sessionCost, active.timeline?.[0]?.timestamp || active.startedAt, active.latestTimestamp, nowMs);

  if (cacheHitRate !== null) {
    if (cacheHitRate < 40) {
      messages.push(`Cache hits are only ${formatPercent(cacheHitRate)} on this Codex thread. Context reuse is low, so repeated turns are staying expensive.`);
    } else if (cacheHitRate >= 85) {
      messages.push(`Cache hits are ${formatPercent(cacheHitRate)} on this Codex thread. Reuse looks healthy.`);
    }
  }

  if (contextPercent !== null && contextPercent >= 70) {
    messages.push(`Context usage is ${formatPercent(contextPercent)} of the model window. You're getting close to compaction territory.`);
  }

  if (primaryLimit !== null && primaryLimit >= 80) {
    messages.push(`The 5h Codex limit is already at ${formatPercent(primaryLimit)}. Consider staggering heavy sessions before you hit the wall.`);
  }

  if (secondaryLimit !== null && secondaryLimit >= 80) {
    messages.push(`The 7d Codex limit is at ${formatPercent(secondaryLimit)}. Weekly capacity is running tight.`);
  }

  if (burn.costPerHour !== null && burn.costPerHour >= 10) {
    messages.push(`This Codex session is averaging ${formatCost(burn.costPerHour)}/hr over the current timeline window.`);
  }

  if (budget > 0 && (summary?.estimatedCost || getCodexTotalCost(codexData)) >= budget * 0.8) {
    messages.push(`Estimated Codex spend is ${formatCost(summary?.estimatedCost || getCodexTotalCost(codexData))} against a ${formatCost(budget)} budget for this period.`);
  }

  const lowShot = analytics?.categoryBreakdown?.find(row =>
    (row.category === 'coding' || row.category === 'debugging')
    && row.oneShotRate !== null
    && row.oneShotRate < 0.5
  );
  if (lowShot) {
    messages.push(`${lowShot.category} one-shot rate is only ${formatRate(lowShot.oneShotRate)} on this window. You’re spending tokens cycling through retry turns.`);
  }

  return messages;
}


function truncateText(text, max, ascii = false) {
  if (!text) return '';
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return `${text.slice(0, max - 1)}${glyphs(ascii).ellipsis}`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `${Math.round(value)}%`;
}

function getClaudeSessionCacheHitRate(session) {
  return calculateCacheHitRate(session?.totals?.totalInput, session?.totals?.totalCacheRead);
}

function getClaudeAggregateCacheHitRate(sessions) {
  const totalInput = sessions.reduce((sum, session) => sum + (session.totals.totalInput || 0), 0);
  const totalCacheRead = sessions.reduce((sum, session) => sum + (session.totals.totalCacheRead || 0), 0);
  return calculateCacheHitRate(totalInput, totalCacheRead);
}

function getCodexCacheHitRate(session) {
  return calculateCacheHitRate(session?.totalInputTokens, session?.totalCachedInputTokens);
}

function findMatchingProjectMetric(session, projectMetrics = []) {
  if (!session) return null;

  const bySession = projectMetrics.find(metric => metric.sessionId && metric.sessionId === session.sessionId);
  if (bySession) return bySession;

  const byName = projectMetrics.find(metric => metric.name === session.projectName);
  if (byName) return byName;

  const cwd = session.cwd || '';
  return projectMetrics.find(metric => metric.path && cwd && cwd.endsWith(metric.path));
}

function formatRelativeReset(unixSeconds, now = Date.now()) {
  if (!unixSeconds) return '--';
  const diffMs = unixSeconds * 1000 - now;
  if (diffMs <= 0) return 'now';
  return formatDuration(diffMs);
}

function sessionStatus(session) {
  if (session.alive) return { label: 'ACTIVE', color: THEME.emerald, fg: THEME.ink };

  const age = session.startedAt ? Date.now() - session.startedAt : Infinity;
  if (age < 30 * 60 * 1000) {
    return { label: 'RECENT', color: THEME.golden, fg: THEME.ink };
  }
  return { label: 'ENDED', color: THEME.panelSoft, fg: THEME.text };
}


function glyphs(ascii) {
  return ascii
    ? {
        line: '-',
        power: '>',
        active: '*',
        inactive: 'o',
        today: '<',
        ellipsis: '.',
      }
    : {
        line: '\u2500',
        power: '\uE0B0',
        active: '●',
        inactive: '○',
        today: '◄',
        ellipsis: '…',
      };
}

function horizontalLine(width, char = '\u2500') {
  return `${C.line}${char.repeat(Math.max(0, width))}${C.reset}`;
}


function fitAnsiLine(str, width) {
  if (width <= 0) return '';

  let out = '';
  let visible = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\x1b') {
      const match = str.slice(i).match(/^\x1b\[[0-9;?]*[ -/]*[@-~]/);
      if (match) {
        out += match[0];
        i += match[0].length - 1;
        continue;
      }
    }

    if (visible >= width) break;
    out += ch;
    visible++;
  }

  if (visible >= width) out += C.reset;
  return out;
}

function solidBar(segments, totalMax, width) {
  if (totalMax <= 0) return `${C.bgDarker}${' '.repeat(width)}${C.reset}`;

  let out = '';
  let used = 0;
  for (const segment of segments) {
    if (!segment || segment.value <= 0) continue;
    const rawWidth = (segment.value / totalMax) * width;
    const segWidth = rawWidth > 0.3 ? Math.max(1, Math.round(rawWidth)) : 0;
    if (segWidth === 0) continue;
    const chars = Math.min(segWidth, width - used);
    if (chars <= 0) continue;
    out += `${segment.bg}${' '.repeat(chars)}${C.reset}`;
    used += chars;
  }

  if (used < width) {
    out += `${C.bgDarker}${' '.repeat(width - used)}${C.reset}`;
  }
  return out;
}

function powerSegment(text, bg, fg, nextBg = null, ascii = false) {
  const body = `${bgHex(bg)}${fgHex(fg)} ${text} ${C.reset}`;
  const g = glyphs(ascii);
  const tail = nextBg
    ? `${bgHex(nextBg)}${fgHex(bg)}${g.power}${C.reset}`
    : `${fgHex(bg)}${g.power}${C.reset}`;
  return body + tail;
}

function renderPowerline(segments, ascii = false) {
  if (segments.length === 0) return '';
  let out = '';
  for (let i = 0; i < segments.length; i++) {
    const current = segments[i];
    const next = segments[i + 1];
    out += powerSegment(current.text, current.bg, current.fg, next?.bg || null, ascii);
  }
  return out;
}

function dot(bg, label) {
  return `${bg}  ${C.reset} ${label}`;
}

function renderTabs(provider) {
  const tabs = [
    {
      label: 'CLAUDE',
      active: provider === 'claude',
      activeBg: THEME.bubblegum,
    },
    {
      label: 'CODEX',
      active: provider === 'codex',
      activeBg: THEME.ocean,
    },
  ];

  return tabs.map(tab => {
    const bg = tab.active ? tab.activeBg : THEME.quiet;
    const fg = tab.active ? THEME.text : THEME.muted;
    return `${bgHex(bg)}${fgHex(fg)} ${tab.label} ${C.reset}`;
  }).join(' ');
}

function renderHeader({ provider, viewMode, period, width, now }) {
  const title = `${C.bold}${C.cyan}  TOKEN GAUGE${C.reset}`;
  const tabs = renderTabs(provider);
  const mode = `${bgHex(THEME.panelAlt)}${fgHex(THEME.text)} ${viewMode.toUpperCase()} ${String(period || '7d').toUpperCase()} ${C.reset}`;
  const right = `${tabs} ${mode}  ${C.dim}${formatTime(now)}${C.reset}`;
  const pad = Math.max(1, width - stripAnsi(title).length - stripAnsi(right).length);
  return title + ' '.repeat(pad) + right;
}

function renderFooter(width, provider, viewMode) {
  const parts = ['q:quit', 'r:fresh', 'v:mode', '1-4:period', '[/]:provider'];
  if (viewMode === 'detail') parts.push(',/.:subtab', 's:settings');
  if (provider === 'claude' && viewMode === 'detail') parts.push('c:clear');
  return `  ${C.dim}${parts.join('  ')}${C.reset}`;
}

function renderCompactFooter(width) {
  return `  ${C.dim}q:quit  r:fresh  v:mode  1-4:period  [/]:provider${C.reset}`;
}

function renderDetailTabs(provider, detailTab, analyticsVisibility) {
  const activeTab = ensureDetailTab(detailTab, provider, analyticsVisibility);
  const tabs = getDetailTabsForProvider(provider, analyticsVisibility);

  return tabs.map(tab => {
    const active = tab === activeTab;
    const bg = active ? (provider === 'claude' ? THEME.bubblegum : THEME.ocean) : THEME.quiet;
    const fg = active ? THEME.text : THEME.muted;
    return `${bgHex(bg)}${fgHex(fg)} ${DETAIL_TAB_LABELS[tab] || tab.toUpperCase()} ${C.reset}`;
  }).join(' ');
}

function renderSettingsPanel(lines, provider, analyticsVisibility, width) {
  const visibility = normalizeAnalyticsVisibility(analyticsVisibility)[provider] || {};
  const rows = [
    ['a', 'Activity', 'Turns, categories, and one-shot rates', visibility.activity],
    ['g', 'Scoring', 'Per-chat context and token efficiency', visibility.scoring],
    ['t', 'Tools', 'Tool breakdown panel inside Breakdown', visibility.tools],
    ['m', 'MCP', 'MCP server breakdown panel inside Breakdown', visibility.mcp],
    ['b', 'Bash', 'Shell command breakdown panel inside Breakdown', visibility.bash],
    ['d', 'Advisor', 'Efficiency advisor recommendations', visibility.advisor],
    ['p', 'Summary', 'Period summary and history chart', visibility.summary],
  ];

  lines.push('');
  lines.push(`  ${horizontalLine(width - 2)}`);
  lines.push(`  ${C.bold}${C.cyan}${provider.toUpperCase()} SETTINGS${C.reset}`);
  lines.push(`  ${C.dim}Disable panels you do not want in the detail tab carousel. Changes save to config immediately.${C.reset}`);

  for (const [key, label, description, enabled] of rows) {
    const state = enabled
      ? `${C.green}${C.bold}ON ${C.reset}`
      : `${C.dim}off${C.reset}`;
    lines.push(`  ${C.bold}${key}${C.reset}  ${label.padEnd(9)} ${state} ${C.dim}${description}${C.reset}`);
  }

  const enabledCount = rows.filter(([, , , enabled]) => enabled).length;
  lines.push('');
  lines.push(`  ${C.dim}${enabledCount}/${rows.length} analytics panels enabled. Use${C.reset} ${C.bold}e${C.reset} ${C.dim}to restore all defaults for ${provider}.${C.reset}`);
}

function compactClaudeSegments(sessions, ascii, budget = 0, weeklyData = null) {
  const session = primaryClaudeSession(sessions);
  if (!session) return [];

  const status = sessionStatus(session);
  const sessionCost = sessions.reduce((sum, s) => sum + getSessionCost(s.model, s.totals), 0);
  const totalSpend = weeklyData?.estimatedCost ?? sessionCost;
  const cacheHitRate = getClaudeSessionCacheHitRate(session);
  const segments = [
    { text: truncateText(session.projectName || 'unknown', 18, ascii), bg: THEME.bubblegum, fg: THEME.text },
    { text: formatModelName(session.model), bg: THEME.ocean, fg: THEME.text },
    { text: `${formatPercent((session.context.total / getContextLimit(session.model)) * 100)} of ${formatTokens(getContextLimit(session.model))}`, bg: THEME.emerald, fg: THEME.ink },
    { text: `cache ${formatPercent(cacheHitRate)}`, bg: THEME.panelAlt, fg: THEME.text },
    { text: formatCost(sessionCost), bg: THEME.golden, fg: THEME.ink },
    { text: status.label, bg: status.color, fg: status.fg },
  ];

  if (budget > 0) {
    const remaining = budget - totalSpend;
    segments.push({ text: `${formatCost(remaining)} left`, bg: remaining >= 0 ? THEME.emerald : THEME.bubblegum, fg: THEME.ink });
  }

  return segments;
}

function compactCodexSegments(codexData, ascii, budget = 0) {
  const active = codexData?.activeSession;
  if (!active) return [];

  const primary = active.rateLimits?.primary;
  const secondary = active.rateLimits?.secondary;
  const cost = getCodexSessionCost(active);
  const cacheHitRate = getCodexCacheHitRate(active);
  const segments = [
    { text: truncateText(active.threadName || active.workspaceLabel || 'Codex', 18, ascii), bg: THEME.bubblegum, fg: THEME.text },
    { text: 'Codex', bg: THEME.ocean, fg: THEME.text },
    { text: `5h ${formatPercent(primary?.usedPercent)}`, bg: THEME.golden, fg: THEME.ink },
    { text: `7d ${formatPercent(secondary?.usedPercent)}`, bg: THEME.emerald, fg: THEME.ink },
    { text: `cache ${formatPercent(cacheHitRate)}`, bg: THEME.panelAlt, fg: THEME.text },
    { text: `${formatTokens(active.currentContextTokens)} ctx`, bg: THEME.panelAlt, fg: THEME.text },
    { text: `${formatTokens(active.totalTokens)} tok`, bg: THEME.panelSoft, fg: THEME.text },
    { text: formatCost(cost), bg: THEME.golden, fg: THEME.ink },
  ];

  if (budget > 0) {
    const totalSpend = getCodexTotalCost(codexData);
    const remaining = budget - totalSpend;
    segments.push({ text: `${formatCost(remaining)} left`, bg: remaining >= 0 ? THEME.emerald : THEME.bubblegum, fg: THEME.ink });
  }

  return segments;
}

function renderCompact(provider, sessions, codexData, width, screenWidth, now, ascii, budget = 0, summary = null, period = '7d') {
  const lines = [];
  lines.push('');
  lines.push(renderHeader({ provider, viewMode: 'compact', period, width, now }));
  lines.push('');

  if (provider === 'claude') {
    const segments = compactClaudeSegments(sessions, ascii, budget, summary);
    if (segments.length === 0) {
      lines.push(`  ${C.dim}No Claude sessions detected.${C.reset}`);
    } else {
      lines.push(`  ${renderPowerline(segments, ascii)}`);
    }
  } else {
    const segments = compactCodexSegments(codexData, ascii, budget);
    if (segments.length === 0) {
      lines.push(`  ${C.dim}No Codex sessions detected.${C.reset}`);
    } else {
      lines.push(`  ${renderPowerline(segments, ascii)}`);
    }
  }

  lines.push('');
  lines.push(`  ${horizontalLine(width - 2, glyphs(ascii).line)}`);
  lines.push(renderCompactFooter(width));
  lines.push('');
  return lines.map(line => fitAnsiLine(line, screenWidth)).join('\n');
}

function renderClaudeSummaryStrip(sessions, ascii) {
  const activeSessions = sessions.filter(session => session.alive);
  const primary = primaryClaudeSession(sessions);
  if (!primary) return '';

  const totalTokens = sessions.reduce((sum, session) => sum + session.totals.totalTokens, 0);
  const totalContext = sessions.reduce((sum, session) => sum + (session.alive ? session.context.total : 0), 0);
  const totalCost = sessions.reduce((sum, session) => sum + getSessionCost(session.model, session.totals), 0);
  const cacheHitRate = getClaudeAggregateCacheHitRate(sessions);

  return renderPowerline([
    { text: sessions.length === 1 ? primary.projectName : `${sessions.length} sessions`, bg: THEME.bubblegum, fg: THEME.text },
    { text: primary.model !== 'unknown' ? formatModelName(primary.model) : `${activeSessions.length} active`, bg: THEME.ocean, fg: THEME.text },
    { text: `cache ${formatPercent(cacheHitRate)}`, bg: THEME.panelAlt, fg: THEME.text },
    { text: formatCost(totalCost), bg: THEME.golden, fg: THEME.ink },
    { text: `${formatPercent((totalContext / getContextLimit(primary.model)) * 100)} of ${formatTokens(getContextLimit(primary.model))}`, bg: THEME.emerald, fg: THEME.ink },
    { text: `${formatTokens(totalTokens)} tokens`, bg: THEME.panelSoft, fg: THEME.text },
  ], ascii);
}

// Consumes ClaudeSession[] from collector.js — NOT the snapshot schema. See RENDERING ARCHITECTURE above.
function renderClaudeDetail(sessions, summary, analytics, projectMetrics, rateLimitCache, width, screenWidth, now, ascii, budget = 0, period = '7d', detailTab = 'overview', analyticsVisibility = null) {
  const barWidth = Math.max(30, width - 22);
  const lines = [];
  const g = glyphs(ascii);
  const activeTab = ensureDetailTab(detailTab, 'claude', analyticsVisibility);
  const visibility = normalizeAnalyticsVisibility(analyticsVisibility).claude;

  lines.push('');
  lines.push(renderHeader({ provider: 'claude', viewMode: 'detail', period, width, now }));

  if (sessions.length > 0) {
    lines.push('');
    lines.push(`  ${renderClaudeSummaryStrip(sessions, ascii)}`);
  }

  lines.push('');
  lines.push(`  ${horizontalLine(width - 2, g.line)}`);
  lines.push(`  ${renderDetailTabs('claude', activeTab, analyticsVisibility)}`);
  lines.push('');
  lines.push(`  ${horizontalLine(width - 2, g.line)}`);

  if (activeTab === 'overview') {
    if (rateLimitCache?.primary || rateLimitCache?.secondary) {
      renderRateLimitPanel(lines, 'PRIMARY LIMIT', rateLimitCache?.primary, width, C.bgYellow, now.getTime());
      renderRateLimitPanel(lines, 'SECONDARY LIMIT', rateLimitCache?.secondary, width, C.bgPurple, now.getTime());
      if (rateLimitCache?.updatedAt) {
        lines.push(`  ${C.dim}Claude rate limits cached from hook data at ${rateLimitCache.updatedAt}${C.reset}`);
      }
      lines.push('');
      lines.push(`  ${horizontalLine(width - 2, g.line)}`);
    }

    if (sessions.length === 0) {
      lines.push('');
      lines.push(`  ${C.dim}No Claude sessions detected.${C.reset}`);
      lines.push(`  ${C.dim}Start a Claude Code session to see token usage.${C.reset}`);
    }

    if (sessions.length > 1) {
      const activeSessions = sessions.filter(session => session.alive);
      const totalTokens = sessions.reduce((sum, session) => sum + session.totals.totalTokens, 0);
      const totalContext = sessions.reduce((sum, session) => sum + (session.alive ? session.context.total : 0), 0);
      lines.push('');
      lines.push(`  ${C.bold}${sessions.length} sessions${C.reset} ${C.dim}(${activeSessions.length} active)${C.reset}  ${C.dim}total tokens:${C.reset} ${C.bold}${formatTokens(totalTokens)}${C.reset}  ${C.dim}active context:${C.reset} ${C.bold}${formatTokens(totalContext)}${C.reset}`);
    }

    for (const session of sessions) {
      const status = session.alive
        ? `${C.green}${C.bold}${g.active} ACTIVE${C.reset}`
        : `${C.grey}${g.inactive} ended${C.reset}`;
      const age = session.startedAt
        ? `${C.dim}${formatDuration(Date.now() - session.startedAt)} ago${C.reset}`
        : '';
      const contextLimit = getContextLimit(session.model);

      lines.push('');
      lines.push(`  ${C.bold}${session.projectName}${C.reset} ${C.dim}(${session.shortId})${C.reset}  ${status}  ${C.dim}PID ${session.pid}${C.reset}  ${age}`);

      if (session.model !== 'unknown') {
        lines.push(`  ${renderPowerline([
          { text: formatModelName(session.model), bg: THEME.panelAlt, fg: THEME.text },
          { text: `${session.totals.messageCount} msgs`, bg: THEME.quiet, fg: THEME.muted },
          { text: session.alive ? 'ACTIVE' : 'ENDED', bg: session.alive ? THEME.emerald : THEME.panelSoft, fg: session.alive ? THEME.ink : THEME.text },
        ], ascii)}`);
      }

      if (session.context.total > 0) {
        const remaining = Math.max(0, contextLimit - session.context.total);
        const contextBar = solidBar([
          { value: session.context.stale, bg: C.bgGrey },
          { value: session.context.loaded, bg: C.bgYellow },
          { value: session.context.active, bg: C.bgGreen },
          { value: remaining, bg: C.bgDark },
        ], contextLimit, barWidth);

        lines.push('');
        const ctxPct = formatPercent((session.context.total / contextLimit) * 100);
        lines.push(`  ${C.dim}CONTEXT WINDOW${C.reset}  ${C.bold}${ctxPct}${C.reset} ${C.dim}of ${formatTokens(contextLimit)}${C.reset}  ${C.dim}(${formatTokens(session.context.total)} used, ${formatTokens(remaining)} remaining)${C.reset}`);
        lines.push(`  ${contextBar}`);
        lines.push('');
        lines.push(`  ${dot(C.bgGrey, `${C.grey}stale ${formatTokens(session.context.stale)}${C.reset}`)}  ${dot(C.bgYellow, `${C.yellow}loaded ${formatTokens(session.context.loaded)}${C.reset}`)}  ${dot(C.bgGreen, `${C.green}active ${formatTokens(session.context.active)}${C.reset}`)}  ${dot(C.bgDark, `${C.dim}free ${formatTokens(remaining)}${C.reset}`)}`);
        lines.push('');
      } else {
        lines.push(`  ${C.dim}CONTEXT WINDOW  (no data yet)${C.reset}`);
      }

      if (session.totals.totalTokens > 0) {
        const mainTokens = Math.max(0, session.totals.totalTokens - session.totals.latestTotal);
        const cost = getSessionCost(session.model, session.totals);
        const cacheHitRate = getClaudeSessionCacheHitRate(session);
        const sessionBar = solidBar([
          { value: mainTokens, bg: C.bgBlue },
          { value: session.totals.latestTotal, bg: C.bgPurple },
        ], session.totals.totalTokens, barWidth);

        lines.push('');
        lines.push(`  ${C.dim}SESSION TOKENS${C.reset}  ${C.bold}${formatTokens(session.totals.totalTokens)}${C.reset} ${C.dim}total${C.reset}  ${C.dim}(in: ${formatTokens(session.totals.totalInput + session.totals.totalCacheRead + session.totals.totalCacheCreate)}  out: ${formatTokens(session.totals.totalOutput)}  cache hit: ${formatPercent(cacheHitRate)})${C.reset}  ${C.dim}cost:${C.reset} ${C.bold}${formatCost(cost)}${C.reset}`);
        lines.push(`  ${sessionBar}`);
        lines.push('');
        lines.push(`  ${dot(C.bgBlue, `${C.blue}cumulative ${formatTokens(session.totals.totalTokens)}${C.reset}`)}  ${dot(C.bgPurple, `${C.purple}latest turn ${formatTokens(session.totals.latestTotal)}${C.reset}`)}`);
        renderSessionTimelinePanel(lines, {
          timeline: session.timeline || [],
          totalTokens: session.totals.totalTokens,
          totalCost: cost,
          startedAt: session.startedAt,
          latestTimestamp: session.latestTimestamp,
          width,
          ascii,
          nowMs: now.getTime(),
        });
        lines.push('');
      }
    }

    if (budget > 0) {
      const sessionCost = sessions.reduce((sum, s) => sum + getSessionCost(s.model, s.totals), 0);
      const estimatedSpend = summary?.estimatedCost ?? sessionCost;
      const billedSpend = summary?.billedCost ?? null;
      const remaining = budget - estimatedSpend;
      const billedRemaining = billedSpend === null ? null : budget - billedSpend;
      const remainColor = remaining >= 0 ? C.green : C.red;
      lines.push('');
      lines.push(`  ${horizontalLine(width - 2)}`);
      lines.push(`  ${C.bold}${C.cyan}BUDGET${C.reset}  ${C.dim}limit:${C.reset} ${C.bold}${formatCost(budget)}${C.reset}  ${C.dim}est spent:${C.reset} ${C.bold}${formatCost(estimatedSpend)}${C.reset}  ${C.dim}est remaining:${C.reset} ${remainColor}${C.bold}${formatCost(remaining)}${C.reset}`);
      if (billedSpend !== null) {
        const billedColor = billedRemaining >= 0 ? C.green : C.red;
        lines.push(`  ${C.dim}BUDGET${C.reset}  ${C.dim}billed spent:${C.reset} ${C.bold}${formatCost(billedSpend)}${C.reset}  ${C.dim}billed remaining:${C.reset} ${billedColor}${C.bold}${formatCost(billedRemaining)}${C.reset}`);
      }
    }

    if (projectMetrics?.length) {
      lines.push('');
      lines.push(`  ${horizontalLine(width - 2)}`);
      lines.push(`  ${C.bold}${C.cyan}PROJECT BILLING${C.reset}`);
      const shown = projectMetrics.slice(0, 5);
      for (const metric of shown) {
        const matchedSession = sessions.find(session => findMatchingProjectMetric(session, [metric]));
        const name = matchedSession ? `${C.bold}${metric.name}${C.reset}` : metric.name;
        lines.push(`  ${name}  ${C.dim}billed:${C.reset} ${C.bold}${formatCost(metric.cost)}${C.reset}  ${C.dim}in:${C.reset} ${formatTokens(metric.totalInput + metric.totalCacheRead + metric.totalCacheCreate)}  ${C.dim}out:${C.reset} ${formatTokens(metric.totalOutput)}`);
      }
    }
  } else if (activeTab === 'activity') {
    renderActivityPanel(lines, analytics, width);
  } else if (activeTab === 'scoring') {
    renderScoringPanel(lines, analytics, width);
  } else if (activeTab === 'breakdown') {
    renderEnabledBreakdowns(lines, analytics, visibility, width);
  } else if (activeTab === 'advisor') {
    renderAdvisorPanel(lines, buildClaudeAdvisorMessages(sessions, summary, analytics, budget, now.getTime()), width, ascii);
  } else if (activeTab === 'summary') {
    renderClaudePeriodSummary(lines, summary, width, barWidth, g);
  } else if (activeTab === 'settings') {
    renderSettingsPanel(lines, 'claude', analyticsVisibility, width);
  }

  lines.push('');
  lines.push(`  ${horizontalLine(width - 2, g.line)}`);
  lines.push(renderFooter(width, 'claude', 'detail'));
  lines.push('');
  return lines.map(line => fitAnsiLine(line, screenWidth)).join('\n');
}

function renderWeeklyChart(lines, weeklyData, barWidth, g) {
  if (!weeklyData.daily?.length) return;
  const maxDaily = Math.max(...weeklyData.daily.map(day => day.tokens), 1);
  const dayBarWidth = Math.max(10, barWidth - 10);
  lines.push('');
  for (const day of weeklyData.daily) {
    const filled = Math.max(0, Math.round((day.tokens / maxDaily) * dayBarWidth));
    const empty = dayBarWidth - filled;
    const bar = `${C.bgBlue}${' '.repeat(filled)}${C.reset}${C.bgDarker}${' '.repeat(empty)}${C.reset}`;
    const today = day.isToday ? `${C.green} ${g.today}${C.reset}` : '';
    lines.push(`  ${C.dim}${day.label.padEnd(5)}${C.reset} ${bar} ${C.dim}${formatTokens(day.tokens)}${C.reset}${today}`);
  }
}

function renderActivityPanel(lines, analytics, width) {
  lines.push('');
  lines.push(`  ${horizontalLine(width - 2)}`);
  lines.push(`  ${C.bold}${C.cyan}ACTIVITY${C.reset}`);

  const rows = analytics?.categoryBreakdown?.filter(row => row.turns > 0) || [];
  if (!rows.length) {
    lines.push(`  ${C.dim}No activity data available for this period.${C.reset}`);
    return;
  }

  for (const row of rows.slice(0, 6)) {
    lines.push(`  ${truncateText(row.category, 14)}  ${C.dim}${row.turns} turns${C.reset}  ${formatTokens(row.tokens)} tok  ${formatCost(row.estimatedCost)}  ${C.dim}one-shot:${C.reset} ${C.bold}${formatRate(row.oneShotRate)}${C.reset}`);
  }
}

function formatScore(score) {
  return score === null || score === undefined ? '--' : String(score).padStart(3);
}

function formatOptionalTokens(value) {
  return value === null || value === undefined ? '--' : formatTokens(value);
}

function renderScoringPanel(lines, analytics, width) {
  lines.push('');
  lines.push(`  ${horizontalLine(width - 2)}`);
  lines.push(`  ${C.bold}${C.cyan}CHAT SCORING${C.reset}`);

  const rows = analytics?.chatScoring || [];
  if (!rows.length) {
    lines.push(`  ${C.dim}No chat scoring data available for this period.${C.reset}`);
    return;
  }

  lines.push(`  ${C.dim}chat${' '.repeat(22)}score  turns   tok/turn  ctx/turn  context${C.reset}`);

  for (const row of rows.slice(0, 8)) {
    const label = truncateText(row.label || row.sessionId || 'unknown', 24);
    const score = formatScore(row.score);
    const tokenScore = formatScore(row.tokenEfficiencyScore);
    const contextScore = formatScore(row.contextEfficiencyScore);
    const context = row.contextTokens === null || row.contextTokens === undefined
      ? '--'
      : `${formatTokens(row.contextTokens)}${row.contextLimit ? `/${formatTokens(row.contextLimit)}` : ''}`;

    lines.push(`  ${label.padEnd(24)}  ${C.bold}${score}${C.reset}  ${C.dim}${String(row.turns).padStart(5)}${C.reset}  ${String(formatOptionalTokens(row.avgTokensPerTurn)).padStart(9)}  ${String(formatOptionalTokens(row.contextPerTurn)).padStart(8)}  ${C.dim}${context}${C.reset}`);
    lines.push(`  ${C.dim}${' '.repeat(26)}token ${tokenScore}  context ${contextScore}  ${formatCost(row.estimatedCost)}${C.reset}`);
  }
}

function renderEnabledBreakdowns(lines, analytics, visibility, width) {
  const hasBreakdowns = visibility?.tools || visibility?.mcp || visibility?.bash;

  if (!hasBreakdowns) {
    lines.push('');
    lines.push(`  ${horizontalLine(width - 2)}`);
    lines.push(`  ${C.bold}${C.cyan}BREAKDOWN${C.reset}`);
    lines.push(`  ${C.dim}All breakdown panels are disabled for this provider.${C.reset}`);
    return;
  }

  if (visibility?.tools) {
    renderBreakdownPanel(lines, 'TOOLS', analytics?.toolBreakdown, 'tool', width, 8);
  }
  if (visibility?.mcp) {
    renderBreakdownPanel(lines, 'MCP', analytics?.mcpBreakdown, 'server', width, 5);
  }
  if (visibility?.bash) {
    renderBreakdownPanel(lines, 'SHELL', analytics?.bashBreakdown, 'command', width, 5);
  }
}

function renderBreakdownPanel(lines, title, items, labelKey, width, limit) {
  lines.push('');
  lines.push(`  ${horizontalLine(width - 2)}`);
  lines.push(`  ${C.bold}${C.cyan}${title}${C.reset}`);

  if (!items?.length) {
    lines.push(`  ${C.dim}No ${title.toLowerCase()} data available for this period.${C.reset}`);
    return;
  }

  for (const item of items.slice(0, limit)) {
    lines.push(`  ${truncateText(item[labelKey], 28)}  ${C.dim}${item.calls} calls${C.reset}  ${C.dim}${item.turns} turns${C.reset}  ${formatTokens(item.tokens)} tok  ${formatCost(item.estimatedCost)}`);
  }
}

function renderRateLimitPanel(lines, title, rateLimit, width, colorBg, nowMs) {
  const barWidth = Math.max(20, width - 22);
  const usedPercent = Math.max(0, Math.min(100, rateLimit?.usedPercent || 0));
  const used = Math.round((usedPercent / 100) * 1000);
  const remaining = 1000 - used;
  lines.push('');
  lines.push(`  ${C.dim}${title}${C.reset}  ${C.bold}${formatPercent(usedPercent)}${C.reset} ${C.dim}used${C.reset}  ${C.dim}reset in ${formatRelativeReset(rateLimit?.resetsAt, nowMs)}${C.reset}`);
  lines.push(`  ${solidBar([
    { value: used, bg: colorBg },
    { value: remaining, bg: C.bgDark },
  ], 1000, barWidth)}`);
}

function renderClaudePeriodSummary(lines, summary, width, barWidth, g) {
  lines.push('');
  lines.push(`  ${horizontalLine(width - 2)}`);
  lines.push(`  ${C.bold}${C.cyan}PERIOD SUMMARY${C.reset}`);

  if (summary) {
    const machineText = summary.machineCount > 1
      ? `  ${C.dim}|${C.reset}  ${C.bold}${summary.machineCount}${C.reset} machines`
      : '';
    const billedText = summary.billedCost === null
      ? `${C.dim}billed:${C.reset} ${C.bold}--${C.reset}`
      : `${C.dim}billed:${C.reset} ${C.bold}${formatCost(summary.billedCost)}${C.reset}`;
    lines.push(`  ${C.dim}${summary.window?.label || 'Period'}:${C.reset} ${C.bold}${formatTokens(summary.totalTokens)}${C.reset} tokens  ${C.dim}|${C.reset}  ${C.bold}${summary.sessionCount}${C.reset} sessions${machineText}  ${C.dim}|${C.reset}  ${C.dim}est:${C.reset} ${C.bold}${formatCost(summary.estimatedCost)}${C.reset}  ${C.dim}|${C.reset}  ${billedText}`);
    renderWeeklyChart(lines, summary, barWidth, g);
  } else {
    lines.push(`  ${C.dim}No period data available yet.${C.reset}`);
  }
}

function renderCodexPeriodSummary(lines, summary, width, barWidth, g) {
  lines.push('');
  lines.push(`  ${horizontalLine(width - 2)}`);
  lines.push(`  ${C.bold}${C.cyan}PERIOD SUMMARY${C.reset}`);

  if (summary) {
    const machineText = summary.machineCount > 1
      ? `  ${C.dim}|${C.reset}  ${C.bold}${summary.machineCount}${C.reset} machines`
      : '';
    lines.push(`  ${C.dim}${summary.window?.label || 'Period'}:${C.reset} ${C.bold}${formatTokens(summary.totalTokens)}${C.reset} tokens  ${C.dim}|${C.reset}  ${C.bold}${summary.sessionCount}${C.reset} sessions${machineText}  ${C.dim}|${C.reset}  ${C.bold}${formatCost(summary.estimatedCost)}${C.reset} est.`);
    renderWeeklyChart(lines, summary, barWidth, g);
  } else {
    lines.push(`  ${C.dim}No period data available yet.${C.reset}`);
  }
}

function renderCodexSummaryStrip(active, ascii) {
  if (!active) return '';
  const cacheHitRate = getCodexCacheHitRate(active);
  return renderPowerline([
    { text: truncateText(active.threadName || active.workspaceLabel || 'Codex', 18, ascii), bg: THEME.bubblegum, fg: THEME.text },
    { text: 'Codex', bg: THEME.ocean, fg: THEME.text },
    { text: `5h ${formatPercent(active.rateLimits?.primary?.usedPercent)}`, bg: THEME.golden, fg: THEME.ink },
    { text: `7d ${formatPercent(active.rateLimits?.secondary?.usedPercent)}`, bg: THEME.emerald, fg: THEME.ink },
    { text: `cache ${formatPercent(cacheHitRate)}`, bg: THEME.panelAlt, fg: THEME.text },
    { text: `${formatTokens(active.currentContextTokens)} ctx`, bg: THEME.panelAlt, fg: THEME.text },
    { text: `${formatTokens(active.totalTokens)} tok`, bg: THEME.panelSoft, fg: THEME.text },
  ], ascii);
}

// Consumes CodexData from codex.js — NOT the snapshot schema. See RENDERING ARCHITECTURE above.
function renderCodexDetail(codexData, summary, analytics, width, screenWidth, now, ascii, budget = 0, period = '7d', detailTab = 'overview', analyticsVisibility = null) {
  const lines = [];
  const active = codexData?.activeSession || null;
  const barWidth = Math.max(30, width - 22);
  const g = glyphs(ascii);
  const activeTab = ensureDetailTab(detailTab, 'codex', analyticsVisibility);
  const visibility = normalizeAnalyticsVisibility(analyticsVisibility).codex;

  lines.push('');
  lines.push(renderHeader({ provider: 'codex', viewMode: 'detail', period, width, now }));

  if (active) {
    lines.push('');
    lines.push(`  ${renderCodexSummaryStrip(active, ascii)}`);
  }

  lines.push('');
  lines.push(`  ${horizontalLine(width - 2, g.line)}`);
  lines.push(`  ${renderDetailTabs('codex', activeTab, analyticsVisibility)}`);
  lines.push('');
  lines.push(`  ${horizontalLine(width - 2, g.line)}`);

  if (activeTab === 'overview') {
    if (!active) {
      lines.push('');
      lines.push(`  ${C.dim}No Codex sessions detected.${C.reset}`);
      lines.push(`  ${C.dim}Start a Codex session to see live limit usage.${C.reset}`);
    } else {
      lines.push('');
      lines.push(`  ${C.bold}${active.threadName}${C.reset} ${C.dim}(${active.id.slice(0, 8)})${C.reset}  ${C.dim}${active.workspaceLabel}${C.reset}`);

      renderRateLimitPanel(lines, 'PRIMARY LIMIT', active.rateLimits?.primary, width, C.bgYellow, now.getTime());
      renderRateLimitPanel(lines, 'SECONDARY LIMIT', active.rateLimits?.secondary, width, C.bgPurple, now.getTime());

      const cachedContext = Math.min(active.lastCachedInputTokens, active.currentContextTokens);
      const freshContext = Math.max(active.lastInputTokens - active.lastCachedInputTokens, 0);
      const outputAccent = active.lastOutputTokens + active.lastReasoningOutputTokens;
      const usedContext = Math.min(active.currentContextTokens, cachedContext + freshContext + outputAccent);
      const remaining = Math.max(0, active.modelContextWindow - usedContext);
      const contextBar = solidBar([
        { value: cachedContext, bg: C.bgBlue },
        { value: freshContext, bg: C.bgGreen },
        { value: outputAccent, bg: C.bgPurple },
        { value: remaining, bg: C.bgDark },
      ], active.modelContextWindow || 1, barWidth);

      lines.push('');
      lines.push(`  ${C.dim}CONTEXT WINDOW${C.reset}  ${C.bold}${formatTokens(active.currentContextTokens)}${C.reset} ${C.dim}used of ${formatTokens(active.modelContextWindow)}${C.reset}  ${C.dim}(${formatTokens(remaining)} remaining)${C.reset}`);
      lines.push(`  ${contextBar}`);
      lines.push('');
      lines.push(`  ${dot(C.bgBlue, `${C.blue}cached ${formatTokens(cachedContext)}${C.reset}`)}  ${dot(C.bgGreen, `${C.green}fresh ${formatTokens(freshContext)}${C.reset}`)}  ${dot(C.bgPurple, `${C.purple}out+reason ${formatTokens(outputAccent)}${C.reset}`)}  ${dot(C.bgDark, `${C.dim}free ${formatTokens(remaining)}${C.reset}`)}`);

      const sessionCost = getCodexSessionCost(active);
      const cacheHitRate = getCodexCacheHitRate(active);
      lines.push('');
      lines.push(`  ${C.dim}TOKEN TOTALS${C.reset}  ${C.bold}${formatTokens(active.totalTokens)}${C.reset} ${C.dim}total${C.reset}  ${C.dim}(last ${formatTokens(active.lastTokens)}  cache ${formatTokens(active.totalCachedInputTokens)}  out ${formatTokens(active.totalOutputTokens)}  reason ${formatTokens(active.totalReasoningOutputTokens)}  cache hit: ${formatPercent(cacheHitRate)})${C.reset}  ${C.dim}cost:${C.reset} ${C.bold}${formatCost(sessionCost)}${C.reset}`);
      renderSessionTimelinePanel(lines, {
        timeline: active.timeline || [],
        totalTokens: active.totalTokens,
        totalCost: sessionCost,
        startedAt: active.startedAt,
        latestTimestamp: active.latestTimestamp,
        width,
        ascii,
        nowMs: now.getTime(),
      });

      if (budget > 0) {
        const totalSpend = summary?.estimatedCost ?? getCodexTotalCost(codexData);
        const remaining = budget - totalSpend;
        const remainColor = remaining >= 0 ? C.green : C.red;
        lines.push(`  ${C.dim}BUDGET${C.reset}  ${C.dim}limit:${C.reset} ${C.bold}${formatCost(budget)}${C.reset}  ${C.dim}spent:${C.reset} ${C.bold}${formatCost(totalSpend)}${C.reset}  ${C.dim}remaining:${C.reset} ${remainColor}${C.bold}${formatCost(remaining)}${C.reset}`);
      }

      lines.push('');
      lines.push(`  ${C.bold}${C.cyan}RECENT THREADS${C.reset}`);
      for (const thread of codexData.recentThreads || []) {
        const cwd = thread.matchCwd ? `${C.green}cwd${C.reset}` : `${C.dim}other${C.reset}`;
        const live = thread.liveDataFound ? `${C.blue}live${C.reset}` : `${C.dim}no-live${C.reset}`;
        const workspace = thread.workspaceLabel ? `${C.dim}${thread.workspaceLabel}${C.reset}` : `${C.dim}unknown${C.reset}`;
        const threadName = thread.matchCwd ? `${C.bold}${thread.threadName}${C.reset}` : thread.threadName;
        lines.push(`  ${threadName}  ${workspace}  ${cwd}  ${live}`);
      }
    }
  } else if (activeTab === 'activity') {
    renderActivityPanel(lines, analytics, width);
  } else if (activeTab === 'scoring') {
    renderScoringPanel(lines, analytics, width);
  } else if (activeTab === 'breakdown') {
    renderEnabledBreakdowns(lines, analytics, visibility, width);
  } else if (activeTab === 'advisor') {
    renderAdvisorPanel(lines, buildCodexAdvisorMessages(codexData, summary, analytics, budget, now.getTime()), width, ascii);
  } else if (activeTab === 'summary') {
    renderCodexPeriodSummary(lines, summary, width, barWidth, g);
  } else if (activeTab === 'settings') {
    renderSettingsPanel(lines, 'codex', analyticsVisibility, width);
  }

  lines.push('');
  lines.push(`  ${horizontalLine(width - 2, g.line)}`);
  lines.push(renderFooter(width, 'codex', 'detail'));
  lines.push('');
  return lines.map(line => fitAnsiLine(line, screenWidth)).join('\n');
}

export function renderDashboard(state) {
  const cols = state.cols || process.stdout.columns || 80;
  const screenWidth = Math.max(20, cols - 1);
  const width = Math.min(screenWidth - 2, 140);
  const now = new Date();
  const envLocale = `${process.env.LC_ALL || ''} ${process.env.LC_CTYPE || ''} ${process.env.LANG || ''}`;
  const ascii = Boolean(
    state.ascii ||
    process.env.TG_ASCII === '1' ||
    process.env.TG_ASCII === 'true' ||
    !/UTF-8|UTF8/i.test(envLocale)
  );

  const budget = state.budget || 0;

  if (state.viewMode === 'compact') {
    return renderCompact(
      state.provider,
      state.claudeSessions || [],
      state.codexData || null,
      width,
      screenWidth,
      now,
      ascii,
      budget,
      state.provider === 'claude' ? (state.claudeSummary || null) : (state.codexSummary || null),
      state.period || '7d',
    );
  }

  if (state.provider === 'codex') {
    return renderCodexDetail(
      state.codexData || null,
      state.codexSummary || null,
      state.codexAnalytics || null,
      width,
      screenWidth,
      now,
      ascii,
      budget,
      state.period || '7d',
      state.detailTab || 'overview',
      state.analyticsVisibility || null,
    );
  }

  return renderClaudeDetail(
    state.claudeSessions || [],
    state.claudeSummary || null,
    state.claudeAnalytics || null,
    state.claudeProjectMetrics || [],
    state.claudeRateLimits || null,
    width,
    screenWidth,
    now,
    ascii,
    budget,
    state.period || '7d',
    state.detailTab || 'overview',
    state.analyticsVisibility || null,
  );
}
