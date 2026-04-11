import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeRateLimit } from './format.js';
import { resolveTokenGaugeConfigDir } from './scan-index.js';

function resolveCachePaths(opts = {}) {
  const configDir = resolveTokenGaugeConfigDir(opts.configDir);
  return {
    configDir,
    cacheFile: opts.cacheFilePath || join(configDir, 'claude-rate-limits.json'),
  };
}

function ensureDir(configDir) {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

export function loadClaudeRateLimitCache(opts = {}) {
  const { cacheFile } = resolveCachePaths(opts);
  try {
    const parsed = JSON.parse(readFileSync(cacheFile, 'utf8'));
    const primary = normalizeRateLimit(parsed.primary, 'usedPercent');
    const secondary = normalizeRateLimit(parsed.secondary, 'usedPercent');
    if (!primary && !secondary) return null;
    return {
      primary,
      secondary,
      updatedAt: parsed.updatedAt || null,
    };
  } catch {
    return null;
  }
}

export function saveClaudeRateLimitCache(rateLimits, opts = {}) {
  const { configDir, cacheFile } = resolveCachePaths(opts);
  try {
    ensureDir(configDir);
    writeFileSync(cacheFile, JSON.stringify({
      updatedAt: new Date().toISOString(),
      primary: rateLimits?.primary ?? null,
      secondary: rateLimits?.secondary ?? null,
    }, null, 2));
    return true;
  } catch {
    return false;
  }
}
