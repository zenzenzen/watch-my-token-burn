import { collectSessions } from './collector.js';
import { collectCodexData } from './codex.js';
import { refreshWeeklyData } from './tracker.js';
import { MODEL_PRICING } from './pricing.js';
import { formatModelName, basenameLabel, primaryClaudeSession } from './format.js';

function getClaudeSessionCost(model, totals) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  return (
    totals.totalInput * pricing.input +
    totals.totalOutput * pricing.output +
    totals.totalCacheRead * pricing.cacheRead +
    totals.totalCacheCreate * pricing.cacheWrite
  ) / 1_000_000;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function normalizeRateLimit(limit, percentKey = 'used_percent') {
  if (!limit) return null;
  const usedPercent = limit.used_percentage ?? limit[percentKey] ?? null;
  const resetsAt = limit.resets_at ?? null;
  if (usedPercent === null && resetsAt === null) return null;
  return { usedPercent, resetsAt };
}

export function createClaudeLocalSnapshot(sessions, weeklyData) {
  const primary = primaryClaudeSession(sessions);
  if (!primary) {
    return {
      version: 1,
      host: 'standalone',
      provider: 'claude',
      title: 'No Claude sessions',
      sessionLabel: 'Claude',
      workspaceLabel: 'unknown',
      modelLabel: 'unknown',
      statusLabel: 'idle',
      totalTokens: 0,
      contextTokens: 0,
      contextWindow: 200_000,
      costUsd: weeklyData?.estimatedCost ?? null,
      primaryLimit: null,
      secondaryLimit: null,
    };
  }

  return {
    version: 1,
    host: 'standalone',
    provider: 'claude',
    sessionId: primary.sessionId,
    title: primary.projectName,
    sessionLabel: primary.projectName || 'Claude',
    workspaceLabel: primary.projectName || basenameLabel(primary.cwd),
    cwd: primary.cwd,
    modelId: primary.model,
    modelLabel: formatModelName(primary.model),
    statusLabel: primary.alive ? 'active' : 'ended',
    totalTokens: primary.totals.totalTokens,
    contextTokens: primary.context.total,
    contextWindow: 200_000,
    lastTokens: primary.totals.latestTotal,
    costUsd: getClaudeSessionCost(primary.model, primary.totals),
    primaryLimit: null,
    secondaryLimit: null,
    meta: {
      sessionCount: sessions.length,
      activeCount: sessions.filter(session => session.alive).length,
      weeklyTokens: weeklyData?.totalTokens ?? 0,
      weeklyCostUsd: weeklyData?.estimatedCost ?? null,
    },
  };
}

export function createCodexLocalSnapshot(codexData) {
  const active = codexData?.activeSession;
  if (!active) {
    return {
      version: 1,
      host: 'standalone',
      provider: 'codex',
      title: 'No Codex sessions',
      sessionLabel: 'Codex',
      workspaceLabel: 'unknown',
      modelLabel: 'Codex',
      statusLabel: 'idle',
      totalTokens: 0,
      contextTokens: 0,
      contextWindow: 0,
      costUsd: null,
      primaryLimit: null,
      secondaryLimit: null,
    };
  }

  return {
    version: 1,
    host: 'standalone',
    provider: 'codex',
    sessionId: active.id,
    title: active.threadName || active.workspaceLabel || 'Codex',
    sessionLabel: active.threadName || active.workspaceLabel || 'Codex',
    workspaceLabel: active.workspaceLabel || basenameLabel(active.cwd),
    cwd: active.cwd,
    modelId: active.providerLabel || 'codex',
    modelLabel: active.modelLabel || 'Codex',
    statusLabel: active.liveDataFound ? 'live' : 'recent',
    totalTokens: active.totalTokens || 0,
    contextTokens: active.currentContextTokens || 0,
    contextWindow: active.modelContextWindow || 0,
    lastTokens: active.lastTokens || 0,
    costUsd: null,
    primaryLimit: normalizeRateLimit(active.rateLimits?.primary),
    secondaryLimit: normalizeRateLimit(active.rateLimits?.secondary),
    meta: {
      recentThreads: (codexData?.recentThreads || []).length,
    },
  };
}

export function collectLocalSnapshot({ provider = 'claude', cwd = process.cwd() } = {}) {
  if (provider === 'codex') {
    return createCodexLocalSnapshot(collectCodexData({ cwd }));
  }

  const sessions = collectSessions();
  const weeklyData = refreshWeeklyData();
  return createClaudeLocalSnapshot(sessions, weeklyData);
}

function getContextUsageTotal(contextWindow) {
  const usage = contextWindow?.current_usage;
  if (!usage) return 0;
  if (usage.total_tokens !== undefined) return Number(usage.total_tokens) || 0;
  return sum([
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens,
  ]);
}

function getTokenTotalsFromClaudeHook(hookData) {
  const contextWindow = hookData.context_window || {};

  return {
    totalTokens: sum([
      contextWindow.total_input_tokens,
      contextWindow.total_output_tokens,
    ]),
    contextTokens: getContextUsageTotal(contextWindow),
    contextWindow: contextWindow.context_window_size || 200_000,
  };
}

export function createClaudeHookSnapshot(hookData) {
  const totals = getTokenTotalsFromClaudeHook(hookData);
  const cwd = hookData.workspace?.current_dir || hookData.cwd || '';

  return {
    version: 1,
    host: 'claude',
    provider: 'claude',
    sessionId: hookData.session_id,
    title: hookData.session_name || basenameLabel(cwd),
    sessionLabel: hookData.session_name || basenameLabel(cwd),
    workspaceLabel: basenameLabel(hookData.workspace?.project_dir || cwd),
    cwd,
    modelId: hookData.model?.id || 'claude',
    modelLabel: hookData.model?.display_name || formatModelName(hookData.model?.id),
    statusLabel: 'hook',
    totalTokens: totals.totalTokens,
    contextTokens: totals.contextTokens,
    contextWindow: totals.contextWindow,
    costUsd: hookData.cost?.total_cost_usd ?? null,
    primaryLimit: normalizeRateLimit(hookData.rate_limits?.five_hour, 'used_percentage'),
    secondaryLimit: normalizeRateLimit(hookData.rate_limits?.seven_day, 'used_percentage'),
    meta: {
      outputStyle: hookData.output_style?.name,
      version: hookData.version,
    },
  };
}

function getCodexRateLimit(rateLimits, name) {
  return normalizeRateLimit(rateLimits?.[name], 'used_percent')
    || normalizeRateLimit(rateLimits?.[name === 'primary' ? 'five_hour' : 'seven_day'], 'used_percentage');
}

function getCodexTotalTokens(hookData) {
  const usage = hookData.usage || hookData.tokens || {};
  const contextWindow = hookData.context_window || {};
  const currentUsage = contextWindow.current_usage || {};

  return {
    totalTokens: usage.total_tokens !== undefined
      ? (Number(usage.total_tokens) || 0)
      : sum([
          usage.input_tokens,
          usage.cached_input_tokens,
          usage.output_tokens,
          usage.reasoning_output_tokens,
        ]),
    contextTokens: contextWindow.current_tokens !== undefined
      ? (Number(contextWindow.current_tokens) || 0)
      : currentUsage.total_tokens !== undefined
        ? (Number(currentUsage.total_tokens) || 0)
        : sum([
            currentUsage.input_tokens,
            currentUsage.cached_input_tokens,
            currentUsage.output_tokens,
            currentUsage.reasoning_output_tokens,
          ]),
    contextWindow: contextWindow.context_window_size || usage.model_context_window || 0,
    lastTokens: usage.last_tokens || contextWindow.last_tokens || 0,
  };
}

export function createCodexHookSnapshot(hookData) {
  if (hookData?.version === 1 && hookData.provider === 'codex') {
    return { ...hookData, host: 'codex' };
  }

  const cwd = hookData.workspace?.current_dir || hookData.cwd || hookData.session?.cwd || '';
  const totals = getCodexTotalTokens(hookData);

  return {
    version: 1,
    host: 'codex',
    provider: 'codex',
    sessionId: hookData.session_id || hookData.session?.id,
    title: hookData.session_name || hookData.session?.name || basenameLabel(cwd),
    sessionLabel: hookData.session_name || hookData.session?.name || basenameLabel(cwd),
    workspaceLabel: hookData.session?.workspace_label || basenameLabel(hookData.workspace?.project_dir || cwd),
    cwd,
    modelId: hookData.model?.id || 'codex',
    modelLabel: hookData.model?.display_name || hookData.session?.model_label || 'Codex',
    statusLabel: hookData.status || 'hook',
    totalTokens: totals.totalTokens,
    contextTokens: totals.contextTokens,
    contextWindow: totals.contextWindow,
    lastTokens: totals.lastTokens,
    costUsd: hookData.cost?.total_cost_usd ?? null,
    primaryLimit: getCodexRateLimit(hookData.rate_limits, 'primary'),
    secondaryLimit: getCodexRateLimit(hookData.rate_limits, 'secondary'),
    meta: {
      source: hookData.source || 'hook',
    },
  };
}
