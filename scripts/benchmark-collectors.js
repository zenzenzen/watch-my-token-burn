#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import { collectSessions } from '../src/collector.js';
import { collectCodexData } from '../src/codex.js';

function runBench(label, fn, runs = 5) {
  const samples = [];
  let lastValue = null;

  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    lastValue = fn();
    samples.push(performance.now() - started);
  }

  return {
    label,
    runs,
    avgMs: Number((samples.reduce((sum, value) => sum + value, 0) / runs).toFixed(3)),
    minMs: Number(Math.min(...samples).toFixed(3)),
    maxMs: Number(Math.max(...samples).toFixed(3)),
    sampleSize: Array.isArray(lastValue) ? lastValue.length : Object.keys(lastValue || {}).length,
  };
}

const cwd = process.cwd();

collectSessions({ cwd });
collectCodexData({ cwd });

const results = {
  claude: {
    coldFullScan: runBench('claude/full-scan', () => collectSessions({ cwd, useScanIndex: false })),
    indexedSteadyState: runBench('claude/indexed', () => collectSessions({ cwd })),
  },
  codex: {
    coldFullScan: runBench('codex/full-scan', () => collectCodexData({ cwd, useScanIndex: false })),
    indexedSteadyState: runBench('codex/indexed', () => collectCodexData({ cwd })),
  },
};

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
