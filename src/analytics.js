import { CODEX_PRICING, MODEL_PRICING } from './pricing.js';

export const CATEGORY_ORDER = [
  'coding',
  'debugging',
  'testing',
  'refactoring',
  'exploration',
  'planning',
  'delegation',
  'git',
  'build_deploy',
  'general',
];

const EDIT_CATEGORIES = new Set(['coding', 'debugging', 'refactoring']);
const CLAUDE_EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const CODEX_EDIT_TOOLS = new Set(['apply_patch']);
const READ_COMMAND_PREFIXES = ['rg', 'grep', 'sed', 'cat', 'ls', 'find', 'wc', 'head', 'tail'];
const TEST_COMMANDS = ['pytest', 'npm test', 'pnpm test', 'vitest', 'go test'];
const BUILD_COMMANDS = ['npm build', 'pnpm build'];
const GIT_COMMANDS = ['git status', 'git diff', 'git commit'];

function safeText(value) {
  return typeof value === 'string' ? value : '';
}

function lowerText(value) {
  return safeText(value).toLowerCase();
}

function hasAny(haystack, needles) {
  return needles.some(needle => haystack.includes(needle));
}

function roundCost(value) {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function roundMetric(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function roundScore(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreLowerIsBetter(value, excellent, poor) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value <= excellent) return 100;
  if (value >= poor) return 0;
  return roundScore(100 * (1 - ((value - excellent) / (poor - excellent))));
}

function compactSessionId(value) {
  return safeText(value).slice(0, 8) || 'unknown';
}

function getSessionLabel(session, sessionId) {
  return session?.projectName
    || session?.threadName
    || session?.workspaceLabel
    || compactSessionId(sessionId);
}

function getSessionContextMetrics(session) {
  const contextTokens = session?.currentContextTokens
    ?? session?.context?.total
    ?? null;
  const contextLimit = session?.modelContextWindow
    ?? session?.contextLimit
    ?? null;

  return {
    contextTokens: roundMetric(contextTokens),
    contextLimit: roundMetric(contextLimit),
  };
}

function scoreChat({ turns, tokens, contextTokens, contextLimit }) {
  const avgTokensPerTurn = turns > 0 ? tokens / turns : null;
  const contextPerTurn = turns > 0 && Number.isFinite(contextTokens)
    ? contextTokens / turns
    : null;
  const contextUtilization = Number.isFinite(contextTokens) && Number.isFinite(contextLimit) && contextLimit > 0
    ? contextTokens / contextLimit
    : null;

  const tokenEfficiencyScore = scoreLowerIsBetter(avgTokensPerTurn, 2_000, 20_000);
  let contextEfficiencyScore = scoreLowerIsBetter(contextPerTurn, 1_500, 15_000);

  if (contextEfficiencyScore !== null && contextUtilization !== null && contextUtilization > 0.75) {
    const pressurePenalty = Math.min(20, (contextUtilization - 0.75) / 0.25 * 20);
    contextEfficiencyScore = roundScore(contextEfficiencyScore - pressurePenalty);
  }

  const availableScores = [
    { score: tokenEfficiencyScore, weight: 0.55 },
    { score: contextEfficiencyScore, weight: 0.45 },
  ].filter(item => item.score !== null);
  const weightTotal = availableScores.reduce((sum, item) => sum + item.weight, 0);
  const score = weightTotal > 0
    ? roundScore(availableScores.reduce((sum, item) => sum + item.score * item.weight, 0) / weightTotal)
    : null;

  return {
    score,
    tokenEfficiencyScore,
    contextEfficiencyScore,
    avgTokensPerTurn: roundMetric(avgTokensPerTurn),
    contextPerTurn: roundMetric(contextPerTurn),
    contextUtilization,
  };
}

export function estimateClaudeCost(model, usage = {}) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  return roundCost((
    (usage.inputTokens || 0) * pricing.input +
    (usage.outputTokens || 0) * pricing.output +
    (usage.cachedInputTokens || 0) * pricing.cacheRead +
    (usage.cacheCreationTokens || 0) * pricing.cacheWrite
  ) / 1_000_000);
}

export function estimateCodexCost(usage = {}) {
  const pricing = CODEX_PRICING.default;
  return roundCost((
    (usage.inputTokens || 0) * pricing.input +
    (usage.outputTokens || 0) * pricing.output +
    (usage.cachedInputTokens || 0) * pricing.cacheRead
  ) / 1_000_000);
}

export function buildClaudeTurnUsage(model, rawUsage = {}) {
  const usage = {
    inputTokens: rawUsage.input_tokens || 0,
    cachedInputTokens: rawUsage.cache_read_input_tokens || 0,
    cacheCreationTokens: rawUsage.cache_creation_input_tokens || 0,
    outputTokens: rawUsage.output_tokens || 0,
    reasoningOutputTokens: 0,
  };
  usage.totalTokens = usage.inputTokens + usage.cachedInputTokens + usage.cacheCreationTokens + usage.outputTokens;
  usage.estimatedCost = estimateClaudeCost(model, usage);
  return usage;
}

export function buildCodexTurnUsage(rawUsage = {}) {
  const usage = {
    inputTokens: rawUsage.input_tokens || 0,
    cachedInputTokens: rawUsage.cached_input_tokens || 0,
    cacheCreationTokens: 0,
    outputTokens: rawUsage.output_tokens || 0,
    reasoningOutputTokens: rawUsage.reasoning_output_tokens || 0,
  };
  usage.totalTokens = rawUsage.total_tokens
    || usage.inputTokens + usage.cachedInputTokens + usage.outputTokens + usage.reasoningOutputTokens;
  usage.estimatedCost = estimateCodexCost(usage);
  return usage;
}

export function normalizeMcpServer(name) {
  if (!name || !name.startsWith('mcp__')) return null;
  const parts = name.split('__');
  return parts.length >= 3 ? parts[1] : null;
}

export function normalizeShellCommand(command) {
  const trimmed = safeText(command).trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('pytest')) return 'pytest';
  if (lower.startsWith('npm test')) return 'npm test';
  if (lower.startsWith('pnpm test')) return 'pnpm test';
  if (lower.startsWith('vitest')) return 'vitest';
  if (lower.startsWith('go test')) return 'go test';
  if (lower.startsWith('git status')) return 'git status';
  if (lower.startsWith('git diff')) return 'git diff';
  if (lower.startsWith('git commit')) return 'git commit';
  if (lower.startsWith('npm build')) return 'npm build';
  if (lower.startsWith('pnpm build')) return 'pnpm build';

  const first = lower.split(/\s+/)[0];
  return first || null;
}

export function normalizeToolCall(name, command = null, extra = {}) {
  return {
    name,
    kind: normalizeMcpServer(name) ? 'mcp' : 'core',
    mcpServer: normalizeMcpServer(name),
    command: normalizeShellCommand(command) ? safeText(command).trim() : (safeText(command).trim() || null),
    ...extra,
  };
}

export function parseJsonArgumentString(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function extractParallelExecCommands(argumentText) {
  const parsed = parseJsonArgumentString(argumentText);
  if (!parsed || !Array.isArray(parsed.tool_uses)) return [];

  const commands = [];
  for (const toolUse of parsed.tool_uses) {
    if (toolUse?.recipient_name !== 'functions.exec_command') continue;
    const cmd = safeText(toolUse.parameters?.cmd).trim();
    if (!cmd) continue;
    commands.push(normalizeToolCall('exec_command', cmd));
  }
  return commands;
}

export function isClaudeSyntheticUserMessage(message) {
  const content = lowerText(message);
  return content.includes('<local-command-caveat>')
    || content.includes('<local-command-stdout>')
    || content.includes('<local-command-stderr>')
    || content.includes('<command-name>/');
}

export function extractClaudeUserText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content.map(item => {
    if (!item || typeof item !== 'object') return '';
    if (item.type === 'text') return safeText(item.text);
    if (item.type === 'tool_result') return safeText(item.content);
    return '';
  }).filter(Boolean).join('\n').trim();
}

function isReadToolName(name) {
  return ['Read', 'Glob', 'Grep', 'LS'].includes(name);
}

function isReadCommandLabel(label) {
  return label ? READ_COMMAND_PREFIXES.includes(label) : false;
}

function isBuildCommandLabel(label) {
  return label ? BUILD_COMMANDS.includes(label) : false;
}

function isTestCommandLabel(label) {
  return label ? TEST_COMMANDS.includes(label) : false;
}

function isGitCommandLabel(label) {
  return label ? GIT_COMMANDS.includes(label) : false;
}

function isMutatingCommand(commandText) {
  const command = lowerText(commandText);
  if (!command) return false;
  return command.includes('apply_patch')
    || command.includes('sed -i')
    || command.includes('perl -pi')
    || command.includes('tee ')
    || command.includes(' >')
    || command.startsWith('mv ')
    || command.startsWith('cp ')
    || command.startsWith('cat >');
}

export function turnHasWriteSignal(turn) {
  return (turn.toolCalls || []).some(tool => {
    if (turn.provider === 'claude' && CLAUDE_EDIT_TOOLS.has(tool.name)) return true;
    if (turn.provider === 'codex' && CODEX_EDIT_TOOLS.has(tool.name)) return true;
    return isMutatingCommand(tool.command);
  });
}

function hasTool(turn, names) {
  return (turn.toolCalls || []).some(tool => names.has(tool.name));
}

function commandLabels(turn) {
  return (turn.toolCalls || []).map(tool => normalizeShellCommand(tool.command)).filter(Boolean);
}

function allLowerCommands(turn) {
  return (turn.toolCalls || []).map(tool => lowerText(tool.command)).filter(Boolean);
}

export function classifyTurn(turn) {
  const text = lowerText(turn.userText);
  const labels = commandLabels(turn);
  const commands = allLowerCommands(turn);
  const toolNames = new Set((turn.toolCalls || []).map(tool => tool.name));
  const hasWriteSignal = turnHasWriteSignal(turn);

  if (toolNames.has('Agent') || toolNames.has('spawn_agent') || hasAny(text, ['delegate', 'delegat', 'subagent'])) {
    return 'delegation';
  }

  if (labels.some(isGitCommandLabel) || hasAny(text, ['git ', 'commit', 'rebase', 'diff'])) {
    return 'git';
  }

  if (labels.some(isBuildCommandLabel) || hasAny(text, ['deploy', 'build', 'release', 'vercel', 'docker'])) {
    return 'build_deploy';
  }

  if (labels.some(isTestCommandLabel) || (!hasWriteSignal && hasAny(text, ['test', 'pytest', 'vitest', 'failing spec', 'flaky']))) {
    return 'testing';
  }

  if (
    hasAny(text, ['debug', 'bug', 'error', 'traceback', 'stack trace', 'fix failing', 'investigate']) ||
    commands.some(command => command.includes('console') || command.includes('log'))
  ) {
    return 'debugging';
  }

  if (hasAny(text, ['refactor', 'cleanup', 'clean up', 'rename', 'reorganize', 'extract'])) {
    return 'refactoring';
  }

  if (hasWriteSignal || hasAny(text, ['implement', 'add ', 'build ', 'create ', 'write ', 'change ', 'update ', 'patch '])) {
    return 'coding';
  }

  if (
    hasTool(turn, new Set(['Read', 'Glob', 'Grep', 'LS', 'exec_command'])) ||
    labels.some(isReadCommandLabel) ||
    hasAny(text, ['inspect', 'look at', 'explore', 'analyze', 'review'])
  ) {
    return 'exploration';
  }

  if (hasAny(text, ['plan', 'roadmap', 'spec', 'proposal', 'outline', 'mermaid chart'])) {
    return 'planning';
  }

  return 'general';
}

function isRetryIntermediate(turn) {
  const labels = commandLabels(turn);
  if (turn.category === 'testing' || turn.category === 'debugging') return true;
  if (turn.category !== 'exploration') return false;

  if ((turn.toolCalls || []).some(tool => isReadToolName(tool.name))) return true;
  return labels.some(isReadCommandLabel) || labels.some(isTestCommandLabel);
}

function calculateRetryTurnIds(turns) {
  const retryIds = new Set();
  const sessionGroups = new Map();

  for (const turn of turns) {
    if (!sessionGroups.has(turn.sessionId)) sessionGroups.set(turn.sessionId, []);
    sessionGroups.get(turn.sessionId).push(turn);
  }

  for (const sessionTurns of sessionGroups.values()) {
    sessionTurns.sort((a, b) => Date.parse(a.timestamp || '') - Date.parse(b.timestamp || ''));

    for (let index = 0; index < sessionTurns.length; index++) {
      const current = sessionTurns[index];
      if (!turnHasWriteSignal(current) || !EDIT_CATEGORIES.has(current.category)) continue;

      let sawLoopStep = false;
      for (let lookahead = index + 1; lookahead < sessionTurns.length && lookahead <= index + 4; lookahead++) {
        const next = sessionTurns[lookahead];
        if (turnHasWriteSignal(next)) {
          if (sawLoopStep && EDIT_CATEGORIES.has(next.category)) {
            retryIds.add(current.id);
          }
          break;
        }

        if (!isRetryIntermediate(next)) break;
        sawLoopStep = true;
      }
    }
  }

  return retryIds;
}

function allocateByDistinctLabel(turns, selectLabels) {
  const rows = new Map();

  for (const turn of turns) {
    const labels = selectLabels(turn);
    if (!labels.length) continue;

    const uniqueLabels = [...new Set(labels)];
    const tokenShare = (turn.usage?.totalTokens || 0) / uniqueLabels.length;
    const costShare = (turn.usage?.estimatedCost || 0) / uniqueLabels.length;

    for (const label of uniqueLabels) {
      const row = rows.get(label) || {
        label,
        calls: 0,
        turns: 0,
        tokens: 0,
        estimatedCost: 0,
      };
      row.turns += 1;
      row.tokens += tokenShare;
      row.estimatedCost += costShare;
      rows.set(label, row);
    }

    for (const label of labels) {
      rows.get(label).calls += 1;
    }
  }

  return rows;
}

function sortBreakdown(rows, labelKey) {
  return [...rows.values()]
    .sort((a, b) =>
      (b.tokens - a.tokens)
      || (b.calls - a.calls)
      || String(a[labelKey]).localeCompare(String(b[labelKey])))
    .map(row => ({
      ...row,
      tokens: Math.round(row.tokens),
      estimatedCost: roundCost(row.estimatedCost),
    }));
}

export function filterTurnsByWindow(turns = [], startMs, endMs) {
  return turns.filter(turn => {
    const timestampMs = Date.parse(turn.timestamp || '');
    return Number.isFinite(timestampMs) && timestampMs >= startMs && timestampMs <= endMs;
  });
}

export function buildAnalytics(sessions = [], window) {
  const sessionsById = new Map();
  for (const session of sessions) {
    const sessionId = session.sessionId || session.id;
    if (sessionId) sessionsById.set(sessionId, session);
  }

  const allTurns = sessions.flatMap(session => (session.turns || []).map(turn => ({
    ...turn,
    sessionId: turn.sessionId || session.sessionId || session.id,
  })));
  const filteredTurns = filterTurnsByWindow(allTurns, window.startMs, window.endMs)
    .map(turn => ({
      ...turn,
      category: classifyTurn(turn),
    }))
    .sort((a, b) => Date.parse(a.timestamp || '') - Date.parse(b.timestamp || ''));

  const retryTurnIds = calculateRetryTurnIds(filteredTurns);
  const sessionCount = new Set(filteredTurns.map(turn => turn.sessionId)).size;
  const totalTokens = filteredTurns.reduce((sum, turn) => sum + (turn.usage?.totalTokens || 0), 0);
  const totalCost = filteredTurns.reduce((sum, turn) => sum + (turn.usage?.estimatedCost || 0), 0);
  const scoringRows = new Map();

  const categoryRows = new Map();
  for (const category of CATEGORY_ORDER) {
    categoryRows.set(category, {
      category,
      turns: 0,
      tokens: 0,
      estimatedCost: 0,
      editTurns: 0,
      retryTurns: 0,
      oneShotTurns: 0,
      oneShotRate: null,
    });
  }

  for (const turn of filteredTurns) {
    const row = categoryRows.get(turn.category);
    row.turns += 1;
    row.tokens += turn.usage?.totalTokens || 0;
    row.estimatedCost += turn.usage?.estimatedCost || 0;

    const scoreKey = turn.sessionId || 'unknown';
    const scoreRow = scoringRows.get(scoreKey) || {
      sessionId: scoreKey,
      turns: 0,
      tokens: 0,
      estimatedCost: 0,
      firstTimestamp: turn.timestamp || null,
      lastTimestamp: turn.timestamp || null,
    };
    scoreRow.turns += 1;
    scoreRow.tokens += turn.usage?.totalTokens || 0;
    scoreRow.estimatedCost += turn.usage?.estimatedCost || 0;
    if (!scoreRow.firstTimestamp || String(turn.timestamp || '').localeCompare(String(scoreRow.firstTimestamp)) < 0) {
      scoreRow.firstTimestamp = turn.timestamp || scoreRow.firstTimestamp;
    }
    if (!scoreRow.lastTimestamp || String(turn.timestamp || '').localeCompare(String(scoreRow.lastTimestamp)) > 0) {
      scoreRow.lastTimestamp = turn.timestamp || scoreRow.lastTimestamp;
    }
    scoringRows.set(scoreKey, scoreRow);

    if (turnHasWriteSignal(turn) && EDIT_CATEGORIES.has(turn.category)) {
      row.editTurns += 1;
      if (retryTurnIds.has(turn.id)) {
        row.retryTurns += 1;
      }
    }
  }

  const categoryBreakdown = CATEGORY_ORDER.map(category => {
    const row = categoryRows.get(category);
    row.oneShotTurns = Math.max(0, row.editTurns - row.retryTurns);
    row.oneShotRate = row.editTurns > 0 ? row.oneShotTurns / row.editTurns : null;
    row.tokens = Math.round(row.tokens);
    row.estimatedCost = roundCost(row.estimatedCost);
    return row;
  });

  const toolBreakdown = sortBreakdown(
    allocateByDistinctLabel(filteredTurns, turn => (turn.toolCalls || []).map(tool => tool.name).filter(Boolean)),
    'label',
  ).map(row => ({
    tool: row.label,
    calls: row.calls,
    turns: row.turns,
    tokens: row.tokens,
    estimatedCost: row.estimatedCost,
  }));

  const mcpBreakdown = sortBreakdown(
    allocateByDistinctLabel(filteredTurns, turn => (turn.toolCalls || []).map(tool => tool.mcpServer).filter(Boolean)),
    'label',
  ).map(row => ({
    server: row.label,
    calls: row.calls,
    turns: row.turns,
    tokens: row.tokens,
    estimatedCost: row.estimatedCost,
  }));

  const bashBreakdown = sortBreakdown(
    allocateByDistinctLabel(filteredTurns, turn => (turn.toolCalls || []).map(tool => normalizeShellCommand(tool.command)).filter(Boolean)),
    'label',
  ).map(row => ({
    command: row.label,
    calls: row.calls,
    turns: row.turns,
    tokens: row.tokens,
    estimatedCost: row.estimatedCost,
  }));

  const chatScoring = [...scoringRows.values()]
    .map(row => {
      const session = sessionsById.get(row.sessionId);
      const context = getSessionContextMetrics(session);
      const score = scoreChat({
        turns: row.turns,
        tokens: row.tokens,
        contextTokens: context.contextTokens,
        contextLimit: context.contextLimit,
      });

      return {
        sessionId: row.sessionId,
        label: getSessionLabel(session, row.sessionId),
        turns: row.turns,
        tokens: Math.round(row.tokens),
        estimatedCost: roundCost(row.estimatedCost),
        contextTokens: context.contextTokens,
        contextLimit: context.contextLimit,
        ...score,
        contextUtilization: score.contextUtilization === null ? null : Math.round(score.contextUtilization * 1000) / 1000,
        firstTimestamp: row.firstTimestamp,
        lastTimestamp: row.lastTimestamp,
      };
    })
    .sort((a, b) =>
      ((b.score ?? -1) - (a.score ?? -1))
      || (b.turns - a.turns)
      || (b.tokens - a.tokens)
      || String(a.label).localeCompare(String(b.label)));

  return {
    window: window.window,
    totals: {
      turns: filteredTurns.length,
      sessions: sessionCount,
      tokens: totalTokens,
      estimatedCost: roundCost(totalCost),
    },
    categoryBreakdown,
    toolBreakdown,
    mcpBreakdown,
    bashBreakdown,
    chatScoring,
  };
}
