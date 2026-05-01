/**
 * Codex usage tracker — persists local-day token aggregates to JSON.
 * Storage: ~/.config/token-gauge/codex-weekly.json
 *
 * "Today's sessions" are those whose latestTimestamp falls on the current local date.
 * Token counts are cumulative per session, so this remains a per-session approximation.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { CODEX_PRICING } from './pricing.js';
import { collectAllCodexSessions } from './codex.js';
import { dayLabel, listWindowDates, toLocalDateKey } from './period.js';
import { resolveTokenGaugeConfigDir } from './scan-index.js';

const DAY_RETENTION = 62;

function resolveTrackerPaths(opts = {}) {
  const configDir = resolveTokenGaugeConfigDir(opts.configDir);
  const machineId = (opts.machineId || hostname()).replace(/[^a-zA-Z0-9._-]/g, '-');
  const aggregateDir = opts.aggregateDir || opts.sharedWeeklyDir || null;
  return {
    configDir,
    weeklyFile: opts.weeklyFilePath || join(configDir, 'codex-weekly.json'),
    aggregateDir,
    machineId,
    aggregateWeeklyFile: aggregateDir ? join(aggregateDir, `codex-weekly-${machineId}.json`) : null,
  };
}

function ensureDir(configDir) {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

function loadWeeklyFile(weeklyFile) {
  try {
    return JSON.parse(readFileSync(weeklyFile, 'utf8'));
  } catch {
    return { days: {}, lastUpdated: null };
  }
}

function saveWeeklyFile(data, configDir, weeklyFile, now) {
  try {
    ensureDir(configDir);
    data.lastUpdated = now.toISOString();
    writeFileSync(weeklyFile, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

function estimateCodexCost({ inputTokens = 0, outputTokens = 0, cachedTokens = 0 } = {}) {
  return (
    inputTokens * CODEX_PRICING.default.input +
    outputTokens * CODEX_PRICING.default.output +
    cachedTokens * CODEX_PRICING.default.cacheRead
  ) / 1_000_000;
}

function sumCodexDay(target, dayData = {}) {
  target.tokens += dayData.tokens || 0;
  target.inputTokens += dayData.inputTokens || 0;
  target.outputTokens += dayData.outputTokens || 0;
  target.cachedTokens += dayData.cachedTokens || 0;
  target.sessions += dayData.sessions || 0;
  target.estimatedCost += dayData.estimatedCost || estimateCodexCost(dayData);
}

function loadAggregateWeeklyData({ aggregateDir, fallbackData }) {
  if (!aggregateDir || !existsSync(aggregateDir)) {
    return { data: fallbackData, machineCount: 1 };
  }

  const files = [];
  try {
    for (const name of readdirSync(aggregateDir)) {
      if (!name.startsWith('codex-weekly-') || !name.endsWith('.json')) continue;
      files.push(join(aggregateDir, name));
    }
  } catch {
    return { data: fallbackData, machineCount: 1 };
  }

  if (!files.length) {
    return { data: fallbackData, machineCount: 1 };
  }

  const merged = { days: {}, lastUpdated: null };
  let machineCount = 0;

  for (const file of files) {
    const source = loadWeeklyFile(file);
    if (!source?.days) continue;
    machineCount++;
    for (const [key, dayData] of Object.entries(source.days)) {
      const target = merged.days[key] || {
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        sessions: 0,
        estimatedCost: 0,
      };
      sumCodexDay(target, dayData);
      merged.days[key] = target;
    }
  }

  if (!machineCount) {
    return { data: fallbackData, machineCount: 1 };
  }

  return { data: merged, machineCount };
}

function refreshTodayEntry(data, now, opts = {}) {
  const todayKey = toLocalDateKey(now);
  const allSessions = (opts.collectAllCodexSessionsFn || collectAllCodexSessions)(opts.collectorOpts || opts);

  let todayTokens = 0;
  let todayInputTokens = 0;
  let todayOutputTokens = 0;
  let todayCachedTokens = 0;
  let todaySessionCount = 0;

  for (const session of allSessions) {
    if (!session.latestTimestamp) continue;
    if (toLocalDateKey(new Date(session.latestTimestamp)) !== todayKey) continue;

    todayTokens += session.totalTokens || 0;
    todayInputTokens += session.totalInputTokens || 0;
    todayOutputTokens += session.totalOutputTokens || 0;
    todayCachedTokens += session.totalCachedInputTokens || 0;
    todaySessionCount++;
  }

  data.days[todayKey] = {
    tokens: todayTokens,
    inputTokens: todayInputTokens,
    outputTokens: todayOutputTokens,
    cachedTokens: todayCachedTokens,
    sessions: todaySessionCount,
    estimatedCost: estimateCodexCost({
      inputTokens: todayInputTokens,
      outputTokens: todayOutputTokens,
      cachedTokens: todayCachedTokens,
    }),
    updated: now.toISOString(),
  };

  const oldest = new Date(now);
  oldest.setHours(0, 0, 0, 0);
  oldest.setDate(oldest.getDate() - (DAY_RETENTION - 1));
  const oldestKey = toLocalDateKey(oldest);
  for (const key of Object.keys(data.days)) {
    if (key < oldestKey) delete data.days[key];
  }
}

export function summarizeWindow(opts = {}) {
  const period = opts.period || '7d';
  const { configDir, weeklyFile, aggregateDir, aggregateWeeklyFile } = resolveTrackerPaths(opts);
  const data = loadWeeklyFile(weeklyFile);
  const now = opts.now ? new Date(opts.now) : new Date();

  refreshTodayEntry(data, now, opts);
  saveWeeklyFile(data, configDir, weeklyFile, now);
  if (aggregateDir && aggregateWeeklyFile) {
    saveWeeklyFile(data, aggregateDir, aggregateWeeklyFile, now);
  }

  const aggregate = loadAggregateWeeklyData({
    aggregateDir,
    fallbackData: data,
  });
  const summaryData = aggregate.data;
  const { window, dates } = listWindowDates(period, now);
  const todayKey = toLocalDateKey(now);

  const daily = [];
  let totalTokens = 0;
  let totalSessions = 0;
  let totalEstimatedCost = 0;

  for (const date of dates) {
    const key = toLocalDateKey(date);
    const dayData = summaryData.days[key] || {
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      sessions: 0,
      estimatedCost: 0,
    };
    const estimatedCost = dayData.estimatedCost || estimateCodexCost(dayData);
    daily.push({
      date: key,
      label: dayLabel(date),
      tokens: dayData.tokens || 0,
      estimatedCost,
      sessions: dayData.sessions || 0,
      isToday: key === todayKey,
    });

    totalTokens += dayData.tokens || 0;
    totalSessions += dayData.sessions || 0;
    totalEstimatedCost += estimatedCost;
  }

  return {
    period: window.period,
    window: window.window,
    daily,
    totalTokens,
    sessionCount: totalSessions,
    estimatedCost: totalEstimatedCost,
    machineCount: aggregate.machineCount,
    billedCost: null,
  };
}

export function refreshCodexWeeklyData(opts = {}) {
  return summarizeWindow({ ...opts, period: '7d' });
}
