import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseCliArgs,
  reduceInput,
  resolveConfigFilePath,
} from '../src/state.js';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'token-gauge-state-'));
}

test('parseCliArgs reads provider and view flags', () => {
  const parsed = parseCliArgs([
    '--host', 'claude',
    '--mode', 'inline',
    '--format', 'plain',
    '--rows', '2',
    '--provider', 'codex',
    '--view', 'detail',
    '--interval', '5000',
    '--autoclear', '10',
    '--ascii',
    '--once',
  ]);
  assert.equal(parsed.host, 'claude');
  assert.equal(parsed.mode, 'inline');
  assert.equal(parsed.format, 'plain');
  assert.equal(parsed.rows, 2);
  assert.equal(parsed.provider, 'codex');
  assert.equal(parsed.viewMode, 'detail');
  assert.equal(parsed.refreshInterval, 5000);
  assert.equal(parsed.autoClearMinutes, 10);
  assert.equal(parsed.ascii, true);
  assert.equal(parsed.once, true);
});

test('parseCliArgs loads defaults from config file', () => {
  const root = makeTempDir();
  const configDir = join(root, '.config', 'token-gauge');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(resolveConfigFilePath({ configDir }), JSON.stringify({
    host: 'codex',
    provider: 'codex',
    viewMode: 'detail',
    interval: 2500,
    autoClearMinutes: 5,
    format: 'plain',
    rows: 3,
    budget: 42.5,
    aggregateDir: '/tmp/token-gauge-shared',
    ascii: true,
  }, null, 2));

  const parsed = parseCliArgs([], { configDir });

  assert.equal(parsed.host, 'codex');
  assert.equal(parsed.mode, 'inline');
  assert.equal(parsed.provider, 'codex');
  assert.equal(parsed.viewMode, 'detail');
  assert.equal(parsed.refreshInterval, 2500);
  assert.equal(parsed.autoClearMinutes, 5);
  assert.equal(parsed.format, 'plain');
  assert.equal(parsed.rows, 3);
  assert.equal(parsed.budget, 42.5);
  assert.equal(parsed.aggregateDir, '/tmp/token-gauge-shared');
  assert.equal(parsed.ascii, true);

  rmSync(root, { recursive: true, force: true });
});

test('parseCliArgs lets CLI flags override config file values', () => {
  const root = makeTempDir();
  const configDir = join(root, '.config', 'token-gauge');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(resolveConfigFilePath({ configDir }), JSON.stringify({
    host: 'codex',
    provider: 'codex',
    view: 'detail',
    refreshInterval: 2500,
    autoclear: 5,
    format: 'plain',
    rows: 3,
    budget: 42.5,
    sharedWeeklyDir: '/tmp/token-gauge-shared',
    ascii: false,
  }, null, 2));

  const parsed = parseCliArgs([
    '--host', 'standalone',
    '--provider', 'claude',
    '--view', 'compact',
    '--format', 'json',
    '--rows', '1',
    '--interval', '9000',
    '--autoclear', '45',
    '--budget', '75',
    '--ascii',
  ], { configDir });

  assert.equal(parsed.host, 'standalone');
  assert.equal(parsed.mode, 'fullscreen');
  assert.equal(parsed.provider, 'claude');
  assert.equal(parsed.viewMode, 'compact');
  assert.equal(parsed.format, 'json');
  assert.equal(parsed.rows, 1);
  assert.equal(parsed.refreshInterval, 9000);
  assert.equal(parsed.autoClearMinutes, 45);
  assert.equal(parsed.budget, 75);
  assert.equal(parsed.aggregateDir, '/tmp/token-gauge-shared');
  assert.equal(parsed.ascii, true);

  rmSync(root, { recursive: true, force: true });
});

test('parseCliArgs falls back to defaults when config file is invalid or malformed', () => {
  const root = makeTempDir();
  const configDir = join(root, '.config', 'token-gauge');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(resolveConfigFilePath({ configDir }), JSON.stringify({
    host: 'bad-host',
    mode: 'bad-mode',
    provider: 'bad-provider',
    viewMode: 'bad-view',
    refreshInterval: -5,
    autoClearMinutes: 0,
    format: 'bad-format',
    rows: 0,
    budget: -1,
    aggregateDir: 123,
    ascii: 'nope',
  }, null, 2));

  const parsed = parseCliArgs([], { configDir });

  assert.equal(parsed.host, 'standalone');
  assert.equal(parsed.mode, 'fullscreen');
  assert.equal(parsed.provider, 'claude');
  assert.equal(parsed.viewMode, 'compact');
  assert.equal(parsed.refreshInterval, 15000);
  assert.equal(parsed.autoClearMinutes, 30);
  assert.equal(parsed.format, 'ansi');
  assert.equal(parsed.rows, 1);
  assert.equal(parsed.budget, 0);
  assert.equal(parsed.aggregateDir, null);
  assert.equal(parsed.ascii, false);

  writeFileSync(resolveConfigFilePath({ configDir }), '{not-valid-json');
  const malformed = parseCliArgs([], { configDir });
  assert.equal(malformed.host, 'standalone');
  assert.equal(malformed.mode, 'fullscreen');

  rmSync(root, { recursive: true, force: true });
});

test('reduceInput toggles view and provider and gates clear action', () => {
  let state = { provider: 'claude', viewMode: 'compact' };

  let result = reduceInput(state, 'v');
  assert.equal(result.state.viewMode, 'detail');
  assert.equal(result.action, 'refresh');

  result = reduceInput(result.state, ']');
  assert.equal(result.state.provider, 'codex');

  result = reduceInput(result.state, 'c');
  assert.equal(result.action, 'noop');

  result = reduceInput({ provider: 'claude', viewMode: 'detail' }, 'c');
  assert.equal(result.action, 'clear');
});
