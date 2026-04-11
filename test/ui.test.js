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

const weeklyData = {
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
const claudeRateLimits = {
  primary: { usedPercent: 41, resetsAt: 1775191480 },
  secondary: { usedPercent: 12, resetsAt: 1775634396 },
  updatedAt: '2026-04-12T10:00:00.000Z',
};

const codexWeeklyData = {
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

test('renderDashboard smoke tests all four screens', () => {
  const claudeCompact = renderDashboard({
    provider: 'claude',
    viewMode: 'compact',
    claudeSessions,
    claudeWeeklyData: weeklyData,
    claudeProjectMetrics,
    claudeRateLimits,
    codexData,
    cols: 100,
  });
  const claudeDetail = renderDashboard({
    provider: 'claude',
    viewMode: 'detail',
    claudeSessions,
    claudeWeeklyData: weeklyData,
    claudeProjectMetrics,
    claudeRateLimits,
    codexData,
    cols: 100,
  });
  const codexCompact = renderDashboard({
    provider: 'codex',
    viewMode: 'compact',
    claudeSessions,
    claudeWeeklyData: weeklyData,
    codexData,
    cols: 100,
  });
  const codexDetail = renderDashboard({
    provider: 'codex',
    viewMode: 'detail',
    claudeSessions,
    claudeWeeklyData: weeklyData,
    codexData,
    codexWeeklyData,
    cols: 100,
  });

  assert.match(stripAnsi(claudeCompact), /TOKEN GAUGE/);
  assert.match(stripAnsi(claudeCompact), /project-one/);
  assert.match(stripAnsi(claudeCompact), /cache 33%/);
  assert.match(stripAnsi(claudeDetail), /WEEKLY SUMMARY/);
  assert.match(stripAnsi(claudeDetail), /PRIMARY LIMIT/);
  assert.match(stripAnsi(claudeDetail), /SECONDARY LIMIT/);
  assert.match(stripAnsi(claudeDetail), /Claude rate limits cached from hook data/);
  assert.match(stripAnsi(claudeDetail), /PROJECT BILLING/);
  assert.match(stripAnsi(claudeDetail), /EFFICIENCY ADVISOR/);
  assert.match(stripAnsi(claudeDetail), /Cache hits are only 33%/);
  assert.match(stripAnsi(claudeDetail), /project-one/);
  assert.match(stripAnsi(claudeDetail), /billed: \$0\.42/);
  assert.match(stripAnsi(claudeDetail), /est: \$0\.170/);
  assert.match(stripAnsi(claudeDetail), /cache hit: 33%/);
  assert.match(stripAnsi(claudeDetail), /SESSION BURN/);
  assert.match(stripAnsi(claudeDetail), /avg \$[0-9.]+\/hr/);
  assert.match(stripAnsi(codexCompact), /Matching tg thread/);
  assert.match(stripAnsi(codexCompact), /cache 38%/);
  assert.match(stripAnsi(codexDetail), /PRIMARY LIMIT/);
  assert.match(stripAnsi(codexDetail), /cache hit: 38%/);
  assert.match(stripAnsi(codexDetail), /SESSION BURN/);
  assert.match(stripAnsi(codexDetail), /EFFICIENCY ADVISOR/);
  assert.match(stripAnsi(codexDetail), /Cache hits are only 38%/);
  assert.match(stripAnsi(codexDetail), /avg \$[0-9.]+\/hr/);
  assert.match(stripAnsi(codexDetail), /RECENT THREADS/);
  assert.match(stripAnsi(codexDetail), /WEEKLY SUMMARY/);
});

test('renderDashboard keeps lines within the requested width', () => {
  const outputs = [
    renderDashboard({
      provider: 'claude',
      viewMode: 'compact',
      claudeSessions,
      claudeWeeklyData: weeklyData,
      claudeProjectMetrics,
      claudeRateLimits,
      codexData,
      cols: 50,
    }),
    renderDashboard({
      provider: 'claude',
      viewMode: 'detail',
      claudeSessions,
      claudeWeeklyData: weeklyData,
      claudeProjectMetrics,
      claudeRateLimits,
      codexData,
      cols: 50,
    }),
    renderDashboard({
      provider: 'codex',
      viewMode: 'compact',
      claudeSessions,
      claudeWeeklyData: weeklyData,
      codexData,
      cols: 50,
    }),
    renderDashboard({
      provider: 'codex',
      viewMode: 'detail',
      claudeSessions,
      claudeWeeklyData: weeklyData,
      codexData,
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
    claudeWeeklyData: weeklyData,
    claudeProjectMetrics,
    claudeRateLimits,
    codexData,
    cols: 100,
    budget: 50,
  });
  const codexDetail = renderDashboard({
    provider: 'codex',
    viewMode: 'detail',
    claudeSessions,
    claudeWeeklyData: weeklyData,
    codexData,
    cols: 100,
    budget: 50,
  });

  assert.match(stripAnsi(claudeDetail), /BUDGET/);
  assert.match(stripAnsi(claudeDetail), /\$50\.00/);
  assert.match(stripAnsi(codexDetail), /BUDGET/);
});

test('renderDashboard codex detail shows fallback when no weekly data provided', () => {
  const output = renderDashboard({
    provider: 'codex',
    viewMode: 'detail',
    claudeSessions,
    codexData,
    cols: 100,
  });

  assert.match(stripAnsi(output), /WEEKLY SUMMARY/);
  assert.match(stripAnsi(output), /No weekly data available yet/);
});

test('renderDashboard ASCII mode avoids Unicode powerline glyphs', () => {
  const output = renderDashboard({
    provider: 'codex',
    viewMode: 'compact',
    claudeSessions,
    claudeWeeklyData: weeklyData,
    codexData,
    cols: 100,
    ascii: true,
  });

  const cleaned = stripAnsi(output);
  assert.doesNotMatch(cleaned, /[◄●○…─]/);
  assert.match(cleaned, />/);
  assert.match(cleaned, /-/);
});
