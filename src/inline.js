const ESC = '\x1b[';
const ANSI_REGEX = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

const THEME = {
  claude: { brand: 205, accent: 39, soft: 221, ok: 49, dim: 245 },
  codex: { brand: 39, accent: 81, soft: 221, ok: 49, dim: 245 },
};

function fg256(code) {
  return `${ESC}38;5;${code}m`;
}

function bg256(code) {
  return `${ESC}48;5;${code}m`;
}

const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
const BOLD = `${ESC}1m`;

export function stripAnsi(value) {
  return String(value || '').replace(ANSI_REGEX, '');
}

function visibleLength(value) {
  return stripAnsi(value).length;
}

function formatTokens(value) {
  const numeric = Number(value) || 0;
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) return `${(numeric / 1_000).toFixed(1)}K`;
  return String(numeric);
}

function formatCost(value) {
  if (value === null || value === undefined) return '--';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `${Math.round(value)}%`;
}

function formatReset(unixSeconds, now = Date.now()) {
  if (!unixSeconds) return '--';
  const diffMs = Math.max(0, unixSeconds * 1000 - now);
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

function truncateVisible(text, max) {
  const input = String(text || '');
  if (visibleLength(input) <= max) return input;

  let output = '';
  let count = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '\x1b') {
      const match = input.slice(i).match(/^\x1b\[[0-9;?]*[ -/]*[@-~]/);
      if (match) {
        output += match[0];
        i += match[0].length - 1;
        continue;
      }
    }
    if (count >= max - 1) break;
    output += char;
    count++;
  }

  return `${output}…${RESET}`;
}

function fitLine(line, width) {
  if (!width || visibleLength(line) <= width) return line;
  return truncateVisible(line, Math.max(4, width));
}

function badge(text, fg, bg, plain) {
  return plain ? `[${text}]` : `${bg256(bg)}${fg256(fg)} ${text} ${RESET}`;
}

function dimText(text, plain) {
  return plain ? text : `${DIM}${text}${RESET}`;
}

function boldText(text, plain) {
  return plain ? text : `${BOLD}${text}${RESET}`;
}

function buildSegments(snapshot, plain) {
  const palette = THEME[snapshot.provider] || THEME.codex;
  const brandLabel = snapshot.provider === 'claude' ? 'CLAUDE' : 'CODEX';
  const segments = [
    badge('TG', palette.soft, palette.brand, plain),
    badge(brandLabel, 16, palette.accent, plain),
    boldText(snapshot.sessionLabel || snapshot.workspaceLabel || 'unknown', plain),
  ];

  if (snapshot.modelLabel) {
    segments.push(dimText(snapshot.modelLabel, plain));
  }

  if (snapshot.contextTokens) {
    segments.push(`ctx ${formatTokens(snapshot.contextTokens)}/${formatTokens(snapshot.contextWindow || 0)}`);
  }

  if (snapshot.totalTokens) {
    segments.push(`tok ${formatTokens(snapshot.totalTokens)}`);
  }

  if (snapshot.costUsd !== null && snapshot.costUsd !== undefined) {
    segments.push(`cost ${formatCost(snapshot.costUsd)}`);
  }

  if (snapshot.primaryLimit) {
    segments.push(`5h ${formatPercent(snapshot.primaryLimit.usedPercent)} · ${formatReset(snapshot.primaryLimit.resetsAt)}`);
  }

  if (snapshot.secondaryLimit) {
    segments.push(`7d ${formatPercent(snapshot.secondaryLimit.usedPercent)} · ${formatReset(snapshot.secondaryLimit.resetsAt)}`);
  }

  if (snapshot.statusLabel && snapshot.statusLabel !== 'hook') {
    segments.push(dimText(snapshot.statusLabel, plain));
  }

  return segments;
}

function splitSegments(segments) {
  if (segments.length <= 4) {
    return [segments.join('  ')];
  }

  const top = segments.slice(0, 4).join('  ');
  const bottom = segments.slice(4).join('  ');
  return [top, bottom];
}

export function renderInlineSnapshot(snapshot, options = {}) {
  const width = options.width || process.stdout.columns || 100;
  const plain = options.format === 'plain' || !options.ansi;
  const rows = Math.max(1, options.rows || 1);
  const segments = buildSegments(snapshot, plain);

  const lines = rows > 1 ? splitSegments(segments) : [segments.join('  ')];
  return lines.map(line => fitLine(line, width)).join('\n');
}
