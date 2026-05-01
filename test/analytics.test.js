import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalytics, normalizeShellCommand } from '../src/analytics.js';
import { buildWindow } from '../src/period.js';

function makeTurn({
  id,
  provider = 'codex',
  sessionId = 'session-1',
  timestamp,
  userText,
  toolCalls = [],
  usage = { totalTokens: 1000, estimatedCost: 0.01 },
}) {
  return {
    id,
    provider,
    sessionId,
    timestamp,
    userText,
    toolCalls,
    usage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      ...usage,
    },
    isSidechain: false,
  };
}

test('buildAnalytics classifies turns and extracts tool, MCP, and shell breakdowns', () => {
  const window = buildWindow('7d', '2026-04-15T12:00:00.000Z');
  const analytics = buildAnalytics([{
    sessionId: 'session-1',
    turns: [
      makeTurn({
        id: 't1',
        timestamp: '2026-04-14T10:00:00.000Z',
        userText: 'inspect the failing test and run pytest',
        toolCalls: [{ name: 'exec_command', kind: 'core', mcpServer: null, command: 'pytest -q' }],
      }),
      makeTurn({
        id: 't2',
        timestamp: '2026-04-14T10:05:00.000Z',
        userText: 'open the browser to inspect the page',
        toolCalls: [{ name: 'mcp__playwright__browser_snapshot', kind: 'mcp', mcpServer: 'playwright', command: null }],
      }),
    ],
  }], window);

  assert.equal(analytics.totals.turns, 2);
  assert.equal(analytics.categoryBreakdown.find(row => row.category === 'testing').turns, 1);
  assert.equal(analytics.categoryBreakdown.find(row => row.category === 'exploration').turns, 1);
  assert.equal(analytics.toolBreakdown[0].tool, 'exec_command');
  assert.equal(analytics.mcpBreakdown[0].server, 'playwright');
  assert.equal(analytics.bashBreakdown[0].command, 'pytest');
});

test('buildAnalytics computes conservative retry and one-shot metrics', () => {
  const window = buildWindow('7d', '2026-04-15T12:00:00.000Z');
  const analytics = buildAnalytics([{
    sessionId: 'session-1',
    turns: [
      makeTurn({
        id: 'edit-1',
        timestamp: '2026-04-14T10:00:00.000Z',
        userText: 'apply a fix to the flaky test',
        toolCalls: [{ name: 'apply_patch', kind: 'core', mcpServer: null, command: null }],
      }),
      makeTurn({
        id: 'test-1',
        timestamp: '2026-04-14T10:02:00.000Z',
        userText: 'run pytest again',
        toolCalls: [{ name: 'exec_command', kind: 'core', mcpServer: null, command: 'pytest -q' }],
      }),
      makeTurn({
        id: 'edit-2',
        timestamp: '2026-04-14T10:04:00.000Z',
        userText: 'patch the test one more time',
        toolCalls: [{ name: 'apply_patch', kind: 'core', mcpServer: null, command: null }],
      }),
      makeTurn({
        id: 'read-only',
        timestamp: '2026-04-14T11:00:00.000Z',
        userText: 'inspect the docs',
        toolCalls: [{ name: 'Read', kind: 'core', mcpServer: null, command: null }],
      }),
    ],
  }], window);

  const coding = analytics.categoryBreakdown.find(row => row.category === 'coding');
  assert.equal(coding.editTurns, 2);
  assert.equal(coding.retryTurns, 1);
  assert.equal(coding.oneShotTurns, 1);
  assert.equal(coding.oneShotRate, 0.5);

  const exploration = analytics.categoryBreakdown.find(row => row.category === 'exploration');
  assert.equal(exploration.oneShotRate, null);
});

test('buildAnalytics scores chats by token and context efficiency per turn', () => {
  const window = buildWindow('7d', '2026-04-15T12:00:00.000Z');
  const analytics = buildAnalytics([
    {
      sessionId: 'lean',
      projectName: 'lean-chat',
      context: { total: 4000 },
      turns: [
        makeTurn({
          id: 'lean-1',
          sessionId: 'lean',
          timestamp: '2026-04-14T10:00:00.000Z',
          userText: 'inspect the current code',
          usage: { totalTokens: 1000, estimatedCost: 0.01 },
        }),
        makeTurn({
          id: 'lean-2',
          sessionId: 'lean',
          timestamp: '2026-04-14T10:05:00.000Z',
          userText: 'apply a small patch',
          usage: { totalTokens: 1000, estimatedCost: 0.01 },
        }),
      ],
    },
    {
      sessionId: 'heavy',
      projectName: 'heavy-chat',
      context: { total: 90000 },
      turns: [
        makeTurn({
          id: 'heavy-1',
          sessionId: 'heavy',
          timestamp: '2026-04-14T11:00:00.000Z',
          userText: 'large analysis pass',
          usage: { totalTokens: 20000, estimatedCost: 0.2 },
        }),
        makeTurn({
          id: 'heavy-2',
          sessionId: 'heavy',
          timestamp: '2026-04-14T11:05:00.000Z',
          userText: 'large follow up',
          usage: { totalTokens: 20000, estimatedCost: 0.2 },
        }),
        makeTurn({
          id: 'heavy-3',
          sessionId: 'heavy',
          timestamp: '2026-04-14T11:10:00.000Z',
          userText: 'large final pass',
          usage: { totalTokens: 20000, estimatedCost: 0.2 },
        }),
      ],
    },
  ], window);

  assert.equal(analytics.chatScoring.length, 2);
  assert.equal(analytics.chatScoring[0].label, 'lean-chat');
  assert.equal(analytics.chatScoring[0].avgTokensPerTurn, 1000);
  assert.equal(analytics.chatScoring[0].contextPerTurn, 2000);
  assert.equal(analytics.chatScoring[0].tokenEfficiencyScore, 100);
  assert.equal(analytics.chatScoring[0].contextEfficiencyScore, 96);
  assert.equal(analytics.chatScoring[0].score, 98);
  assert.equal(analytics.chatScoring[1].label, 'heavy-chat');
  assert.equal(analytics.chatScoring[1].score, 0);
});

test('normalizeShellCommand collapses common commands and falls back to first token', () => {
  assert.equal(normalizeShellCommand('pytest -q'), 'pytest');
  assert.equal(normalizeShellCommand('pnpm build --filter web'), 'pnpm build');
  assert.equal(normalizeShellCommand('git diff --stat'), 'git diff');
  assert.equal(normalizeShellCommand('make lint'), 'make');
});
