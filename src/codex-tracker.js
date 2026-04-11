/**
 * Codex weekly usage tracker — persists daily token aggregates to JSON.
 * Storage: ~/.config/token-gauge/codex-weekly.json
 *
 * "Today's sessions" are those whose latestTimestamp falls on the current UTC date.
 * Token counts are cumulative per session, so this is a per-session approximation.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CODEX_PRICING } from './pricing.js';
import { collectAllCodexSessions } from './codex.js';

const CONFIG_DIR = join(homedir(), '.config', 'token-gauge');
const CODEX_WEEKLY_FILE = join(CONFIG_DIR, 'codex-weekly.json');

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadWeeklyFile() {
  try {
    return JSON.parse(readFileSync(CODEX_WEEKLY_FILE, 'utf8'));
  } catch {
    return { days: {}, lastUpdated: null };
  }
}

function saveWeeklyFile(data) {
  try {
    ensureDir();
    data.lastUpdated = new Date().toISOString();
    writeFileSync(CODEX_WEEKLY_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
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
  const data = loadWeeklyFile();
  const now = new Date();
  const todayKey = dateKey(now);

  // Sum tokens from sessions last active today (UTC date match on latestTimestamp)
  const allSessions = collectAllCodexSessions(opts);
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

  saveWeeklyFile(data);

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
    const dayData = data.days[key] || { tokens: 0, sessions: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
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
  };
}
