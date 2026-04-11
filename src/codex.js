import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { basenameLabel, normalizeRateLimit } from './format.js';
import { createScanIndex, readFileChunkSync } from './scan-index.js';

const CODEX_SCAN_INDEX_VERSION = 2;
const CODEX_TIMELINE_LIMIT = 48;

function resolveCodexPaths(opts = {}) {
  const codexDir = opts.codexDir || join(homedir(), '.codex');
  return {
    codexDir,
    sessionsDir: join(codexDir, 'sessions'),
    sessionIndexPath: join(codexDir, 'session_index.jsonl'),
    configDir: opts.configDir || null,
    useScanIndex: opts.useScanIndex !== false,
  };
}

function safeReadText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function safeJsonLines(path) {
  const text = safeReadText(path);
  if (!text) return [];

  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // Ignore malformed lines in session logs.
    }
  }
  return rows;
}

function walkJsonlFiles(dir) {
  if (!existsSync(dir)) return [];

  const files = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function extractSessionId(filePath) {
  const match = basename(filePath, '.jsonl').match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? match[1] : null;
}

function formatProviderLabel(value) {
  if (!value) return 'Codex';
  if (value === 'openai') return 'OpenAI Codex';
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)} Codex`;
}


function parseTokenCount(payload) {
  const info = payload?.info || null;
  const rateLimits = payload?.rate_limits || null;
  return { info, rateLimits };
}

function createParsedCodexState(base = {}) {
  return {
    meta: base.meta || null,
    latestTimestamp: base.latestTimestamp || null,
    tokenInfo: base.tokenInfo || null,
    rateLimits: base.rateLimits || null,
    timeline: Array.isArray(base.timeline) ? [...base.timeline] : [],
  };
}

function pushCodexTimelinePoint(timeline, timestamp, totalTokens) {
  if (!timestamp || !Number.isFinite(totalTokens)) return;

  const last = timeline[timeline.length - 1];
  if (last && last.totalTokens === totalTokens) {
    last.timestamp = timestamp;
    return;
  }

  timeline.push({ timestamp, totalTokens });
  if (timeline.length > CODEX_TIMELINE_LIMIT) {
    timeline.splice(0, timeline.length - CODEX_TIMELINE_LIMIT);
  }
}

export function parseCodexSessionLog(content, base = {}) {
  const parsed = createParsedCodexState(base);

  for (const rawLine of content.split('\n')) {
    if (!rawLine.trim()) continue;

    let line;
    try {
      line = JSON.parse(rawLine);
    } catch {
      continue;
    }

    if (line.timestamp) parsed.latestTimestamp = line.timestamp;

    if (line.type === 'session_meta' && line.payload) {
      parsed.meta = line.payload;
      continue;
    }

    if (line.type === 'event_msg' && line.payload?.type === 'token_count') {
      const tokenCount = parseTokenCount(line.payload);
      if (tokenCount.info) parsed.tokenInfo = tokenCount.info;
      if (tokenCount.rateLimits) parsed.rateLimits = tokenCount.rateLimits;
      const totalTokens = tokenCount.info?.total_token_usage?.total_tokens;
      if (Number.isFinite(totalTokens)) {
        pushCodexTimelinePoint(parsed.timeline, line.timestamp || parsed.latestTimestamp, totalTokens);
      }
    }
  }

  return parsed;
}

function collectCodexSessionRecord(filePath, indexEntry, scanIndex = null) {
  if (!scanIndex) {
    return buildSessionRecord(parseCodexSessionLog(safeReadText(filePath)), indexEntry, filePath);
  }

  const stat = statSync(filePath);
  const cachedEntry = scanIndex.getEntry(filePath);
  const status = scanIndex.getStatus(filePath, stat);

  if (status === 'unchanged' && cachedEntry?.payload?.kind === 'codex-session') {
    return buildSessionRecord(cachedEntry.payload.parsed, indexEntry, filePath);
  }

  const base = status === 'append' && cachedEntry?.payload?.kind === 'codex-session'
    ? createParsedCodexState(cachedEntry.payload.parsed)
    : createParsedCodexState();
  const startOffset = status === 'append' && cachedEntry ? (cachedEntry.offset || cachedEntry.size || 0) : 0;
  const parsed = parseCodexSessionLog(readFileChunkSync(filePath, startOffset), base);

  scanIndex.updateEntry(filePath, stat, {
    kind: 'codex-session',
    parsed,
  }, {
    offset: stat.size,
    latestTimestamp: parsed.latestTimestamp || null,
  });

  return buildSessionRecord(parsed, indexEntry, filePath);
}

function buildFileMap(sessionsDir) {
  const filesById = new Map();
  for (const filePath of walkJsonlFiles(sessionsDir)) {
    const id = extractSessionId(filePath);
    if (id) filesById.set(id, filePath);
  }
  return filesById;
}

function buildFallbackRecord(indexEntry) {
  return {
    id: indexEntry.id,
    threadName: indexEntry.thread_name || indexEntry.id.slice(0, 8),
    cwd: '',
    workspaceLabel: 'unknown',
    startedAt: indexEntry.updated_at || null,
    latestTimestamp: indexEntry.updated_at || null,
    providerLabel: 'OpenAI Codex',
    modelLabel: 'Codex',
    totalTokens: 0,
    totalInputTokens: 0,
    totalCachedInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningOutputTokens: 0,
    lastTokens: 0,
    lastInputTokens: 0,
    lastCachedInputTokens: 0,
    lastOutputTokens: 0,
    lastReasoningOutputTokens: 0,
    currentContextTokens: 0,
    modelContextWindow: 0,
    rateLimits: null,
    timeline: [],
    liveDataFound: false,
    filePath: null,
  };
}

function buildSessionRecord(parsed, indexEntry, filePath) {
  if (!parsed.meta) {
    return buildFallbackRecord(indexEntry);
  }

  const totalUsage = parsed.tokenInfo?.total_token_usage || {};
  const lastUsage = parsed.tokenInfo?.last_token_usage || {};
  const currentContextTokens = lastUsage.total_tokens
    || (lastUsage.input_tokens || 0)
      + (lastUsage.cached_input_tokens || 0)
      + (lastUsage.output_tokens || 0)
      + (lastUsage.reasoning_output_tokens || 0);

  return {
    id: parsed.meta.id || indexEntry.id,
    threadName: indexEntry.thread_name || basenameLabel(parsed.meta.cwd) || (parsed.meta.id || '').slice(0, 8),
    cwd: parsed.meta.cwd || '',
    workspaceLabel: basenameLabel(parsed.meta.cwd),
    startedAt: parsed.meta.timestamp || parsed.timeline[0]?.timestamp || indexEntry.updated_at || null,
    latestTimestamp: parsed.latestTimestamp || indexEntry.updated_at || parsed.meta.timestamp || null,
    providerLabel: formatProviderLabel(parsed.meta.model_provider),
    modelLabel: 'Codex',
    totalTokens: totalUsage.total_tokens || 0,
    totalInputTokens: totalUsage.input_tokens || 0,
    totalCachedInputTokens: totalUsage.cached_input_tokens || 0,
    totalOutputTokens: totalUsage.output_tokens || 0,
    totalReasoningOutputTokens: totalUsage.reasoning_output_tokens || 0,
    lastTokens: lastUsage.total_tokens || 0,
    lastInputTokens: lastUsage.input_tokens || 0,
    lastCachedInputTokens: lastUsage.cached_input_tokens || 0,
    lastOutputTokens: lastUsage.output_tokens || 0,
    lastReasoningOutputTokens: lastUsage.reasoning_output_tokens || 0,
    currentContextTokens,
    modelContextWindow: parsed.tokenInfo?.model_context_window || 0,
    rateLimits: parsed.rateLimits
      ? {
          primary: normalizeRateLimit(parsed.rateLimits.primary),
          secondary: normalizeRateLimit(parsed.rateLimits.secondary),
        }
      : null,
    timeline: parsed.timeline || [],
    liveDataFound: Boolean(parsed.tokenInfo || parsed.rateLimits),
    filePath,
  };
}

/**
 * @typedef {{ usedPercent: number|null, resetsAt: number|null }} NormalizedRateLimit
 */

/**
 * @typedef {Object} CodexSession
 * @property {string} id
 * @property {string} threadName
 * @property {string} cwd
 * @property {string} workspaceLabel
 * @property {string|null} startedAt
 * @property {string|null} latestTimestamp
 * @property {string} providerLabel
 * @property {string} modelLabel
 * @property {number} totalTokens
 * @property {number} totalInputTokens
 * @property {number} totalCachedInputTokens
 * @property {number} totalOutputTokens
 * @property {number} totalReasoningOutputTokens
 * @property {number} lastTokens
 * @property {number} lastInputTokens
 * @property {number} lastCachedInputTokens
 * @property {number} lastOutputTokens
 * @property {number} lastReasoningOutputTokens
 * @property {number} currentContextTokens
 * @property {number} modelContextWindow
 * @property {{ primary: NormalizedRateLimit|null, secondary: NormalizedRateLimit|null }|null} rateLimits
 * @property {Array<{timestamp: string, totalTokens: number}>} timeline
 * @property {boolean} liveDataFound
 * @property {string|null} filePath
 */

/**
 * @typedef {Object} CodexData
 * @property {CodexSession|null} activeSession
 * @property {Array<{id: string, threadName: string, updatedAt: string|null, workspaceLabel: string, matchCwd: boolean, liveDataFound: boolean}>} recentThreads
 * @property {string} cwd
 * @property {number} allTotalInputTokens
 * @property {number} allTotalOutputTokens
 * @property {number} allTotalCachedInputTokens
 */

export function collectAllCodexSessions(opts = {}) {
  const { sessionsDir, sessionIndexPath, configDir, useScanIndex } = resolveCodexPaths(opts);
  const indexEntries = safeJsonLines(sessionIndexPath)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const filesById = buildFileMap(sessionsDir);
  const scanIndex = useScanIndex ? createScanIndex({
    name: 'codex',
    version: CODEX_SCAN_INDEX_VERSION,
    configDir,
  }) : null;
  const touchedPaths = [];

  const sessions = indexEntries.map(entry => {
    const filePath = filesById.get(entry.id);
    if (!filePath) return buildFallbackRecord(entry);
    touchedPaths.push(filePath);
    return collectCodexSessionRecord(filePath, entry, scanIndex);
  });

  if (scanIndex) {
    scanIndex.pruneEntries(touchedPaths);
    scanIndex.save();
  }

  return sessions;
}

export function collectCodexData(opts = {}) {
  const { sessionsDir, sessionIndexPath, configDir, useScanIndex } = resolveCodexPaths(opts);
  const cwd = opts.cwd || process.cwd();
  const indexEntries = safeJsonLines(sessionIndexPath)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const filesById = buildFileMap(sessionsDir);
  const cache = new Map();
  const scanIndex = useScanIndex ? createScanIndex({
    name: 'codex',
    version: CODEX_SCAN_INDEX_VERSION,
    configDir,
  }) : null;
  const touchedPaths = [];

  function getRecord(indexEntry) {
    if (cache.has(indexEntry.id)) return cache.get(indexEntry.id);

    const filePath = filesById.get(indexEntry.id);
    if (!filePath) {
      const fallback = buildFallbackRecord(indexEntry);
      cache.set(indexEntry.id, fallback);
      return fallback;
    }

    touchedPaths.push(filePath);
    const record = collectCodexSessionRecord(filePath, indexEntry, scanIndex);
    cache.set(indexEntry.id, record);
    return record;
  }

  let activeSession = null;
  for (const entry of indexEntries) {
    const record = getRecord(entry);
    if (record.cwd && record.cwd === cwd) {
      activeSession = record;
      break;
    }
  }

  if (!activeSession && indexEntries.length > 0) {
    activeSession = getRecord(indexEntries[0]);
  }

  const recentThreads = indexEntries.slice(0, 5).map(entry => {
    const record = getRecord(entry);
    return {
      id: entry.id,
      threadName: entry.thread_name || record.threadName,
      updatedAt: entry.updated_at || record.latestTimestamp,
      workspaceLabel: record.workspaceLabel,
      matchCwd: Boolean(record.cwd && record.cwd === cwd),
      liveDataFound: record.liveDataFound,
    };
  });

  // Aggregate token totals across all sessions for total cost tracking.
  let allTotalInputTokens = 0;
  let allTotalOutputTokens = 0;
  let allTotalCachedInputTokens = 0;
  for (const entry of indexEntries) {
    const record = getRecord(entry);
    allTotalInputTokens += record.totalInputTokens;
    allTotalOutputTokens += record.totalOutputTokens;
    allTotalCachedInputTokens += record.totalCachedInputTokens;
  }

  if (scanIndex) {
    scanIndex.pruneEntries(touchedPaths);
    scanIndex.save();
  }

  return {
    activeSession,
    recentThreads,
    cwd,
    allTotalInputTokens,
    allTotalOutputTokens,
    allTotalCachedInputTokens,
  };
}
