import test from 'node:test';
import assert from 'node:assert/strict';
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
