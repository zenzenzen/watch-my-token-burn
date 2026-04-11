import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInlineSnapshot, stripAnsi } from '../src/inline.js';

test('renderInlineSnapshot renders one-line Claude output', () => {
  const output = renderInlineSnapshot({
    provider: 'claude',
    sessionLabel: 'token-gauge',
    modelLabel: 'Claude Sonnet 4.6',
    contextTokens: 7700,
    contextWindow: 200000,
    totalTokens: 15000,
    cacheHitRate: 33.3,
    costUsd: 1.25,
    primaryLimit: { usedPercent: 41, resetsAt: 1775191480 },
  }, {
    ansi: false,
    format: 'plain',
    rows: 1,
    width: 120,
  });

  assert.match(output, /\[TG\]/);
  assert.match(output, /token-gauge/);
  assert.match(output, /ctx 7\.7K\/200\.0K/);
  assert.match(output, /cache 33%/);
  assert.match(output, /cost \$1\.25/);
  assert.ok(!output.includes('\n'));
});

test('renderInlineSnapshot splits long output across rows when requested', () => {
  const output = renderInlineSnapshot({
    provider: 'codex',
    sessionLabel: 'Matching tg thread',
    modelLabel: 'GPT-5.4',
    contextTokens: 24800,
    contextWindow: 258400,
    totalTokens: 83100,
    cacheHitRate: 38.4,
    primaryLimit: { usedPercent: 22, resetsAt: 1775191480 },
    secondaryLimit: { usedPercent: 11, resetsAt: 1775634396 },
  }, {
    ansi: false,
    format: 'plain',
    rows: 2,
    width: 120,
  });

  const cleaned = stripAnsi(output);
  assert.equal(cleaned.split('\n').length, 2);
  assert.match(cleaned, /Matching tg thread/);
  assert.match(cleaned, /cache 38%/);
  assert.match(cleaned, /5h 22%/);
  assert.match(cleaned, /7d 11%/);
});
