/**
 * Weekly usage tracker — persists daily token aggregates to JSON.
 * Storage: ~/.config/token-gauge/weekly.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { collectSessionsInRange } from './collector.js';

const CONFIG_DIR = join(homedir(), '.config', 'token-gauge');
const WEEKLY_FILE = join(CONFIG_DIR, 'weekly.json');

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadWeeklyFile() {
  try {
    return JSON.parse(readFileSync(WEEKLY_FILE, 'utf8'));
  } catch {
    return { days: {}, lastUpdated: null };
  }
}

function saveWeeklyFile(data) {
  try {
    ensureDir();
    data.lastUpdated = new Date().toISOString();
    writeFileSync(WEEKLY_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

function dateKey(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function dayLabel(date) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
}

/**
 * Refresh today's data from session files and return weekly summary.
 */
export function refreshWeeklyData() {
  const data = loadWeeklyFile();
  const now = new Date();
  const todayKey = dateKey(now);

  // Compute today's range
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // Refresh today's data from session files
  const todaySessions = collectSessionsInRange(todayStart.getTime(), todayEnd.getTime());
  let todayTokens = 0;
  let todaySessionCount = 0;
  const seenSessions = new Set();

  for (const s of todaySessions) {
    todayTokens += s.totals.totalTokens;
    if (!seenSessions.has(s.sessionId)) {
      todaySessionCount++;
      seenSessions.add(s.sessionId);
    }
  }

  data.days[todayKey] = {
    tokens: todayTokens,
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

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    const dayData = data.days[key] || { tokens: 0, sessions: 0 };
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
  }

  // Pull actual costs from .claude.json when available
  let estimatedCost = 0;
  try {
    const claudeJson = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
    for (const proj of Object.values(claudeJson.projects || {})) {
      if (proj.lastCost) estimatedCost += proj.lastCost;
    }
  } catch { /* fall back to estimate */ }
  if (estimatedCost === 0) estimatedCost = totalTokens * 0.000003;

  return {
    daily,
    totalTokens,
    sessionCount: totalSessions,
    estimatedCost,
  };
}
