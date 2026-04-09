import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
  assert.equal(snapshot.primaryLimit.usedPercent, 41);
  assert.equal(snapshot.secondaryLimit.usedPercent, 12);
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
  assert.equal(snapshot.primaryLimit.usedPercent, 22);
  assert.equal(snapshot.secondaryLimit.usedPercent, 11);
});
