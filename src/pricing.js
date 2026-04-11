export const MODEL_PRICING = {
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.875, cacheWrite: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.375, cacheWrite: 3.75 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  default: { input: 15, output: 75, cacheRead: 1.875, cacheWrite: 18.75 },
};

// OpenAI o4-mini pricing per 1M tokens (default for Codex CLI)
export const CODEX_PRICING = {
  default: { input: 1.1, output: 4.4, cacheRead: 0.275 },
};
