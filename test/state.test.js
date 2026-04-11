import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCliArgs,
  reduceInput,
} from '../src/state.js';

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
