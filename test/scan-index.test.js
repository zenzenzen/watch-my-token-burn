import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createScanIndex } from '../src/scan-index.js';
import { collectSessions } from '../src/collector.js';
import { collectCodexData } from '../src/codex.js';

const fixtureRoot = join(process.cwd(), 'test', 'fixtures');

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'token-gauge-'));
}

function bumpMtime(path) {
  const stat = statSync(path);
  const next = new Date(stat.mtimeMs + 1000);
  utimesSync(path, next, next);
}

test('scan index tracks unchanged, append, reset, prune, and version mismatch states', () => {
  const root = makeTempDir();
  const configDir = join(root, 'config');
  const filePath = join(root, 'session.jsonl');

  writeFileSync(filePath, '{"ok":1}\n');

  const first = createScanIndex({ name: 'state-test', version: 1, configDir });
  const initialStat = statSync(filePath);
  assert.equal(first.getStatus(filePath, initialStat), 'new');
  first.updateEntry(filePath, initialStat, { kind: 'fixture' }, { offset: initialStat.size });
  first.save();

  const second = createScanIndex({ name: 'state-test', version: 1, configDir });
  assert.equal(second.getStatus(filePath, initialStat), 'unchanged');

  writeFileSync(filePath, '{"ok":1}\n{"ok":2}\n');
  const appendedStat = statSync(filePath);
  assert.equal(second.getStatus(filePath, appendedStat), 'append');

  writeFileSync(filePath, '{"ok":1}\n');
  const resetStat = statSync(filePath);
  assert.equal(second.getStatus(filePath, resetStat), 'reset');

  second.pruneEntries([]);
  second.save();
  const pruned = createScanIndex({ name: 'state-test', version: 1, configDir });
  assert.equal(pruned.getEntry(filePath), null);

  const mismatched = createScanIndex({ name: 'state-test', version: 2, configDir });
  assert.equal(mismatched.getEntry(filePath), null);

  rmSync(root, { recursive: true, force: true });
});

test('collectSessions reuses indexed Claude log state across append, reset, and deletion', () => {
  const root = makeTempDir();
  const claudeDir = join(root, '.claude');
  const configDir = join(root, 'config');
  cpSync(join(fixtureRoot, 'claude', '.claude'), claudeDir, { recursive: true });

  const sessionFile = join(claudeDir, 'projects', '-Users-dev-project-one', '11111111-2222-3333-4444-555555555555.jsonl');

  const first = collectSessions({ claudeDir, configDir });
  assert.equal(first[0].totals.totalTokens, 5500);

  const second = collectSessions({ claudeDir, configDir });
  assert.equal(second[0].totals.totalTokens, 5500);

  writeFileSync(sessionFile, `${readFileSync(sessionFile, 'utf8')}{"type":"assistant","message":{"model":"claude-opus-4-6","usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":30,"cache_creation_input_tokens":40}}}\n`);
  bumpMtime(sessionFile);

  const appended = collectSessions({ claudeDir, configDir });
  assert.equal(appended[0].totals.totalTokens, 5600);
  assert.equal(appended[0].totals.messageCount, 3);

  writeFileSync(sessionFile, '{"type":"assistant","message":{"model":"claude-opus-4-6","usage":{"input_tokens":1000,"output_tokens":100,"cache_read_input_tokens":500,"cache_creation_input_tokens":200}}}\n');
  bumpMtime(sessionFile);

  const reset = collectSessions({ claudeDir, configDir });
  assert.equal(reset[0].totals.totalTokens, 1800);
  assert.equal(reset[0].totals.messageCount, 1);

  unlinkSync(sessionFile);
  const removed = collectSessions({ claudeDir, configDir });
  assert.equal(removed[0].totals.totalTokens, 0);
  const indexData = JSON.parse(readFileSync(join(configDir, 'claude-scan-index.json'), 'utf8'));
  assert.equal(Object.keys(indexData.files).length, 0);

  rmSync(root, { recursive: true, force: true });
});

test('collectCodexData reuses indexed Codex log state across append, reset, and deletion', () => {
  const root = makeTempDir();
  const codexDir = join(root, '.codex');
  const configDir = join(root, 'config');
  cpSync(join(fixtureRoot, 'codex', '.codex'), codexDir, { recursive: true });

  const sessionFile = join(codexDir, 'sessions', '2026', '04', '03', 'rollout-2026-04-03T10-10-00-cccccccc-4444-5555-6666-dddddddddddd.jsonl');

  const first = collectCodexData({ codexDir, configDir, cwd: '/Users/dev/ai-gen-tooling' });
  assert.equal(first.activeSession.totalTokens, 83100);

  const second = collectCodexData({ codexDir, configDir, cwd: '/Users/dev/ai-gen-tooling' });
  assert.equal(second.activeSession.totalTokens, 83100);

  writeFileSync(sessionFile, `${readFileSync(sessionFile, 'utf8')}{"timestamp":"2026-04-03T10:10:10.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":81000,"cached_input_tokens":51000,"output_tokens":2300,"reasoning_output_tokens":950,"total_tokens":85250},"last_token_usage":{"input_tokens":25000,"cached_input_tokens":18500,"output_tokens":650,"reasoning_output_tokens":250,"total_tokens":25400},"model_context_window":258400},"rate_limits":{"limit_id":"codex","primary":{"used_percent":25.0,"window_minutes":300,"resets_at":1775191480},"secondary":{"used_percent":12.0,"window_minutes":10080,"resets_at":1775634396}}}}\n`);
  bumpMtime(sessionFile);

  const appended = collectCodexData({ codexDir, configDir, cwd: '/Users/dev/ai-gen-tooling' });
  assert.equal(appended.activeSession.totalTokens, 85250);
  assert.equal(appended.activeSession.rateLimits.primary.usedPercent, 25);

  writeFileSync(sessionFile, '{"timestamp":"2026-04-03T10:10:00.000Z","type":"session_meta","payload":{"id":"cccccccc-4444-5555-6666-dddddddddddd","timestamp":"2026-04-03T10:10:00.000Z","cwd":"/Users/dev/ai-gen-tooling","originator":"Codex Desktop","model_provider":"openai"}}\n');
  bumpMtime(sessionFile);

  const reset = collectCodexData({ codexDir, configDir, cwd: '/Users/dev/ai-gen-tooling' });
  assert.equal(reset.activeSession.totalTokens, 0);
  assert.equal(reset.activeSession.liveDataFound, false);

  unlinkSync(sessionFile);
  const removed = collectCodexData({ codexDir, configDir, cwd: '/Users/dev/ai-gen-tooling' });
  assert.equal(removed.activeSession.id, 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb');
  assert.equal(removed.activeSession.totalTokens, 42300);
  const indexData = JSON.parse(readFileSync(join(configDir, 'codex-scan-index.json'), 'utf8'));
  assert.ok(!existsSync(sessionFile));
  assert.equal(Object.values(indexData.files).length, 1);

  rmSync(root, { recursive: true, force: true });
});
