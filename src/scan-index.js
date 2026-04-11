import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_CONFIG_DIR = join(homedir(), '.config', 'token-gauge');

export function resolveTokenGaugeConfigDir(configDir = null) {
  return configDir || DEFAULT_CONFIG_DIR;
}

function ensureConfigDir(configDir) {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

function safeReadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function readFileChunkSync(path, start = 0) {
  const stat = statSync(path);
  if (start <= 0) return readFileSync(path, 'utf8');
  if (start >= stat.size) return '';

  const fd = openSync(path, 'r');
  try {
    const size = stat.size - start;
    const buffer = Buffer.alloc(size);
    readSync(fd, buffer, 0, size, start);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

export function createScanIndex({ name, version = 1, configDir = null } = {}) {
  const resolvedConfigDir = resolveTokenGaugeConfigDir(configDir);
  const indexPath = join(resolvedConfigDir, `${name}-scan-index.json`);
  const loaded = safeReadJson(indexPath);
  const initialData = loaded?.version === version
    ? loaded
    : { version, updatedAt: null, files: {} };
  const files = { ...(initialData.files || {}) };

  function getEntry(filePath) {
    return files[filePath] || null;
  }

  function getStatus(filePath, stat) {
    const entry = getEntry(filePath);
    if (!entry) return 'new';
    if (entry.version !== version) return 'reset';
    if (entry.size === stat.size && entry.mtimeMs === stat.mtimeMs) return 'unchanged';
    if (entry.size < stat.size) return 'append';
    return 'reset';
  }

  function updateEntry(filePath, stat, payload, extra = {}) {
    files[filePath] = {
      version,
      path: filePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      offset: extra.offset ?? stat.size,
      latestTimestamp: extra.latestTimestamp ?? null,
      payload,
    };
  }

  function pruneEntries(validPaths) {
    const valid = new Set(validPaths);
    for (const filePath of Object.keys(files)) {
      if (!valid.has(filePath)) {
        delete files[filePath];
      }
    }
  }

  function save() {
    ensureConfigDir(resolvedConfigDir);
    writeFileSync(indexPath, JSON.stringify({
      version,
      updatedAt: new Date().toISOString(),
      files,
    }, null, 2));
  }

  function clear() {
    for (const filePath of Object.keys(files)) {
      delete files[filePath];
    }
  }

  return {
    name,
    version,
    configDir: resolvedConfigDir,
    indexPath,
    getEntry,
    getStatus,
    updateEntry,
    pruneEntries,
    save,
    clear,
  };
}
