import { buildAnalytics } from './analytics.js';
import { collectProjectMetrics, collectSessions, collectSessionsInRange } from './collector.js';
import { collectAllCodexSessions, collectCodexData } from './codex.js';
import { loadClaudeRateLimitCache } from './claude-rate-limits.js';
import { buildWindow } from './period.js';
import { summarizeWindow as summarizeClaudeWindow } from './tracker.js';
import { summarizeWindow as summarizeCodexWindow } from './codex-tracker.js';

function sanitizeClaudeSession(session) {
  const { turns, ...rest } = session;
  return rest;
}

function sanitizeCodexSession(session) {
  if (!session) return session;
  const { turns, ...rest } = session;
  return rest;
}

export function collectStandaloneState(config = {}, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const now = opts.now || opts.generatedAt || new Date().toISOString();
  const selectedPeriod = config.period || '7d';
  const claudeCollectorOpts = opts.claudeCollectorOpts || {};
  const codexCollectorOpts = opts.codexCollectorOpts || {};
  const claudeTrackerOpts = {
    aggregateDir: config.aggregateDir || null,
    period: selectedPeriod,
    now,
    ...(opts.claudeTrackerOpts || {}),
  };
  const codexTrackerOpts = {
    aggregateDir: config.aggregateDir || null,
    period: selectedPeriod,
    now,
    ...(opts.codexTrackerOpts || {}),
  };

  const claudeSessions = collectSessions(claudeCollectorOpts);
  const claudeProjectMetrics = collectProjectMetrics(claudeCollectorOpts);
  const claudeRateLimits = loadClaudeRateLimitCache(claudeCollectorOpts);
  const codexData = collectCodexData({ cwd, ...codexCollectorOpts });
  const claudeSummary = summarizeClaudeWindow(claudeTrackerOpts);
  const codexSummary = summarizeCodexWindow(codexTrackerOpts);
  const analyticsWindow = buildWindow(selectedPeriod, now);
  const claudeAnalyticsSessions = collectSessionsInRange(
    analyticsWindow.startMs,
    analyticsWindow.endMs,
    claudeCollectorOpts,
  );
  const codexAnalyticsSessions = collectAllCodexSessions(codexCollectorOpts);

  return {
    version: 2,
    host: 'standalone',
    generatedAt: opts.generatedAt || new Date().toISOString(),
    selectedProvider: config.provider || 'claude',
    selectedViewMode: config.viewMode || 'compact',
    selectedPeriod,
    budget: config.budget || 0,
    claude: {
      sessions: claudeSessions.map(sanitizeClaudeSession),
      projectMetrics: claudeProjectMetrics,
      rateLimits: claudeRateLimits,
      summary: claudeSummary,
      analytics: buildAnalytics(claudeAnalyticsSessions, analyticsWindow),
    },
    codex: {
      ...codexData,
      activeSession: sanitizeCodexSession(codexData.activeSession),
      summary: codexSummary,
      analytics: buildAnalytics(codexAnalyticsSessions, analyticsWindow),
    },
  };
}
