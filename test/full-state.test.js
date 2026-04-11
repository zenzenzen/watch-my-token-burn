import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { collectStandaloneState } from '../src/full-state.js';

const fixtureRoot = join(process.cwd(), 'test', 'fixtures');

test('collectStandaloneState returns full standalone json state for both providers', () => {
  const state = collectStandaloneState({
    provider: 'claude',
    viewMode: 'detail',
    budget: 50,
  }, {
    cwd: '/Users/dev/ai-gen-tooling',
    generatedAt: '2026-04-12T10:00:00.000Z',
    claudeCollectorOpts: {
      claudeDir: join(fixtureRoot, 'claude', '.claude'),
      claudeJsonPath: join(fixtureRoot, 'claude', '.claude.json'),
      configDir: join(fixtureRoot, 'state-config'),
      useScanIndex: false,
    },
    codexCollectorOpts: {
      codexDir: join(fixtureRoot, 'codex', '.codex'),
      useScanIndex: false,
    },
    claudeTrackerOpts: {
      now: '2026-04-03T10:30:00.000Z',
      claudeJsonPath: join(fixtureRoot, 'claude', '.claude.json'),
      collectSessionsInRangeFn: () => [{
        sessionId: '11111111-2222-3333-4444-555555555555',
        model: 'claude-opus-4-6',
        totals: {
          totalInput: 3000,
          totalOutput: 400,
          totalCacheRead: 1500,
          totalCacheCreate: 600,
          totalTokens: 5500,
        },
      }],
    },
    codexTrackerOpts: {
      now: '2026-04-03T10:30:00.000Z',
      collectAllCodexSessionsFn: () => [{
        latestTimestamp: '2026-04-03T10:10:00.000Z',
        totalTokens: 83100,
        totalInputTokens: 80000,
        totalOutputTokens: 2200,
        totalCachedInputTokens: 50000,
      }],
    },
  });

  assert.equal(state.version, 1);
  assert.equal(state.host, 'standalone');
  assert.equal(state.generatedAt, '2026-04-12T10:00:00.000Z');
  assert.equal(state.selectedProvider, 'claude');
  assert.equal(state.selectedViewMode, 'detail');
  assert.equal(state.budget, 50);

  assert.equal(state.claude.sessions.length, 1);
  assert.equal(state.claude.projectMetrics.length, 2);
  assert.equal(state.claude.rateLimits, null);
  assert.equal(state.claude.weekly.totalTokens, 5500);
  assert.equal(state.claude.weekly.billedCost, 0.6);

  assert.equal(state.codex.activeSession.id, 'cccccccc-4444-5555-6666-dddddddddddd');
  assert.equal(state.codex.recentThreads.length, 2);
  assert.equal(state.codex.weekly.totalTokens, 83100);
});
