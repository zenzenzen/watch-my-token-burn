/**
 * Claude collector - reads Claude Code session data from ~/.claude/
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { createScanIndex, readFileChunkSync } from './scan-index.js';

const CLAUDE_SCAN_INDEX_VERSION = 2;
const CLAUDE_TIMELINE_LIMIT = 48;

function resolveClaudePaths(opts = {}) {
  const claudeDir = opts.claudeDir || join(homedir(), '.claude');
  return {
    claudeDir,
    sessionsDir: join(claudeDir, 'sessions'),
    projectsDir: join(claudeDir, 'projects'),
    claudeJsonPath: opts.claudeJsonPath || join(homedir(), '.claude.json'),
    configDir: opts.configDir || null,
    useScanIndex: opts.useScanIndex !== false,
  };
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function safeReadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function createClaudeUsageState() {
  return {
    model: 'unknown',
    latestTimestamp: null,
    latestUsage: {},
    timeline: [],
    totals: {
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheCreate: 0,
      totalTokens: 0,
      latestInput: 0,
      latestOutput: 0,
      latestTotal: 0,
      messageCount: 0,
    },
  };
}

function pushClaudeTimelinePoint(timeline, timestamp, totalTokens) {
  if (!timestamp || !Number.isFinite(totalTokens)) return;

  timeline.push({ timestamp, totalTokens });
  if (timeline.length > CLAUDE_TIMELINE_LIMIT) {
    timeline.splice(0, timeline.length - CLAUDE_TIMELINE_LIMIT);
  }
}

function applyClaudeUsageRecord(state, record) {
  const usage = record.usage || {};
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;

  state.model = record.model || state.model || 'unknown';
  state.latestTimestamp = record.timestamp || state.latestTimestamp;
  state.latestUsage = usage;
  state.totals.totalInput += input;
  state.totals.totalOutput += output;
  state.totals.totalCacheRead += cacheRead;
  state.totals.totalCacheCreate += cacheCreate;
  state.totals.totalTokens += input + output + cacheRead + cacheCreate;
  state.totals.latestInput = input + cacheRead + cacheCreate;
  state.totals.latestOutput = output;
  state.totals.latestTotal = state.totals.latestInput + output;
  state.totals.messageCount += 1;
  pushClaudeTimelinePoint(state.timeline, record.timestamp, state.totals.totalTokens);
}

function parseClaudeUsageChunk(content, state = createClaudeUsageState()) {
  if (!content) return state;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type !== 'assistant' || !msg.message?.usage) continue;
      applyClaudeUsageRecord(state, {
        timestamp: msg.timestamp || msg.message?.timestamp || null,
        model: msg.message.model,
        usage: msg.message.usage,
      });
    } catch {
      // Skip malformed lines.
    }
  }

  return state;
}

function findSessionJsonl(sessionId, projectsDir) {
  if (!existsSync(projectsDir)) return null;
  try {
    const projectDirs = readdirSync(projectsDir, { withFileTypes: true });
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const jsonlPath = join(projectsDir, dir.name, `${sessionId}.jsonl`);
      if (existsSync(jsonlPath)) {
        return { path: jsonlPath, projectDir: dir.name };
      }
    }
  } catch {
    // Ignore missing or unreadable directories.
  }
  return null;
}

function projectDirToName(dirName) {
  const parts = dirName.replace(/^-/, '').split('-');
  const skip = new Set(['Users', 'home', 'dev', 'root']);
  const meaningful = [];
  let foundMeaningful = false;

  for (const part of parts) {
    if (!foundMeaningful && skip.has(part)) continue;
    foundMeaningful = true;
    meaningful.push(part);
  }

  return meaningful.join('-') || dirName;
}

function computeContextBreakdown(latest = {}) {
  const active = latest.input_tokens || 0;
  const loaded = latest.cache_read_input_tokens || 0;
  const stale = latest.cache_creation_input_tokens || 0;
  const total = active + loaded + stale;

  return { active, loaded, stale, total };
}

function createClaudeSessionSnapshot(state = createClaudeUsageState()) {
  return {
    model: state.model || 'unknown',
    latestTimestamp: state.latestTimestamp || null,
    timeline: [...(state.timeline || [])],
    context: computeContextBreakdown(state.latestUsage || {}),
    totals: {
      ...state.totals,
    },
  };
}

function collectClaudeLogSnapshot(path, index = null) {
  const stat = statSync(path);

  if (!index) {
    return createClaudeSessionSnapshot(parseClaudeUsageChunk(readFileSync(path, 'utf8')));
  }

  const cachedEntry = index.getEntry(path);
  const status = index.getStatus(path, stat);

  if (status === 'unchanged' && cachedEntry?.payload?.kind === 'claude-usage') {
    return cachedEntry.payload.snapshot;
  }

  let state = createClaudeUsageState();
  let startOffset = 0;

  if (status === 'append' && cachedEntry?.payload?.kind === 'claude-usage') {
    state = {
      model: cachedEntry.payload.snapshot.model || 'unknown',
      latestTimestamp: cachedEntry.payload.snapshot.latestTimestamp || null,
      latestUsage: cachedEntry.payload.latestUsage || {},
      timeline: [...(cachedEntry.payload.snapshot.timeline || [])],
      totals: { ...cachedEntry.payload.snapshot.totals },
    };
    startOffset = cachedEntry.offset || cachedEntry.size || 0;
  }

  parseClaudeUsageChunk(readFileChunkSync(path, startOffset), state);
  const snapshot = createClaudeSessionSnapshot(state);
  index.updateEntry(path, stat, {
    kind: 'claude-usage',
    latestUsage: state.latestUsage || {},
    snapshot,
  }, {
    offset: stat.size,
    latestTimestamp: snapshot.latestTimestamp,
  });

  return snapshot;
}

/**
 * @typedef {Object} SessionTotals
 * @property {number} totalInput
 * @property {number} totalOutput
 * @property {number} totalCacheRead
 * @property {number} totalCacheCreate
 * @property {number} totalTokens
 * @property {number} latestInput
 * @property {number} latestOutput
 * @property {number} latestTotal
 * @property {number} messageCount
 */

/**
 * @typedef {Object} SessionContext
 * @property {number} active   - Fresh input tokens in the latest turn
 * @property {number} loaded   - Cache-read tokens (warm cache)
 * @property {number} stale    - Cache-creation tokens (cold write)
 * @property {number} total    - Sum of active + loaded + stale
 */

/**
 * @typedef {Object} ClaudeSession
 * @property {string} sessionId
 * @property {string} shortId
 * @property {number} pid
 * @property {boolean} alive
 * @property {string} cwd
 * @property {string} projectName
 * @property {number|undefined} startedAt
 * @property {string} kind
 * @property {string} model
 * @property {Array<{timestamp: string, totalTokens: number}>} timeline
 * @property {SessionContext} context
 * @property {SessionTotals} totals
 */

export function collectSessions(opts = {}) {
  const { sessionsDir, projectsDir, configDir, useScanIndex } = resolveClaudePaths(opts);
  const sessions = [];
  const scanIndex = useScanIndex ? createScanIndex({
    name: 'claude',
    version: CLAUDE_SCAN_INDEX_VERSION,
    configDir,
  }) : null;
  const touchedPaths = [];

  if (!existsSync(sessionsDir)) return sessions;

  let sessionFiles = [];
  try {
    sessionFiles = readdirSync(sessionsDir).filter(file => file.endsWith('.json'));
  } catch {
    return sessions;
  }

  for (const file of sessionFiles) {
    const meta = safeReadJson(join(sessionsDir, file));
    if (!meta || !meta.sessionId) continue;

    const pid = meta.pid || parseInt(basename(file, '.json'), 10);
    const alive = isPidAlive(pid);
    const jsonlInfo = findSessionJsonl(meta.sessionId, projectsDir);
    let projectName = 'unknown';
    let snapshot = createClaudeSessionSnapshot();

    if (jsonlInfo) {
      snapshot = collectClaudeLogSnapshot(jsonlInfo.path, scanIndex);
      projectName = projectDirToName(jsonlInfo.projectDir);
      touchedPaths.push(jsonlInfo.path);
    }

    sessions.push({
      sessionId: meta.sessionId,
      shortId: meta.sessionId.slice(0, 8),
      pid,
      alive,
      cwd: meta.cwd || '',
      projectName,
      startedAt: meta.startedAt,
      kind: meta.kind || 'unknown',
      model: snapshot.model,
      latestTimestamp: snapshot.latestTimestamp,
      timeline: snapshot.timeline || [],
      context: snapshot.context,
      totals: snapshot.totals,
    });
  }

  if (scanIndex) {
    scanIndex.pruneEntries(touchedPaths);
    scanIndex.save();
  }

  sessions.sort((a, b) => {
    if (a.alive !== b.alive) return b.alive - a.alive;
    return (b.startedAt || 0) - (a.startedAt || 0);
  });

  return sessions;
}

export function collectProjectMetrics(opts = {}) {
  const { claudeJsonPath } = resolveClaudePaths(opts);
  const data = safeReadJson(claudeJsonPath);
  if (!data?.projects) return [];

  const metrics = [];
  for (const [path, proj] of Object.entries(data.projects)) {
    if (!proj.lastTotalInputTokens && !proj.lastTotalOutputTokens) continue;

    metrics.push({
      path,
      name: path.split('/').pop() || path,
      sessionId: proj.lastSessionId,
      cost: proj.lastCost || 0,
      totalInput: proj.lastTotalInputTokens || 0,
      totalOutput: proj.lastTotalOutputTokens || 0,
      totalCacheRead: proj.lastTotalCacheReadInputTokens || 0,
      totalCacheCreate: proj.lastTotalCacheCreationInputTokens || 0,
      modelUsage: proj.lastModelUsage || {},
    });
  }

  metrics.sort((a, b) => (b.cost || 0) - (a.cost || 0));
  return metrics;
}

export function collectSessionsInRange(startMs, endMs, opts = {}) {
  const { projectsDir, configDir, useScanIndex } = resolveClaudePaths(opts);
  const results = [];
  const scanIndex = useScanIndex ? createScanIndex({
    name: 'claude',
    version: CLAUDE_SCAN_INDEX_VERSION,
    configDir,
  }) : null;
  const touchedPaths = [];
  if (!existsSync(projectsDir)) return results;

  try {
    const projectDirs = readdirSync(projectsDir, { withFileTypes: true });
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;

      const dirPath = join(projectsDir, dir.name);
      const files = readdirSync(dirPath).filter(file => file.endsWith('.jsonl'));

      for (const file of files) {
        const fullPath = join(dirPath, file);
        try {
          const stat = statSync(fullPath);
          const modified = stat.mtimeMs;
          if (modified < startMs || stat.birthtimeMs > endMs) continue;

          const snapshot = collectClaudeLogSnapshot(fullPath, scanIndex);
          if (snapshot.totals.messageCount === 0) continue;
          touchedPaths.push(fullPath);

          results.push({
            sessionId: basename(file, '.jsonl'),
            projectName: projectDirToName(dir.name),
            totals: snapshot.totals,
            fileModified: modified,
          });
        } catch {
          // Ignore unreadable session files.
        }
      }
    }
  } catch {
    // Ignore unreadable project directory.
  }

  if (scanIndex) {
    scanIndex.pruneEntries(touchedPaths);
    scanIndex.save();
  }

  return results;
}
