import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { collectSessions } from '../src/collector.js';
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

const codexData = collectCodexData({
  codexDir: join(codexFixtureRoot, '.codex'),
  cwd: '/Users/dev/ai-gen-tooling',
});

const weeklyData = {
  totalTokens: 5500,
  sessionCount: 1,
  estimatedCost: 0.25,
  daily: [
    { label: 'Sat', tokens: 0, isToday: false },
    { label: 'Sun', tokens: 0, isToday: false },
    { label: 'Mon', tokens: 0, isToday: false },
    { label: 'Tue', tokens: 0, isToday: false },
    { label: 'Wed', tokens: 0, isToday: false },
    { label: 'Thu', tokens: 0, isToday: false },
    { label: 'Fri', tokens: 5500, isToday: true },
  ],
};

test('renderDashboard smoke tests all four screens', () => {
  const claudeCompact = renderDashboard({
    provider: 'claude',
    viewMode: 'compact',
    claudeSessions,
    claudeWeeklyData: weeklyData,
    codexData,
    cols: 100,
  });
  const claudeDetail = renderDashboard({
    provider: 'claude',
    viewMode: 'detail',
    claudeSessions,
    claudeWeeklyData: weeklyData,
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
    cols: 100,
  });

  assert.match(stripAnsi(claudeCompact), /TOKEN GAUGE/);
  assert.match(stripAnsi(claudeCompact), /project-one/);
  assert.match(stripAnsi(claudeDetail), /WEEKLY SUMMARY/);
  assert.match(stripAnsi(codexCompact), /Matching tg thread/);
  assert.match(stripAnsi(codexDetail), /PRIMARY LIMIT/);
  assert.match(stripAnsi(codexDetail), /RECENT THREADS/);
});

test('renderDashboard keeps lines within the requested width', () => {
  const outputs = [
    renderDashboard({
      provider: 'claude',
      viewMode: 'compact',
      claudeSessions,
      claudeWeeklyData: weeklyData,
      codexData,
      cols: 50,
    }),
    renderDashboard({
      provider: 'claude',
      viewMode: 'detail',
      claudeSessions,
      claudeWeeklyData: weeklyData,
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
