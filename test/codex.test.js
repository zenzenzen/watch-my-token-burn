import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectCodexData } from '../src/codex.js';

const fixtureRoot = join(process.cwd(), 'test', 'fixtures', 'codex');

test('collectCodexData prefers latest cwd match over newest overall thread', () => {
  const data = collectCodexData({
    codexDir: join(fixtureRoot, '.codex'),
    cwd: '/Users/dev/ai-gen-tooling',
  });

  assert.ok(data.activeSession);
  assert.equal(data.activeSession.id, 'cccccccc-4444-5555-6666-dddddddddddd');
  assert.equal(data.activeSession.workspaceLabel, 'ai-gen-tooling');
  assert.equal(data.activeSession.providerLabel, 'OpenAI Codex');
  assert.equal(data.activeSession.startedAt, '2026-04-03T10:10:00.000Z');
  assert.equal(data.activeSession.totalTokens, 83100);
  assert.equal(data.activeSession.currentContextTokens, 24800);
  assert.equal(data.activeSession.timeline.length, 3);
  assert.equal(data.activeSession.timeline[0].totalTokens, 20900);
  assert.equal(data.activeSession.timeline[2].totalTokens, 83100);
  assert.equal(data.recentThreads.length, 2);
  assert.equal(data.recentThreads[1].matchCwd, true);
  assert.equal(data.recentThreads[1].liveDataFound, true);
});

test('collectCodexData includes the newest live session file before session_index catches up', () => {
  const root = mkdtempSync(join(tmpdir(), 'token-gauge-codex-'));
  const codexDir = join(root, '.codex');
  const sessionsDir = join(codexDir, 'sessions', '2026', '04', '12');
  mkdirSync(sessionsDir, { recursive: true });

  writeFileSync(join(codexDir, 'session_index.jsonl'), `${JSON.stringify({
    id: '11111111-0000-0000-0000-000000000000',
    thread_name: 'Older indexed thread',
    updated_at: '2026-04-12T12:05:00.000Z',
  })}\n`);

  const olderPath = join(sessionsDir, 'rollout-2026-04-12T12-05-00-11111111-0000-0000-0000-000000000000.jsonl');
  writeFileSync(olderPath, [
    JSON.stringify({
      timestamp: '2026-04-12T12:05:00.000Z',
      type: 'session_meta',
      payload: {
        id: '11111111-0000-0000-0000-000000000000',
        timestamp: '2026-04-12T12:05:00.000Z',
        cwd: '/Users/dev/ai-gen-tooling',
        originator: 'Codex Desktop',
        model_provider: 'openai',
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-12T12:05:01.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 400,
            output_tokens: 80,
            reasoning_output_tokens: 20,
            total_tokens: 1100,
          },
          last_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 400,
            output_tokens: 80,
            reasoning_output_tokens: 20,
            total_tokens: 1100,
          },
          model_context_window: 258400,
        },
        rate_limits: {
          primary: { used_percent: 65, resets_at: 1776013596 },
          secondary: { used_percent: 19, resets_at: 1776358904 },
        },
      },
    }),
  ].join('\n'));

  const livePath = join(sessionsDir, 'rollout-2026-04-12T12-06-00-22222222-1111-2222-3333-444444444444.jsonl');
  writeFileSync(livePath, [
    JSON.stringify({
      timestamp: '2026-04-12T12:06:00.000Z',
      type: 'session_meta',
      payload: {
        id: '22222222-1111-2222-3333-444444444444',
        timestamp: '2026-04-12T12:06:00.000Z',
        cwd: '/Users/dev/ai-gen-tooling',
        originator: 'Codex Desktop',
        model_provider: 'openai',
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-12T12:06:01.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 2000,
            cached_input_tokens: 1000,
            output_tokens: 120,
            reasoning_output_tokens: 30,
            total_tokens: 2150,
          },
          last_token_usage: {
            input_tokens: 2000,
            cached_input_tokens: 1000,
            output_tokens: 120,
            reasoning_output_tokens: 30,
            total_tokens: 2150,
          },
          model_context_window: 258400,
        },
        rate_limits: {
          primary: { used_percent: 100, resets_at: 1776013596 },
          secondary: { used_percent: 76, resets_at: 1776451200 },
        },
      },
    }),
  ].join('\n'));

  utimesSync(olderPath, new Date('2026-04-12T12:05:02.000Z'), new Date('2026-04-12T12:05:02.000Z'));
  utimesSync(livePath, new Date('2026-04-12T12:06:02.000Z'), new Date('2026-04-12T12:06:02.000Z'));

  const data = collectCodexData({
    codexDir,
    cwd: '/Users/dev/ai-gen-tooling',
    useScanIndex: false,
  });

  assert.ok(data.activeSession);
  assert.equal(data.activeSession.id, '22222222-1111-2222-3333-444444444444');
  assert.equal(data.activeSession.workspaceLabel, 'ai-gen-tooling');
  assert.equal(data.activeSession.threadName, 'ai-gen-tooling');
  assert.equal(data.activeSession.rateLimits?.primary?.usedPercent, 100);
  assert.equal(data.activeSession.rateLimits?.secondary?.usedPercent, 76);
  assert.equal(data.recentThreads[0].id, '22222222-1111-2222-3333-444444444444');
  assert.equal(data.recentThreads[0].matchCwd, true);
  assert.equal(data.recentThreads[0].liveDataFound, true);
});
