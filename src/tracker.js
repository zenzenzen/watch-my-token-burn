/**
 * Weekly usage tracker — persists daily token aggregates to JSON.
 * Storage: ~/.config/token-gauge/weekly.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, hostname } from 'node:os';
import { collectSessionsInRange } from './collector.js';
import { MODEL_PRICING } from './pricing.js';
import { resolveTokenGaugeConfigDir } from './scan-index.js';

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

function loadAggregateWeeklyData({ aggregateDir, aggregateWeeklyFile, fallbackData }) {
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

function dateKey(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function dayLabel(date) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
}

function getClaudeEstimatedCost(model, totals) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  return (
    totals.totalInput * pricing.input +
    totals.totalOutput * pricing.output +
    totals.totalCacheRead * pricing.cacheRead +
    totals.totalCacheCreate * pricing.cacheWrite
  ) / 1_000_000;
}

/**
 * Refresh today's data from session files and return weekly summary.
 */
export function refreshWeeklyData(opts = {}) {
  const { configDir, weeklyFile, claudeJsonPath, aggregateDir, aggregateWeeklyFile } = resolveTrackerPaths(opts);
  const data = loadWeeklyFile(weeklyFile);
  const now = opts.now ? new Date(opts.now) : new Date();
  const todayKey = dateKey(now);

  // Compute today's range
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // Refresh today's data from session files
  const todaySessions = (opts.collectSessionsInRangeFn || collectSessionsInRange)(
    todayStart.getTime(),
    todayEnd.getTime(),
    opts.collectorOpts || {},
  );
  let todayTokens = 0;
  let todaySessionCount = 0;
  const seenSessions = new Set();
  let todayEstimatedCost = 0;

  for (const s of todaySessions) {
    todayTokens += s.totals.totalTokens;
    todayEstimatedCost += getClaudeEstimatedCost(s.model, s.totals);
    if (!seenSessions.has(s.sessionId)) {
      todaySessionCount++;
      seenSessions.add(s.sessionId);
    }
  }

  data.days[todayKey] = {
    tokens: todayTokens,
    estimatedCost: todayEstimatedCost,
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
    aggregateWeeklyFile,
    fallbackData: data,
  });
  const summaryData = aggregate.data;

  // Build summary for the last 7 days
  const daily = [];
  let totalTokens = 0;
  let totalSessions = 0;
  let estimatedCost = 0;

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    const dayData = summaryData.days[key] || { tokens: 0, estimatedCost: 0, sessions: 0 };
    const isToday = key === todayKey;

    daily.push({
      date: key,
      label: dayLabel(d),
      tokens: dayData.tokens,
      estimatedCost: dayData.estimatedCost || 0,
      sessions: dayData.sessions,
      isToday,
    });

    totalTokens += dayData.tokens;
    totalSessions += dayData.sessions;
    estimatedCost += dayData.estimatedCost || 0;
  }

  // Pull billed costs from .claude.json when available
  let billedCost = 0;
  let billedCostAvailable = false;
  if (aggregate.machineCount <= 1) {
    try {
      const claudeJson = JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
      for (const proj of Object.values(claudeJson.projects || {})) {
        if (proj.lastCost) {
          billedCost += proj.lastCost;
          billedCostAvailable = true;
        }
      }
    } catch { /* billed cost is optional */ }
  }

  return {
    daily,
    totalTokens,
    sessionCount: totalSessions,
    estimatedCost,
    machineCount: aggregate.machineCount,
    billedCost: billedCostAvailable ? billedCost : null,
  };
}
