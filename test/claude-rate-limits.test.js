import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadClaudeRateLimitCache, saveClaudeRateLimitCache } from '../src/claude-rate-limits.js';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'token-gauge-rate-limits-'));
}

test('saveClaudeRateLimitCache persists and loadClaudeRateLimitCache restores normalized limits', () => {
  const root = makeTempDir();

  const saved = saveClaudeRateLimitCache({
    primary: { usedPercent: 41, resetsAt: 1775191480 },
    secondary: { usedPercent: 12, resetsAt: 1775634396 },
  }, { configDir: root });

  assert.equal(saved, true);

  const raw = JSON.parse(readFileSync(join(root, 'claude-rate-limits.json'), 'utf8'));
  assert.equal(raw.primary.usedPercent, 41);
  assert.equal(raw.secondary.resetsAt, 1775634396);

  const loaded = loadClaudeRateLimitCache({ configDir: root });
  assert.equal(loaded.primary.usedPercent, 41);
  assert.equal(loaded.secondary.usedPercent, 12);
  assert.ok(loaded.updatedAt);

  rmSync(root, { recursive: true, force: true });
});

test('loadClaudeRateLimitCache returns null when no cache exists', () => {
  const root = makeTempDir();
  assert.equal(loadClaudeRateLimitCache({ configDir: root }), null);
  rmSync(root, { recursive: true, force: true });
});
