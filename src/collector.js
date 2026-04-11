/**
 * Claude collector - reads Claude Code session data from ~/.claude/
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';

function resolveClaudePaths(opts = {}) {
  const claudeDir = opts.claudeDir || join(homedir(), '.claude');
  return {
    claudeDir,
    sessionsDir: join(claudeDir, 'sessions'),
    projectsDir: join(claudeDir, 'projects'),
    claudeJsonPath: opts.claudeJsonPath || join(homedir(), '.claude.json'),
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

function parseJsonlAllUsage(path) {
  try {
    const content = readFileSync(path, 'utf8');
    const lines = content.trim().split('\n');
    const usages = [];
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'assistant' && msg.message?.usage) {
          usages.push({
            timestamp: msg.timestamp || msg.message?.timestamp,
            model: msg.message.model,
            usage: msg.message.usage,
          });
        }
      } catch {
        // Skip malformed lines.
      }
    }
    return usages;
  } catch {
    return [];
  }
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

function computeContextBreakdown(usages) {
  if (usages.length === 0) {
    return { active: 0, loaded: 0, stale: 0, total: 0 };
  }

  const latest = usages[usages.length - 1].usage;
  const active = latest.input_tokens || 0;
  const loaded = latest.cache_read_input_tokens || 0;
  const stale = latest.cache_creation_input_tokens || 0;
  const total = active + loaded + stale;

  return { active, loaded, stale, total };
}

function computeSessionTotals(usages) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreate = 0;

  for (const usage of usages) {
    totalInput += usage.usage.input_tokens || 0;
    totalOutput += usage.usage.output_tokens || 0;
    totalCacheRead += usage.usage.cache_read_input_tokens || 0;
    totalCacheCreate += usage.usage.cache_creation_input_tokens || 0;
  }

  const latestUsage = usages.length > 0 ? usages[usages.length - 1].usage : {};
  const latestInput = (latestUsage.input_tokens || 0)
    + (latestUsage.cache_read_input_tokens || 0)
    + (latestUsage.cache_creation_input_tokens || 0);
  const latestOutput = latestUsage.output_tokens || 0;

  return {
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheCreate,
    totalTokens: totalInput + totalOutput + totalCacheRead + totalCacheCreate,
    latestInput,
    latestOutput,
    latestTotal: latestInput + latestOutput,
    messageCount: usages.length,
  };
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
 * @property {SessionContext} context
 * @property {SessionTotals} totals
 */

export function collectSessions(opts = {}) {
  const { sessionsDir, projectsDir } = resolveClaudePaths(opts);
  const sessions = [];

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
    let usages = [];
    let projectName = 'unknown';

    if (jsonlInfo) {
      usages = parseJsonlAllUsage(jsonlInfo.path);
      projectName = projectDirToName(jsonlInfo.projectDir);
    }

    const context = computeContextBreakdown(usages);
    const totals = computeSessionTotals(usages);

    sessions.push({
      sessionId: meta.sessionId,
      shortId: meta.sessionId.slice(0, 8),
      pid,
      alive,
      cwd: meta.cwd || '',
      projectName,
      startedAt: meta.startedAt,
      kind: meta.kind || 'unknown',
      model: usages.length > 0 ? usages[usages.length - 1].model : 'unknown',
      context,
      totals,
    });
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

  return metrics;
}

export function collectSessionsInRange(startMs, endMs, opts = {}) {
  const { projectsDir } = resolveClaudePaths(opts);
  const results = [];
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

          const usages = parseJsonlAllUsage(fullPath);
          if (usages.length === 0) continue;

          results.push({
            sessionId: basename(file, '.jsonl'),
            projectName: projectDirToName(dir.name),
            totals: computeSessionTotals(usages),
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

  return results;
}
