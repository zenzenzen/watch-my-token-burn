import { MODEL_PRICING, CODEX_PRICING } from './pricing.js';
import { formatModelName, basenameLabel, stripAnsi, primaryClaudeSession } from './format.js';

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

function renderHeader({ provider, viewMode, width, now }) {
  const title = `${C.bold}${C.cyan}  TOKEN GAUGE${C.reset}`;
  const tabs = renderTabs(provider);
  const mode = `${bgHex(THEME.panelAlt)}${fgHex(THEME.text)} ${viewMode.toUpperCase()} ${C.reset}`;
  const right = `${tabs} ${mode}  ${C.dim}${formatTime(now)}${C.reset}`;
  const pad = Math.max(1, width - stripAnsi(title).length - stripAnsi(right).length);
  return title + ' '.repeat(pad) + right;
}

function renderFooter(width, provider, viewMode) {
  const parts = ['q:quit', 'r:refresh', 'v:view', '[:prev', ']:next'];
  if (provider === 'claude' && viewMode === 'detail') parts.push('c:clear stale');
  return `  ${C.dim}${parts.join('  ')}${C.reset}`;
}

function renderCompactFooter(width) {
  return `  ${C.dim}q:quit  r:refresh  v:view  [:prev  ]:next${C.reset}`;
}

function compactClaudeSegments(sessions, ascii, budget = 0, weeklyData = null) {
  const session = primaryClaudeSession(sessions);
  if (!session) return [];

  const status = sessionStatus(session);
  const sessionCost = sessions.reduce((sum, s) => sum + getSessionCost(s.model, s.totals), 0);
  const totalSpend = weeklyData?.estimatedCost ?? sessionCost;
  const segments = [
    { text: truncateText(session.projectName || 'unknown', 18, ascii), bg: THEME.bubblegum, fg: THEME.text },
    { text: formatModelName(session.model), bg: THEME.ocean, fg: THEME.text },
    { text: `${formatPercent((session.context.total / getContextLimit(session.model)) * 100)} of ${formatTokens(getContextLimit(session.model))}`, bg: THEME.emerald, fg: THEME.ink },
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
  const segments = [
    { text: truncateText(active.threadName || active.workspaceLabel || 'Codex', 18, ascii), bg: THEME.bubblegum, fg: THEME.text },
    { text: 'Codex', bg: THEME.ocean, fg: THEME.text },
    { text: `5h ${formatPercent(primary?.usedPercent)}`, bg: THEME.golden, fg: THEME.ink },
    { text: `7d ${formatPercent(secondary?.usedPercent)}`, bg: THEME.emerald, fg: THEME.ink },
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

function renderCompact(provider, sessions, codexData, width, screenWidth, now, ascii, budget = 0, weeklyData = null) {
  const lines = [];
  lines.push('');
  lines.push(renderHeader({ provider, viewMode: 'compact', width, now }));
  lines.push('');

  if (provider === 'claude') {
    const segments = compactClaudeSegments(sessions, ascii, budget, weeklyData);
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

  return renderPowerline([
    { text: sessions.length === 1 ? primary.projectName : `${sessions.length} sessions`, bg: THEME.bubblegum, fg: THEME.text },
    { text: primary.model !== 'unknown' ? formatModelName(primary.model) : `${activeSessions.length} active`, bg: THEME.ocean, fg: THEME.text },
    { text: formatCost(totalCost), bg: THEME.golden, fg: THEME.ink },
    { text: `${formatPercent((totalContext / getContextLimit(primary.model)) * 100)} of ${formatTokens(getContextLimit(primary.model))}`, bg: THEME.emerald, fg: THEME.ink },
    { text: `${formatTokens(totalTokens)} tokens`, bg: THEME.panelSoft, fg: THEME.text },
  ], ascii);
}

function renderClaudeDetail(sessions, weeklyData, width, screenWidth, now, ascii, budget = 0) {
  const barWidth = Math.max(30, width - 22);
  const lines = [];
  const g = glyphs(ascii);

  lines.push('');
  lines.push(renderHeader({ provider: 'claude', viewMode: 'detail', width, now }));

  if (sessions.length > 0) {
    lines.push('');
    lines.push(`  ${renderClaudeSummaryStrip(sessions, ascii)}`);
  }

  lines.push('');
  lines.push(`  ${horizontalLine(width - 2, g.line)}`);

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
      const sessionBar = solidBar([
        { value: mainTokens, bg: C.bgBlue },
        { value: session.totals.latestTotal, bg: C.bgPurple },
      ], session.totals.totalTokens, barWidth);

      lines.push('');
      lines.push(`  ${C.dim}SESSION TOKENS${C.reset}  ${C.bold}${formatTokens(session.totals.totalTokens)}${C.reset} ${C.dim}total${C.reset}  ${C.dim}(in: ${formatTokens(session.totals.totalInput + session.totals.totalCacheRead + session.totals.totalCacheCreate)}  out: ${formatTokens(session.totals.totalOutput)})${C.reset}  ${C.dim}cost:${C.reset} ${C.bold}${formatCost(cost)}${C.reset}`);
      lines.push(`  ${sessionBar}`);
      lines.push('');
      lines.push(`  ${dot(C.bgBlue, `${C.blue}cumulative ${formatTokens(session.totals.totalTokens)}${C.reset}`)}  ${dot(C.bgPurple, `${C.purple}latest turn ${formatTokens(session.totals.latestTotal)}${C.reset}`)}`);
      lines.push('');
    }
  }

  if (budget > 0) {
    const sessionCost = sessions.reduce((sum, s) => sum + getSessionCost(s.model, s.totals), 0);
    const totalSpend = weeklyData?.estimatedCost ?? sessionCost;
    const remaining = budget - totalSpend;
    const remainColor = remaining >= 0 ? C.green : C.red;
    lines.push('');
    lines.push(`  ${horizontalLine(width - 2)}`);
    lines.push(`  ${C.bold}${C.cyan}BUDGET${C.reset}  ${C.dim}limit:${C.reset} ${C.bold}${formatCost(budget)}${C.reset}  ${C.dim}spent:${C.reset} ${C.bold}${formatCost(totalSpend)}${C.reset}  ${C.dim}remaining:${C.reset} ${remainColor}${C.bold}${formatCost(remaining)}${C.reset}`);
  }

  lines.push('');
  lines.push(`  ${horizontalLine(width - 2)}`);
  lines.push(`  ${C.bold}${C.cyan}WEEKLY SUMMARY${C.reset}`);

  if (weeklyData) {
    lines.push(`  ${C.dim}Total:${C.reset} ${C.bold}${formatTokens(weeklyData.totalTokens)}${C.reset} tokens  ${C.dim}|${C.reset}  ${C.bold}${weeklyData.sessionCount}${C.reset} sessions  ${C.dim}|${C.reset}  ${C.bold}${formatCost(weeklyData.estimatedCost)}${C.reset} est.`);
    renderWeeklyChart(lines, weeklyData, barWidth, g);
  } else {
    lines.push(`  ${C.dim}No weekly data available yet.${C.reset}`);
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

function renderCodexSummaryStrip(active, ascii) {
  if (!active) return '';
  return renderPowerline([
    { text: truncateText(active.threadName || active.workspaceLabel || 'Codex', 18, ascii), bg: THEME.bubblegum, fg: THEME.text },
    { text: 'Codex', bg: THEME.ocean, fg: THEME.text },
    { text: `5h ${formatPercent(active.rateLimits?.primary?.usedPercent)}`, bg: THEME.golden, fg: THEME.ink },
    { text: `7d ${formatPercent(active.rateLimits?.secondary?.usedPercent)}`, bg: THEME.emerald, fg: THEME.ink },
    { text: `${formatTokens(active.currentContextTokens)} ctx`, bg: THEME.panelAlt, fg: THEME.text },
    { text: `${formatTokens(active.totalTokens)} tok`, bg: THEME.panelSoft, fg: THEME.text },
  ], ascii);
}

function renderCodexDetail(codexData, width, screenWidth, now, ascii, budget = 0, codexWeeklyData = null) {
  const lines = [];
  const active = codexData?.activeSession || null;
  const barWidth = Math.max(30, width - 22);
  const g = glyphs(ascii);

  lines.push('');
  lines.push(renderHeader({ provider: 'codex', viewMode: 'detail', width, now }));

  if (active) {
    lines.push('');
    lines.push(`  ${renderCodexSummaryStrip(active, ascii)}`);
  }

  lines.push('');
  lines.push(`  ${horizontalLine(width - 2, g.line)}`);

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
    lines.push('');
    lines.push(`  ${C.dim}TOKEN TOTALS${C.reset}  ${C.bold}${formatTokens(active.totalTokens)}${C.reset} ${C.dim}total${C.reset}  ${C.dim}(last ${formatTokens(active.lastTokens)}  cache ${formatTokens(active.totalCachedInputTokens)}  out ${formatTokens(active.totalOutputTokens)}  reason ${formatTokens(active.totalReasoningOutputTokens)})${C.reset}  ${C.dim}cost:${C.reset} ${C.bold}${formatCost(sessionCost)}${C.reset}`);

    if (budget > 0) {
      const totalSpend = getCodexTotalCost(codexData);
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

  lines.push('');
  lines.push(`  ${horizontalLine(width - 2)}`);
  lines.push(`  ${C.bold}${C.cyan}WEEKLY SUMMARY${C.reset}`);

  if (codexWeeklyData) {
    lines.push(`  ${C.dim}Total:${C.reset} ${C.bold}${formatTokens(codexWeeklyData.totalTokens)}${C.reset} tokens  ${C.dim}|${C.reset}  ${C.bold}${codexWeeklyData.sessionCount}${C.reset} sessions  ${C.dim}|${C.reset}  ${C.bold}${formatCost(codexWeeklyData.estimatedCost)}${C.reset} est.`);
    renderWeeklyChart(lines, codexWeeklyData, barWidth, g);
  } else {
    lines.push(`  ${C.dim}No weekly data available yet.${C.reset}`);
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
    return renderCompact(state.provider, state.claudeSessions || [], state.codexData || null, width, screenWidth, now, ascii, budget, state.claudeWeeklyData || null);
  }

  if (state.provider === 'codex') {
    return renderCodexDetail(state.codexData || null, width, screenWidth, now, ascii, budget, state.codexWeeklyData || null);
  }

  return renderClaudeDetail(state.claudeSessions || [], state.claudeWeeklyData || null, width, screenWidth, now, ascii, budget);
}
