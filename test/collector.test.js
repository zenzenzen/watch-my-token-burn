import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { collectProjectMetrics, collectSessions } from '../src/collector.js';

const fixtureRoot = join(process.cwd(), 'test', 'fixtures', 'claude');

test('collectSessions normalizes Claude fixture data', () => {
  const sessions = collectSessions({
    claudeDir: join(fixtureRoot, '.claude'),
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].projectName, 'project-one');
  assert.equal(sessions[0].model, 'claude-opus-4-6');
  assert.equal(sessions[0].context.total, 3400);
  assert.equal(sessions[0].totals.totalTokens, 5500);
  assert.equal(sessions[0].totals.latestTotal, 3700);
  assert.equal(sessions[0].timeline.length, 2);
  assert.equal(sessions[0].turns.length, 2);
  assert.equal(sessions[0].turns[0].userText, 'run pytest and inspect the failure');
  assert.equal(sessions[0].turns[0].toolCalls[0].name, 'Bash');
  assert.equal(sessions[0].turns[1].userText, 'apply a fix to the flaky test');
  assert.equal(sessions[0].turns[1].toolCalls[0].name, 'Edit');
  assert.equal(sessions[0].timeline[0].timestamp, '2026-04-03T10:00:00.000Z');
  assert.equal(sessions[0].timeline[1].totalTokens, 5500);
});

test('collectProjectMetrics reads billed project data from claude json', () => {
  const metrics = collectProjectMetrics({
    claudeJsonPath: join(fixtureRoot, '.claude.json'),
  });

  assert.equal(metrics.length, 2);
  assert.equal(metrics[0].name, 'project-one');
  assert.equal(metrics[0].sessionId, '11111111-2222-3333-4444-555555555555');
  assert.equal(metrics[0].cost, 0.42);
  assert.equal(metrics[0].totalCacheRead, 1500);
});
