/**
 * Claude usage tracker — persists local-day token aggregates to JSON.
 * Storage: ~/.config/token-gauge/weekly.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, hostname } from 'node:os';
import { collectSessionsInRange } from './collector.js';
import { MODEL_PRICING } from './pricing.js';
import { buildWindow, dayLabel, listWindowDates, startOfLocalDay, endOfLocalDay, toLocalDateKey } from './period.js';
import { resolveTokenGaugeConfigDir } from './scan-index.js';

const DAY_RETENTION = 62;

function resolveTrackerPaths(opts = {}) {
  const configDir = resolveTokenGaugeConfigDir(opts.configDir);
  const machineId = (opts.machineId || hostname()).replace(/[^a-zA-Z0-9._-]/g, '-');
  const aggregateDir = opts.aggregateDir || opts.sharedWeeklyDir || null;
  return {
    configDir,
    weeklyFile: opts.weeklyFilePath || join(configDir, 'weekly.json'),
    claudeJsonPath: opts.claudeJsonPath || join(homedir(), '.claude.json'),
    aggregateDir,
    machineId,
    aggregateWeeklyFile: aggregateDir ? join(aggregateDir, `claude-weekly-${machineId}.json`) : null,
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

function sumClaudeDay(target, dayData = {}) {
  target.tokens += dayData.tokens || 0;
  target.estimatedCost += dayData.estimatedCost || 0;
  target.sessions += dayData.sessions || 0;
}

function loadAggregateWeeklyData({ aggregateDir, fallbackData }) {
  if (!aggregateDir || !existsSync(aggregateDir)) {
    return { data: fallbackData, machineCount: 1 };
  }

  const files = [];
  try {
    for (const name of readdirSync(aggregateDir)) {
      if (!name.startsWith('claude-weekly-') || !name.endsWith('.json')) continue;
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
      const target = merged.days[key] || { tokens: 0, estimatedCost: 0, sessions: 0 };
      sumClaudeDay(target, dayData);
      merged.days[key] = target;
    }
  }

  if (!machineCount) {
    return { data: fallbackData, machineCount: 1 };
  }

  return { data: merged, machineCount };
}

function getClaudeEstimatedCost(model, totals) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  return (
    (totals.totalInput || 0) * pricing.input +
    (totals.totalOutput || 0) * pricing.output +
    (totals.totalCacheRead || 0) * pricing.cacheRead +
    (totals.totalCacheCreate || 0) * pricing.cacheWrite
  ) / 1_000_000;
}

function refreshTodayEntry(data, now, opts = {}) {
  const todayKey = toLocalDateKey(now);
  const todayStart = startOfLocalDay(now);
  const todayEnd = endOfLocalDay(now);

  const todaySessions = (opts.collectSessionsInRangeFn || collectSessionsInRange)(
    todayStart.getTime(),
    todayEnd.getTime(),
    opts.collectorOpts || {},
  );

  let todayTokens = 0;
  let todaySessionCount = 0;
  const seenSessions = new Set();
  let todayEstimatedCost = 0;

  for (const session of todaySessions) {
    todayTokens += session.totals.totalTokens || 0;
    todayEstimatedCost += getClaudeEstimatedCost(session.model, session.totals);
    if (!seenSessions.has(session.sessionId)) {
      seenSessions.add(session.sessionId);
      todaySessionCount++;
    }
  }

  data.days[todayKey] = {
    tokens: todayTokens,
    estimatedCost: todayEstimatedCost,
    sessions: todaySessionCount,
    updated: now.toISOString(),
  };

  const oldest = startOfLocalDay(now);
  oldest.setDate(oldest.getDate() - (DAY_RETENTION - 1));
  const oldestKey = toLocalDateKey(oldest);
  for (const key of Object.keys(data.days)) {
    if (key < oldestKey) delete data.days[key];
  }
}

function loadBilledCost(claudeJsonPath, machineCount) {
  if (machineCount > 1) return null;

  let billedCost = 0;
  let billedCostAvailable = false;
  try {
    const claudeJson = JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
    for (const project of Object.values(claudeJson.projects || {})) {
      if (!project?.lastCost) continue;
      billedCost += project.lastCost;
      billedCostAvailable = true;
    }
  } catch {
    return null;
  }

  return billedCostAvailable ? billedCost : null;
}

export function summarizeWindow(opts = {}) {
  const period = opts.period || '7d';
  const { configDir, weeklyFile, claudeJsonPath, aggregateDir, aggregateWeeklyFile } = resolveTrackerPaths(opts);
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
  let estimatedCost = 0;

  for (const date of dates) {
    const key = toLocalDateKey(date);
    const dayData = summaryData.days[key] || { tokens: 0, estimatedCost: 0, sessions: 0 };
    daily.push({
      date: key,
      label: dayLabel(date),
      tokens: dayData.tokens || 0,
      estimatedCost: dayData.estimatedCost || 0,
      sessions: dayData.sessions || 0,
      isToday: key === todayKey,
    });

    totalTokens += dayData.tokens || 0;
    totalSessions += dayData.sessions || 0;
    estimatedCost += dayData.estimatedCost || 0;
  }

  return {
    period: window.period,
    window: window.window,
    daily,
    totalTokens,
    sessionCount: totalSessions,
    estimatedCost,
    machineCount: aggregate.machineCount,
    billedCost: loadBilledCost(claudeJsonPath, aggregate.machineCount),
  };
}

export function refreshWeeklyData(opts = {}) {
  return summarizeWindow({ ...opts, period: '7d' });
}
