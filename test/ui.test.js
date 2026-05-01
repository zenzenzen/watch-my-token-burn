import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { collectProjectMetrics, collectSessions } from '../src/collector.js';
import { collectCodexData } from '../src/codex.js';
import { renderDashboard } from '../src/ui.js';

const claudeFixtureRoot = join(process.cwd(), 'test', 'fixtures', 'claude');
const codexFixtureRoot = join(process.cwd(), 'test', 'fixtures', 'codex');

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function maxVisibleWidth(output) {
  return Math.max(...output.split('\n').map(line => stripAnsi(line).length));
}

const claudeSessions = collectSessions({
  claudeDir: join(claudeFixtureRoot, '.claude'),
});
const claudeProjectMetrics = collectProjectMetrics({
  claudeJsonPath: join(claudeFixtureRoot, '.claude.json'),
});

const codexData = collectCodexData({
  codexDir: join(codexFixtureRoot, '.codex'),
  cwd: '/Users/dev/ai-gen-tooling',
});

const claudeSummary = {
  period: '7d',
  window: { timezone: 'local', start: '2026-03-28T00:00:00.000', end: '2026-04-03T23:59:59.999', label: 'Last 7 days' },
  totalTokens: 5500,
  sessionCount: 1,
  estimatedCost: 0.17,
  billedCost: 0.6,
  daily: [
    { label: 'Sat', tokens: 0, estimatedCost: 0, isToday: false },
    { label: 'Sun', tokens: 0, estimatedCost: 0, isToday: false },
    { label: 'Mon', tokens: 0, estimatedCost: 0, isToday: false },
    { label: 'Tue', tokens: 0, estimatedCost: 0, isToday: false },
    { label: 'Wed', tokens: 0, estimatedCost: 0, isToday: false },
    { label: 'Thu', tokens: 0, estimatedCost: 0, isToday: false },
    { label: 'Fri', tokens: 5500, estimatedCost: 0.17, isToday: true },
  ],
};
const claudeAnalytics = {
  window: claudeSummary.window,
  totals: { turns: 2, sessions: 1, tokens: 5500, estimatedCost: 0.17 },
  categoryBreakdown: [
    { category: 'coding', turns: 1, tokens: 3700, estimatedCost: 0.11, editTurns: 1, retryTurns: 1, oneShotTurns: 0, oneShotRate: 0 },
    { category: 'testing', turns: 1, tokens: 1800, estimatedCost: 0.06, editTurns: 0, retryTurns: 0, oneShotTurns: 0, oneShotRate: null },
  ],
  chatScoring: [
    { sessionId: 'claude-1', label: 'project-one', turns: 2, tokens: 5500, estimatedCost: 0.17, contextTokens: 42000, contextLimit: 200000, avgTokensPerTurn: 2750, contextPerTurn: 21000, score: 53, tokenEfficiencyScore: 96, contextEfficiencyScore: 0 },
  ],
  toolBreakdown: [
    { tool: 'exec_command', calls: 1, turns: 1, tokens: 1800, estimatedCost: 0.06 },
    { tool: 'apply_patch', calls: 1, turns: 1, tokens: 3700, estimatedCost: 0.11 },
  ],
  mcpBreakdown: [
    { server: 'playwright', calls: 1, turns: 1, tokens: 900, estimatedCost: 0.03 },
  ],
  bashBreakdown: [
    { command: 'pytest', calls: 1, turns: 1, tokens: 1800, estimatedCost: 0.06 },
    { command: 'git status', calls: 1, turns: 1, tokens: 600, estimatedCost: 0.02 },
  ],
};
const claudeRateLimits = {
  primary: { usedPercent: 41, resetsAt: 1775191480 },
  secondary: { usedPercent: 12, resetsAt: 1775634396 },
  updatedAt: '2026-04-12T10:00:00.000Z',
};

const codexSummary = {
  period: '7d',
  window: { timezone: 'local', start: '2026-03-28T00:00:00.000', end: '2026-04-03T23:59:59.999', label: 'Last 7 days' },
  totalTokens: 12000,
  sessionCount: 3,
  estimatedCost: 0.08,
  daily: [
    { label: 'Sat', tokens: 0, isToday: false },
    { label: 'Sun', tokens: 0, isToday: false },
    { label: 'Mon', tokens: 2000, isToday: false },
    { label: 'Tue', tokens: 4000, isToday: false },
    { label: 'Wed', tokens: 3000, isToday: false },
    { label: 'Thu', tokens: 0, isToday: false },
    { label: 'Fri', tokens: 3000, isToday: true },
  ],
};
const codexAnalytics = {
  window: codexSummary.window,
  totals: { turns: 3, sessions: 2, tokens: 12000, estimatedCost: 0.08 },
  categoryBreakdown: [
    { category: 'coding', turns: 2, tokens: 9000, estimatedCost: 0.06, editTurns: 2, retryTurns: 1, oneShotTurns: 1, oneShotRate: 0.5 },
    { category: 'exploration', turns: 1, tokens: 3000, estimatedCost: 0.02, editTurns: 0, retryTurns: 0, oneShotTurns: 0, oneShotRate: null },
  ],
  chatScoring: [
    { sessionId: 'codex-1', label: 'Matching tg thread', turns: 3, tokens: 12000, estimatedCost: 0.08, contextTokens: 6000, contextLimit: 200000, avgTokensPerTurn: 4000, contextPerTurn: 2000, score: 92, tokenEfficiencyScore: 89, contextEfficiencyScore: 96 },
  ],
  toolBreakdown: [
    { tool: 'exec_command', calls: 2, turns: 2, tokens: 7000, estimatedCost: 0.05 },
    { tool: 'mcp__playwright__browser_snapshot', calls: 1, turns: 1, tokens: 3000, estimatedCost: 0.02 },
  ],
  mcpBreakdown: [
    { server: 'playwright', calls: 1, turns: 1, tokens: 3000, estimatedCost: 0.02 },
  ],
  bashBreakdown: [
    { command: 'pytest', calls: 1, turns: 1, tokens: 4000, estimatedCost: 0.03 },
  ],
};

test('renderDashboard smoke tests all four screens', () => {
  const claudeCompact = renderDashboard({
    provider: 'claude',
    viewMode: 'compact',
    claudeSessions,
    claudeSummary,
    claudeProjectMetrics,
    claudeRateLimits,
    codexData,
    period: '7d',
    cols: 100,
  });
  const claudeDetail = renderDashboard({
    provider: 'claude',
    viewMode: 'detail',
    claudeSessions,
    claudeSummary,
    claudeAnalytics,
    claudeProjectMetrics,
    claudeRateLimits,
    codexData,
    period: '7d',
    cols: 100,
  });
  const codexCompact = renderDashboard({
    provider: 'codex',
    viewMode: 'compact',
    claudeSessions,
    codexSummary,
    codexData,
    period: '7d',
    cols: 100,
  });
  const codexDetail = renderDashboard({
    provider: 'codex',
    viewMode: 'detail',
    claudeSessions,
    codexData,
    codexSummary,
    codexAnalytics,
    period: '7d',
    cols: 100,
  });

  assert.match(stripAnsi(claudeCompact), /TOKEN GAUGE/);
  assert.match(stripAnsi(claudeCompact), /project-one/);
  assert.match(stripAnsi(claudeCompact), /cache 33%/);
  assert.match(stripAnsi(claudeDetail), /OVERVIEW/);
  assert.match(stripAnsi(claudeDetail), /ACTIVITY/);
  assert.match(stripAnsi(claudeDetail), /SCORING/);
  assert.match(stripAnsi(claudeDetail), /BREAKDOWN/);
  assert.match(stripAnsi(claudeDetail), /ADVISOR/);
  assert.match(stripAnsi(claudeDetail), /SUMMARY/);
  assert.match(stripAnsi(claudeDetail), /SETTINGS/);
  assert.match(stripAnsi(claudeDetail), /PRIMARY LIMIT/);
  assert.match(stripAnsi(claudeDetail), /SECONDARY LIMIT/);
  assert.match(stripAnsi(claudeDetail), /Claude rate limits cached from hook data/);
  assert.match(stripAnsi(claudeDetail), /PROJECT BILLING/);
  assert.match(stripAnsi(claudeDetail), /project-one/);
  assert.match(stripAnsi(claudeDetail), /billed: \$0\.42/);
  assert.match(stripAnsi(claudeDetail), /cache hit: 33%/);
  assert.match(stripAnsi(claudeDetail), /SESSION BURN/);
  assert.match(stripAnsi(claudeDetail), /avg \$[0-9.]+\/hr/);
  assert.match(stripAnsi(codexCompact), /Matching tg thread/);
  assert.match(stripAnsi(codexCompact), /cache 38%/);
  assert.match(stripAnsi(codexDetail), /OVERVIEW/);
  assert.match(stripAnsi(codexDetail), /ACTIVITY/);
  assert.match(stripAnsi(codexDetail), /SCORING/);
  assert.match(stripAnsi(codexDetail), /BREAKDOWN/);
  assert.match(stripAnsi(codexDetail), /ADVISOR/);
  assert.match(stripAnsi(codexDetail), /SUMMARY/);
  assert.match(stripAnsi(codexDetail), /SETTINGS/);
  assert.match(stripAnsi(codexDetail), /PRIMARY LIMIT/);
  assert.match(stripAnsi(codexDetail), /cache hit: 38%/);
  assert.match(stripAnsi(codexDetail), /SESSION BURN/);
  assert.match(stripAnsi(codexDetail), /avg \$[0-9.]+\/hr/);
  assert.match(stripAnsi(codexDetail), /RECENT THREADS/);
});

test('renderDashboard keeps lines within the requested width', () => {
  const outputs = [
    renderDashboard({
      provider: 'claude',
      viewMode: 'compact',
      claudeSessions,
      claudeSummary,
      claudeProjectMetrics,
      claudeRateLimits,
      codexData,
      period: '7d',
      cols: 50,
    }),
    renderDashboard({
      provider: 'claude',
      viewMode: 'detail',
      claudeSessions,
      claudeSummary,
      claudeAnalytics,
      claudeProjectMetrics,
      claudeRateLimits,
      codexData,
      period: '7d',
      cols: 50,
    }),
    renderDashboard({
      provider: 'codex',
      viewMode: 'compact',
      claudeSessions,
      codexData,
      codexSummary,
      period: '7d',
      cols: 50,
    }),
    renderDashboard({
      provider: 'codex',
      viewMode: 'detail',
      claudeSessions,
      codexData,
      codexSummary,
      codexAnalytics,
      period: '7d',
      cols: 50,
    }),
  ];

  for (const output of outputs) {
    assert.ok(maxVisibleWidth(output) <= 49, `output exceeded width:\n${stripAnsi(output)}`);
  }
});

test('renderDashboard shows budget remaining when budget is set', () => {
  const claudeDetail = renderDashboard({
    provider: 'claude',
    viewMode: 'detail',
    claudeSessions,
    claudeSummary,
    claudeAnalytics,
    claudeProjectMetrics,
    claudeRateLimits,
    codexData,
    period: '7d',
    cols: 100,
    budget: 50,
  });
  const codexDetail = renderDashboard({
    provider: 'codex',
    viewMode: 'detail',
    claudeSessions,
    codexData,
    codexSummary,
    codexAnalytics,
    period: '7d',
    cols: 100,
    budget: 50,
  });

  assert.match(stripAnsi(claudeDetail), /BUDGET/);
  assert.match(stripAnsi(claudeDetail), /\$50\.00/);
  assert.match(stripAnsi(codexDetail), /BUDGET/);
});

test('renderDashboard detail sub-tabs render only the selected analytics section', () => {
  const claudeActivity = renderDashboard({
    provider: 'claude',
    viewMode: 'detail',
    detailTab: 'activity',
    analyticsVisibility: {
      claude: { activity: true, tools: true, mcp: true, bash: true, advisor: true, summary: true },
      codex: { activity: true, tools: true, mcp: true, bash: true, advisor: true, summary: true },
    },
    claudeSessions,
    claudeSummary,
    claudeAnalytics,
    claudeProjectMetrics,
    claudeRateLimits,
    cols: 100,
  });
  const codexAdvisor = renderDashboard({
    provider: 'codex',
    viewMode: 'detail',
    detailTab: 'advisor',
    analyticsVisibility: {
      claude: { activity: true, tools: true, mcp: true, bash: true, advisor: true, summary: true },
      codex: { activity: true, tools: true, mcp: true, bash: true, advisor: true, summary: true },
    },
    codexData,
    codexSummary,
    codexAnalytics,
    cols: 100,
  });

  assert.match(stripAnsi(claudeActivity), /ACTIVITY/);
  assert.doesNotMatch(stripAnsi(claudeActivity), /PROJECT BILLING/);
  assert.doesNotMatch(stripAnsi(claudeActivity), /PERIOD SUMMARY/);
  assert.match(stripAnsi(codexAdvisor), /EFFICIENCY ADVISOR/);
  assert.doesNotMatch(stripAnsi(codexAdvisor), /RECENT THREADS/);
  assert.doesNotMatch(stripAnsi(codexAdvisor), /PERIOD SUMMARY/);
});

test('renderDashboard scoring tab shows per-chat efficiency scores', () => {
  const output = renderDashboard({
    provider: 'codex',
    viewMode: 'detail',
    detailTab: 'scoring',
    codexData,
    codexSummary,
    codexAnalytics,
    cols: 100,
  });

  const cleaned = stripAnsi(output);
  assert.match(cleaned, /CHAT SCORING/);
  assert.match(cleaned, /Matching tg thread/);
  assert.match(cleaned, /tok\/turn/);
  assert.match(cleaned, /ctx\/turn/);
  assert.doesNotMatch(cleaned, /TOOLS/);
});

test('renderDashboard settings tab reflects analytics toggles and breakdown availability', () => {
  const settingsOutput = renderDashboard({
    provider: 'codex',
    viewMode: 'detail',
    detailTab: 'settings',
    analyticsVisibility: {
      claude: { activity: true, tools: true, mcp: true, bash: true, advisor: true, summary: true },
      codex: { activity: false, tools: true, mcp: false, bash: false, advisor: true, summary: true },
    },
    codexData,
    codexSummary,
    codexAnalytics,
    cols: 100,
  });
  const breakdownOutput = renderDashboard({
    provider: 'codex',
    viewMode: 'detail',
    detailTab: 'settings',
    analyticsVisibility: {
      claude: { activity: true, tools: true, mcp: true, bash: true, advisor: true, summary: true },
      codex: { activity: true, tools: false, mcp: false, bash: false, advisor: true, summary: true },
    },
    codexData,
    codexSummary,
    codexAnalytics,
    cols: 100,
  });

  assert.match(stripAnsi(settingsOutput), /CODEX SETTINGS/);
  assert.match(stripAnsi(settingsOutput), /Activity +off/);
  assert.match(stripAnsi(settingsOutput), /Scoring +ON/);
  assert.match(stripAnsi(settingsOutput), /Tools +ON/);
  assert.match(stripAnsi(settingsOutput), /4\/7 analytics panels enabled/);
  assert.doesNotMatch(stripAnsi(breakdownOutput), /BREAKDOWN/);
  assert.match(stripAnsi(breakdownOutput), /CODEX SETTINGS/);
});

test('renderDashboard codex detail shows fallback when no period data provided', () => {
  const output = renderDashboard({
    provider: 'codex',
    viewMode: 'detail',
    detailTab: 'summary',
    claudeSessions,
    codexData,
    period: '7d',
    cols: 100,
  });

  assert.match(stripAnsi(output), /PERIOD SUMMARY/);
  assert.match(stripAnsi(output), /No period data available yet/);
});

test('renderDashboard ASCII mode avoids Unicode powerline glyphs', () => {
  const output = renderDashboard({
    provider: 'codex',
    viewMode: 'compact',
    claudeSessions,
    codexData,
    codexSummary,
    period: '7d',
    cols: 100,
    ascii: true,
  });

  const cleaned = stripAnsi(output);
  assert.doesNotMatch(cleaned, /[◄●○…─]/);
  assert.match(cleaned, />/);
  assert.match(cleaned, /-/);
});
