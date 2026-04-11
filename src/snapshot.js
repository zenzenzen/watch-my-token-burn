import { collectSessions } from './collector.js';
import { collectCodexData } from './codex.js';
import { refreshWeeklyData } from './tracker.js';
import { MODEL_PRICING } from './pricing.js';
import { loadClaudeRateLimitCache } from './claude-rate-limits.js';
import { calculateCacheHitRate, formatModelName, basenameLabel, primaryClaudeSession, normalizeRateLimit } from './format.js';

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

function getClaudeCacheHitRate(totals) {
  return calculateCacheHitRate(totals?.totalInput, totals?.totalCacheRead);
}

function getCodexCacheHitRate(totals) {
  return calculateCacheHitRate(totals?.totalInputTokens, totals?.totalCachedInputTokens);
}

export function createClaudeLocalSnapshot(sessions, weeklyData, rateLimitCache = null) {
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
      cacheHitRate: null,
      primaryLimit: rateLimitCache?.primary ?? null,
      secondaryLimit: rateLimitCache?.secondary ?? null,
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
    cacheHitRate: getClaudeCacheHitRate(primary.totals),
    primaryLimit: rateLimitCache?.primary ?? null,
    secondaryLimit: rateLimitCache?.secondary ?? null,
    meta: {
      sessionCount: sessions.length,
      activeCount: sessions.filter(session => session.alive).length,
      weeklyTokens: weeklyData?.totalTokens ?? 0,
      weeklyCostUsd: weeklyData?.estimatedCost ?? null,
      rateLimitUpdatedAt: rateLimitCache?.updatedAt ?? null,
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
      cacheHitRate: null,
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
    cacheHitRate: getCodexCacheHitRate(active),
    primaryLimit: active.rateLimits?.primary ?? null,
    secondaryLimit: active.rateLimits?.secondary ?? null,
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
  const rateLimitCache = loadClaudeRateLimitCache();
  return createClaudeLocalSnapshot(sessions, weeklyData, rateLimitCache);
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

function getClaudeHookCacheHitRate(hookData) {
  const usage = hookData.context_window?.current_usage || {};
  return calculateCacheHitRate(usage.input_tokens, usage.cache_read_input_tokens);
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
    cacheHitRate: getClaudeHookCacheHitRate(hookData),
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

function getCodexHookCacheHitRate(hookData) {
  const usage = hookData.usage || hookData.tokens || {};
  if (usage.input_tokens !== undefined || usage.cached_input_tokens !== undefined) {
    return calculateCacheHitRate(usage.input_tokens, usage.cached_input_tokens);
  }

  const currentUsage = hookData.context_window?.current_usage || {};
  return calculateCacheHitRate(currentUsage.input_tokens, currentUsage.cached_input_tokens);
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
    cacheHitRate: getCodexHookCacheHitRate(hookData),
    primaryLimit: getCodexRateLimit(hookData.rate_limits, 'primary'),
    secondaryLimit: getCodexRateLimit(hookData.rate_limits, 'secondary'),
    meta: {
      source: hookData.source || 'hook',
    },
  };
}
