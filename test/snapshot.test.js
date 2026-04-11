import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createClaudeLocalSnapshot,
  createClaudeHookSnapshot,
  createCodexHookSnapshot,
} from '../src/snapshot.js';

test('createClaudeHookSnapshot maps Claude statusLine payloads', () => {
  const snapshot = createClaudeHookSnapshot({
    session_id: 'sess-1',
    session_name: 'Prompt footer',
    cwd: '/Users/dev/ai-gen-tooling',
    model: {
      id: 'claude-sonnet-4-6',
      display_name: 'Claude Sonnet 4.6',
    },
    workspace: {
      current_dir: '/Users/dev/ai-gen-tooling/token-gauge',
      project_dir: '/Users/dev/ai-gen-tooling',
    },
    cost: {
      total_cost_usd: 1.25,
    },
    context_window: {
      total_input_tokens: 12000,
      total_output_tokens: 3000,
      context_window_size: 200000,
      current_usage: {
        input_tokens: 5000,
        output_tokens: 700,
        cache_creation_input_tokens: 1200,
        cache_read_input_tokens: 800,
      },
    },
    rate_limits: {
      five_hour: { used_percentage: 41, resets_at: 1775191480 },
      seven_day: { used_percentage: 12, resets_at: 1775634396 },
    },
  });

  assert.equal(snapshot.provider, 'claude');
  assert.equal(snapshot.host, 'claude');
  assert.equal(snapshot.sessionLabel, 'Prompt footer');
  assert.equal(snapshot.workspaceLabel, 'ai-gen-tooling');
  assert.equal(snapshot.totalTokens, 15000);
  assert.equal(snapshot.contextTokens, 7700);
  assert.equal(Math.round(snapshot.cacheHitRate), 14);
  assert.equal(snapshot.primaryLimit.usedPercent, 41);
  assert.equal(snapshot.secondaryLimit.usedPercent, 12);
});

test('createClaudeLocalSnapshot includes cached Claude rate limits in standalone mode', () => {
  const snapshot = createClaudeLocalSnapshot([{
    sessionId: 'sess-local',
    projectName: 'token-gauge',
    cwd: '/Users/dev/ai-gen-tooling/token-gauge',
    model: 'claude-sonnet-4-6',
    alive: true,
    context: { total: 3400 },
    totals: {
      totalInput: 3000,
      totalOutput: 400,
      totalCacheRead: 1500,
      totalCacheCreate: 600,
      totalTokens: 5500,
      latestTotal: 3700,
    },
  }], {
    totalTokens: 5500,
    sessionCount: 1,
    estimatedCost: 0.17,
    billedCost: 0.6,
  }, {
    primary: { usedPercent: 41, resetsAt: 1775191480 },
    secondary: { usedPercent: 12, resetsAt: 1775634396 },
    updatedAt: '2026-04-12T10:00:00.000Z',
  });

  assert.equal(snapshot.host, 'standalone');
  assert.equal(snapshot.primaryLimit.usedPercent, 41);
  assert.equal(snapshot.secondaryLimit.usedPercent, 12);
  assert.equal(snapshot.meta.rateLimitUpdatedAt, '2026-04-12T10:00:00.000Z');
});

test('createCodexHookSnapshot maps Codex-style hook payloads', () => {
  const snapshot = createCodexHookSnapshot({
    session_id: 'sess-2',
    session_name: 'Agent footer',
    cwd: '/Users/dev/ai-gen-tooling',
    model: {
      id: 'gpt-5.4',
      display_name: 'GPT-5.4',
    },
    context_window: {
      current_tokens: 24800,
      context_window_size: 258400,
    },
    usage: {
      total_tokens: 83100,
      last_tokens: 24800,
      input_tokens: 24000,
      cached_input_tokens: 14800,
    },
    rate_limits: {
      primary: { used_percent: 22, resets_at: 1775191480 },
      secondary: { used_percent: 11, resets_at: 1775634396 },
    },
  });

  assert.equal(snapshot.provider, 'codex');
  assert.equal(snapshot.host, 'codex');
  assert.equal(snapshot.sessionLabel, 'Agent footer');
  assert.equal(snapshot.totalTokens, 83100);
  assert.equal(snapshot.contextTokens, 24800);
  assert.equal(snapshot.contextWindow, 258400);
  assert.equal(Math.round(snapshot.cacheHitRate), 38);
  assert.equal(snapshot.primaryLimit.usedPercent, 22);
  assert.equal(snapshot.secondaryLimit.usedPercent, 11);
});
