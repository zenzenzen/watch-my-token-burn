import { collectProjectMetrics, collectSessions } from './collector.js';
import { collectCodexData } from './codex.js';
import { loadClaudeRateLimitCache } from './claude-rate-limits.js';
import { refreshWeeklyData } from './tracker.js';
import { refreshCodexWeeklyData } from './codex-tracker.js';

export function collectStandaloneState(config = {}, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const claudeCollectorOpts = opts.claudeCollectorOpts || {};
  const codexCollectorOpts = opts.codexCollectorOpts || {};
  const claudeTrackerOpts = {
    aggregateDir: config.aggregateDir || null,
    ...(opts.claudeTrackerOpts || {}),
  };
  const codexTrackerOpts = {
    aggregateDir: config.aggregateDir || null,
    ...(opts.codexTrackerOpts || {}),
  };

  const claudeSessions = collectSessions(claudeCollectorOpts);
  const claudeProjectMetrics = collectProjectMetrics(claudeCollectorOpts);
  const claudeRateLimits = loadClaudeRateLimitCache(claudeCollectorOpts);
  const codexData = collectCodexData({ cwd, ...codexCollectorOpts });
  const claudeWeeklyData = refreshWeeklyData(claudeTrackerOpts);
  const codexWeeklyData = refreshCodexWeeklyData(codexTrackerOpts);

  return {
    version: 1,
    host: 'standalone',
    generatedAt: opts.generatedAt || new Date().toISOString(),
    selectedProvider: config.provider || 'claude',
    selectedViewMode: config.viewMode || 'compact',
    budget: config.budget || 0,
    claude: {
      sessions: claudeSessions,
      projectMetrics: claudeProjectMetrics,
      rateLimits: claudeRateLimits,
      weekly: claudeWeeklyData,
    },
    codex: {
      ...codexData,
      weekly: codexWeeklyData,
    },
  };
}
