import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { refreshWeeklyData, summarizeWindow as summarizeClaudeWindow } from '../src/tracker.js';
import { refreshCodexWeeklyData, summarizeWindow as summarizeCodexWindow } from '../src/codex-tracker.js';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'token-gauge-tracker-'));
}

test('refreshWeeklyData writes weekly state and uses actual Claude project cost when available', () => {
  const root = makeTempDir();
  const weeklyFilePath = join(root, 'weekly.json');
  const claudeJsonPath = join(root, '.claude.json');
  const now = '2026-04-12T10:00:00.000Z';

  writeFileSync(claudeJsonPath, JSON.stringify({
    projects: {
      '/Users/dev/ai-gen-tooling/token-gauge': { lastCost: 1.25 },
      '/Users/dev/other': { lastCost: 0.75 },
    },
  }, null, 2));

  const summary = refreshWeeklyData({
    configDir: root,
    weeklyFilePath,
    claudeJsonPath,
    now,
    collectSessionsInRangeFn: () => [
      {
        sessionId: 's1',
        model: 'claude-sonnet-4-6',
        totals: { totalInput: 100, totalOutput: 50, totalCacheRead: 25, totalCacheCreate: 10, totalTokens: 185 },
      },
      {
        sessionId: 's1',
        model: 'claude-sonnet-4-6',
        totals: { totalInput: 100, totalOutput: 50, totalCacheRead: 25, totalCacheCreate: 10, totalTokens: 185 },
      },
      {
        sessionId: 's2',
        model: 'claude-haiku-4-5-20251001',
        totals: { totalInput: 80, totalOutput: 20, totalCacheRead: 10, totalCacheCreate: 5, totalTokens: 115 },
      },
    ],
  });

  assert.equal(summary.totalTokens, 485);
  assert.equal(summary.sessionCount, 2);
  assert.ok(Math.abs(summary.estimatedCost - 0.00234355) < 1e-12);
  assert.equal(summary.billedCost, 2);
  assert.equal(summary.daily.length, 7);
  assert.equal(summary.period, '7d');
  assert.equal(summary.window.timezone, 'local');

  const persisted = JSON.parse(readFileSync(weeklyFilePath, 'utf8'));
  assert.equal(persisted.days['2026-04-12'].tokens, 485);
  assert.equal(persisted.days['2026-04-12'].sessions, 2);
  assert.ok(Math.abs(persisted.days['2026-04-12'].estimatedCost - 0.00234355) < 1e-12);

  rmSync(root, { recursive: true, force: true });
});

test('refreshCodexWeeklyData writes weekly state and estimates cost from persisted token buckets', () => {
  const root = makeTempDir();
  const weeklyFilePath = join(root, 'codex-weekly.json');
  const now = '2026-04-12T10:00:00.000Z';

  const summary = refreshCodexWeeklyData({
    configDir: root,
    weeklyFilePath,
    now,
    collectAllCodexSessionsFn: () => [
      {
        latestTimestamp: '2026-04-12T02:00:00.000Z',
        totalTokens: 1000,
        totalInputTokens: 400,
        totalOutputTokens: 500,
        totalCachedInputTokens: 100,
      },
      {
        latestTimestamp: '2026-04-12T05:00:00.000Z',
        totalTokens: 3000,
        totalInputTokens: 1000,
        totalOutputTokens: 1200,
        totalCachedInputTokens: 800,
      },
      {
        latestTimestamp: '2026-04-10T05:00:00.000Z',
        totalTokens: 9999,
        totalInputTokens: 999,
        totalOutputTokens: 999,
        totalCachedInputTokens: 999,
      },
    ],
  });

  assert.equal(summary.totalTokens, 4000);
  assert.equal(summary.sessionCount, 2);
  assert.equal(summary.daily.length, 7);
  assert.ok(Math.abs(summary.estimatedCost - 0.0092675) < 1e-12);
  assert.equal(summary.daily[6].estimatedCost > 0, true);

  const persisted = JSON.parse(readFileSync(weeklyFilePath, 'utf8'));
  assert.equal(persisted.days['2026-04-12'].inputTokens, 1400);
  assert.equal(persisted.days['2026-04-12'].outputTokens, 1700);
  assert.equal(persisted.days['2026-04-12'].cachedTokens, 900);
  assert.ok(Math.abs(persisted.days['2026-04-12'].estimatedCost - 0.0092675) < 1e-12);

  rmSync(root, { recursive: true, force: true });
});

test('refreshWeeklyData merges shared weekly files across machines when aggregateDir is configured', () => {
  const root = makeTempDir();
  const aggregateDir = join(root, 'shared');
  const weeklyFilePath = join(root, 'weekly.json');
  const claudeJsonPath = join(root, '.claude.json');
  const now = '2026-04-12T10:00:00.000Z';
  mkdirSync(aggregateDir, { recursive: true });

  writeFileSync(claudeJsonPath, JSON.stringify({
    projects: {
      '/Users/dev/ai-gen-tooling/token-gauge': { lastCost: 1.25 },
    },
  }, null, 2));

  writeFileSync(join(aggregateDir, 'claude-weekly-beta.json'), JSON.stringify({
    machineId: 'beta',
    days: {
      '2026-04-11': { tokens: 50, estimatedCost: 0.05, sessions: 1 },
      '2026-04-12': { tokens: 100, estimatedCost: 0.1, sessions: 1 },
    },
  }, null, 2), { flag: 'w' });

  const summary = refreshWeeklyData({
    configDir: root,
    weeklyFilePath,
    claudeJsonPath,
    aggregateDir,
    machineId: 'alpha',
    now,
    collectSessionsInRangeFn: () => [
      {
        sessionId: 's1',
        model: 'claude-sonnet-4-6',
        totals: { totalInput: 100, totalOutput: 50, totalCacheRead: 25, totalCacheCreate: 10, totalTokens: 185 },
      },
    ],
  });

  assert.equal(summary.machineCount, 2);
  assert.equal(summary.totalTokens, 335);
  assert.equal(summary.sessionCount, 3);
  assert.equal(summary.billedCost, null);

  const mirrored = JSON.parse(readFileSync(join(aggregateDir, 'claude-weekly-alpha.json'), 'utf8'));
  assert.equal(mirrored.days['2026-04-12'].tokens, 185);

  rmSync(root, { recursive: true, force: true });
});

test('refreshCodexWeeklyData merges shared weekly files across machines when aggregateDir is configured', () => {
  const root = makeTempDir();
  const aggregateDir = join(root, 'shared');
  const weeklyFilePath = join(root, 'codex-weekly.json');
  const now = '2026-04-12T10:00:00.000Z';
  mkdirSync(aggregateDir, { recursive: true });

  writeFileSync(join(aggregateDir, 'codex-weekly-beta.json'), JSON.stringify({
    machineId: 'beta',
    days: {
      '2026-04-11': { tokens: 500, inputTokens: 200, outputTokens: 200, cachedTokens: 100, sessions: 1 },
      '2026-04-12': { tokens: 1000, inputTokens: 400, outputTokens: 300, cachedTokens: 300, sessions: 1 },
    },
  }, null, 2), { flag: 'w' });

  const summary = refreshCodexWeeklyData({
    configDir: root,
    weeklyFilePath,
    aggregateDir,
    machineId: 'alpha',
    now,
    collectAllCodexSessionsFn: () => [
      {
        latestTimestamp: '2026-04-12T02:00:00.000Z',
        totalTokens: 1000,
        totalInputTokens: 400,
        totalOutputTokens: 500,
        totalCachedInputTokens: 100,
      },
    ],
  });

  assert.equal(summary.machineCount, 2);
  assert.equal(summary.totalTokens, 2500);
  assert.equal(summary.sessionCount, 3);

  const mirrored = JSON.parse(readFileSync(join(aggregateDir, 'codex-weekly-alpha.json'), 'utf8'));
  assert.equal(mirrored.days['2026-04-12'].tokens, 1000);

  rmSync(root, { recursive: true, force: true });
});

test('summarizeWindow supports local today, 30d, and month windows with retained days', () => {
  const root = makeTempDir();
  const weeklyFilePath = join(root, 'weekly.json');

  const persistedDays = {};
  for (let day = 1; day <= 62; day++) {
    const key = `2026-03-${String(day).padStart(2, '0')}`;
    if (day <= 31) {
      persistedDays[key] = { tokens: day, estimatedCost: day / 100, sessions: 1 };
    }
  }
  persistedDays['2026-04-14'] = { tokens: 140, estimatedCost: 1.4, sessions: 2 };

  writeFileSync(weeklyFilePath, JSON.stringify({ days: persistedDays }, null, 2));

  const today = summarizeClaudeWindow({
    configDir: root,
    weeklyFilePath,
    now: '2026-04-15T10:00:00.000Z',
    period: 'today',
    collectSessionsInRangeFn: () => [],
  });
  assert.equal(today.daily.length, 1);
  assert.equal(today.period, 'today');

  const rolling = summarizeClaudeWindow({
    configDir: root,
    weeklyFilePath,
    now: '2026-04-15T10:00:00.000Z',
    period: '30d',
    collectSessionsInRangeFn: () => [],
  });
  assert.equal(rolling.daily.length, 30);

  const month = summarizeCodexWindow({
    configDir: root,
    weeklyFilePath: join(root, 'codex-weekly.json'),
    now: '2026-04-15T10:00:00.000Z',
    period: 'month',
    collectAllCodexSessionsFn: () => [],
  });
  assert.equal(month.daily.length, 15);

  rmSync(root, { recursive: true, force: true });
});
