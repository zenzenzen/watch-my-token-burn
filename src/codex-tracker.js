/**
 * Codex weekly usage tracker — persists daily token aggregates to JSON.
 * Storage: ~/.config/token-gauge/codex-weekly.json
 *
 * "Today's sessions" are those whose latestTimestamp falls on the current UTC date.
 * Token counts are cumulative per session, so this is a per-session approximation.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { CODEX_PRICING } from './pricing.js';
import { collectAllCodexSessions } from './codex.js';
import { resolveTokenGaugeConfigDir } from './scan-index.js';

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

function sumCodexDay(target, dayData = {}) {
  target.tokens += dayData.tokens || 0;
  target.inputTokens += dayData.inputTokens || 0;
  target.outputTokens += dayData.outputTokens || 0;
  target.cachedTokens += dayData.cachedTokens || 0;
  target.sessions += dayData.sessions || 0;
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
      const target = merged.days[key] || { tokens: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, sessions: 0 };
      sumCodexDay(target, dayData);
      merged.days[key] = target;
    }
  }

  if (!machineCount) {
    return { data: fallbackData, machineCount: 1 };
  }

  return { data: merged, machineCount };
}

function dateKey(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function dayLabel(date) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
}

/**
 * Refresh today's data from Codex session files and return a 7-day weekly summary.
 * Return shape is identical to refreshWeeklyData() in tracker.js.
 */
export function refreshCodexWeeklyData(opts = {}) {
  const { configDir, weeklyFile, aggregateDir, aggregateWeeklyFile } = resolveTrackerPaths(opts);
  const data = loadWeeklyFile(weeklyFile);
  const now = opts.now ? new Date(opts.now) : new Date();
  const todayKey = dateKey(now);

  // Sum tokens from sessions last active today (UTC date match on latestTimestamp)
  const allSessions = (opts.collectAllCodexSessionsFn || collectAllCodexSessions)(opts.collectorOpts || opts);
  let todayTokens = 0;
  let todayInputTokens = 0;
  let todayOutputTokens = 0;
  let todayCachedTokens = 0;
  let todaySessionCount = 0;

  for (const session of allSessions) {
    const ts = session.latestTimestamp || '';
    if (String(ts).slice(0, 10) === todayKey) {
      todayTokens += session.totalTokens;
      todayInputTokens += session.totalInputTokens;
      todayOutputTokens += session.totalOutputTokens;
      todayCachedTokens += session.totalCachedInputTokens;
      todaySessionCount++;
    }
  }

  data.days[todayKey] = {
    tokens: todayTokens,
    inputTokens: todayInputTokens,
    outputTokens: todayOutputTokens,
    cachedTokens: todayCachedTokens,
    sessions: todaySessionCount,
    updated: now.toISOString(),
  };

  // Prune entries older than 7 days
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoKey = dateKey(weekAgo);
  for (const key of Object.keys(data.days)) {
    if (key < weekAgoKey) delete data.days[key];
  }

  saveWeeklyFile(data, configDir, weeklyFile, now);
  if (aggregateDir && aggregateWeeklyFile) {
    saveWeeklyFile(data, aggregateDir, aggregateWeeklyFile, now);
  }

  const aggregate = loadAggregateWeeklyData({
    aggregateDir,
    fallbackData: data,
  });
  const summaryData = aggregate.data;

  // Build summary for the last 7 days
  const daily = [];
  let totalTokens = 0;
  let totalSessions = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    const dayData = summaryData.days[key] || { tokens: 0, sessions: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    const isToday = key === todayKey;

    daily.push({
      date: key,
      label: dayLabel(d),
      tokens: dayData.tokens,
      sessions: dayData.sessions,
      isToday,
    });

    totalTokens += dayData.tokens;
    totalSessions += dayData.sessions;
    totalInputTokens += dayData.inputTokens || 0;
    totalOutputTokens += dayData.outputTokens || 0;
    totalCachedTokens += dayData.cachedTokens || 0;
  }

  const pricing = CODEX_PRICING.default;
  const estimatedCost = (
    totalInputTokens * pricing.input +
    totalOutputTokens * pricing.output +
    totalCachedTokens * pricing.cacheRead
  ) / 1_000_000;

  return {
    daily,
    totalTokens,
    sessionCount: totalSessions,
    estimatedCost,
    machineCount: aggregate.machineCount,
  };
}
