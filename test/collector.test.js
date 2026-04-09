import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { collectSessions } from '../src/collector.js';

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
});
