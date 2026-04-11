import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { basenameLabel } from './format.js';

function resolveCodexPaths(opts = {}) {
  const codexDir = opts.codexDir || join(homedir(), '.codex');
  return {
    codexDir,
    sessionsDir: join(codexDir, 'sessions'),
    sessionIndexPath: join(codexDir, 'session_index.jsonl'),
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

export function parseCodexSessionLog(content) {
  const parsed = {
    meta: null,
    latestTimestamp: null,
    tokenInfo: null,
    rateLimits: null,
  };

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
    }
  }

  return parsed;
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
    latestTimestamp: indexEntry.updated_at || parsed.latestTimestamp || parsed.meta.timestamp || null,
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
    rateLimits: parsed.rateLimits || null,
    liveDataFound: Boolean(parsed.tokenInfo || parsed.rateLimits),
    filePath,
  };
}

export function collectCodexData(opts = {}) {
  const { sessionsDir, sessionIndexPath } = resolveCodexPaths(opts);
  const cwd = opts.cwd || process.cwd();
  const indexEntries = safeJsonLines(sessionIndexPath)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const filesById = buildFileMap(sessionsDir);
  const cache = new Map();

  function getRecord(indexEntry) {
    if (cache.has(indexEntry.id)) return cache.get(indexEntry.id);

    const filePath = filesById.get(indexEntry.id);
    if (!filePath) {
      const fallback = buildFallbackRecord(indexEntry);
      cache.set(indexEntry.id, fallback);
      return fallback;
    }

    const parsed = parseCodexSessionLog(safeReadText(filePath));
    const record = buildSessionRecord(parsed, indexEntry, filePath);
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

  return {
    activeSession,
    recentThreads,
    cwd,
    allTotalInputTokens,
    allTotalOutputTokens,
    allTotalCachedInputTokens,
  };
}
