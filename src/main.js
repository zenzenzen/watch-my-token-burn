#!/usr/bin/env node

/**
 * token-gauge — Terminal usage views for local dashboards and footer hooks.
 */

import { collectSessions } from './collector.js';
import { collectCodexData } from './codex.js';
import {
  parseCliArgs,
  reduceInput,
} from './state.js';
import { refreshWeeklyData } from './tracker.js';
import { refreshCodexWeeklyData } from './codex-tracker.js';
import { renderDashboard } from './ui.js';
import {
  collectLocalSnapshot,
  createClaudeHookSnapshot,
  createCodexHookSnapshot,
} from './snapshot.js';
import { renderInlineSnapshot } from './inline.js';

const ESC = '\x1b[';

function hideCursor() { process.stdout.write(`${ESC}?25l`); }
function showCursor() { process.stdout.write(`${ESC}?25h`); }
function enterAltScreen() { process.stdout.write(`${ESC}?1049h`); }
function leaveAltScreen() { process.stdout.write(`${ESC}?1049l`); }
function clearScreen() { process.stdout.write(`${ESC}2J${ESC}H`); }

function resolveAscii(config) {
  const envLocale = `${process.env.LC_ALL || ''} ${process.env.LC_CTYPE || ''} ${process.env.LANG || ''}`;
  return Boolean(
    config.ascii ||
    process.env.TG_ASCII === '1' ||
    process.env.TG_ASCII === 'true' ||
    !/UTF-8|UTF8/i.test(envLocale)
  );
}

function printHelp() {
  console.log(`
token-gauge — Claude Code and Codex usage views

Usage: token-gauge [options]

Common options:
  --host <name>          standalone | claude | codex (default: standalone)
  --mode <name>          fullscreen | inline (default: fullscreen for standalone, inline for hooks)
  --format <name>        ansi | plain | json (default: ansi)
  --rows <n>             Inline output rows (default: 1)
  --provider <name>      Initial provider tab: claude | codex (default: claude)
  --ascii                Force ASCII-safe rendering
  --once                 Print once and exit
  -h, --help             Show this help

Standalone fullscreen options:
  -i, --interval <ms>    Refresh interval in ms (default: 15000)
  --autoclear <min>      Auto-clear stale Claude sessions after N minutes (default: 30)
  --view <mode>          compact | detail (default: compact)
  --budget <amount>      Set a cash budget in USD to show remaining spend (e.g. --budget 50)

Examples:
  token-gauge
  token-gauge --mode inline --provider codex
  token-gauge --host claude --mode inline --rows 2
  token-gauge --host codex --format json

Claude statusLine example:
  "statusLine": {
    "type": "command",
    "command": "token-gauge --host claude --mode inline --rows 2"
  }

Codex adapter note:
  --host codex expects hook JSON on stdin from a host integration layer.

Fullscreen controls:
  q / Ctrl+C            Quit
  r / Space             Force refresh
  v                     Toggle compact/detail
  [ / ]                 Switch provider tabs
  c                     Clear stale Claude sessions (Claude detail only)
`);
}

class FullscreenApp {
  constructor(config) {
    this.claudeSessions = [];
    this.claudeWeeklyData = null;
    this.codexData = null;
    this.codexWeeklyData = null;
    this.running = true;
    this.refreshInterval = config.refreshInterval;
    this.autoClearMinutes = config.autoClearMinutes;
    this.provider = config.provider;
    this.viewMode = config.viewMode;
    this.ascii = config.ascii;
    this.budget = config.budget || 0;
    this.isInteractive = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    this._teardownDone = false;
    this._weeklyCounter = 0;
  }

  collectData() {
    this.claudeSessions = collectSessions();
    this.codexData = collectCodexData();

    const weeklyRefreshEvery = Math.max(1, Math.round(30000 / this.refreshInterval));
    if (this._weeklyCounter % weeklyRefreshEvery === 0) {
      if (this.provider === 'claude') {
        this.claudeWeeklyData = refreshWeeklyData();
      } else {
        this.codexWeeklyData = refreshCodexWeeklyData();
      }
    }
    this._weeklyCounter++;
  }

  autoClear() {
    const cutoff = Date.now() - this.autoClearMinutes * 60 * 1000;
    const stale = this.claudeSessions.filter(session => !session.alive && session.startedAt && session.startedAt < cutoff);

    if (stale.length > 0) {
      this.claudeSessions = this.claudeSessions.filter(session =>
        session.alive || !session.startedAt || session.startedAt >= cutoff
      );
    }
  }

  draw() {
    const output = renderDashboard({
      provider: this.provider,
      viewMode: this.viewMode,
      claudeSessions: this.claudeSessions,
      claudeWeeklyData: this.claudeWeeklyData,
      codexData: this.codexData,
      codexWeeklyData: this.codexWeeklyData,
      cols: process.stdout.columns,
      ascii: this.ascii,
      budget: this.budget,
    });

    clearScreen();
    process.stdout.write(output);
  }

  refresh() {
    this.collectData();
    this.autoClear();
    this.draw();
  }

  clearClaudeSessions() {
    this.claudeSessions = this.claudeSessions.filter(session => session.alive);
    this.draw();
  }

  setupInput() {
    if (!this.isInteractive) return;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', key => {
      const input = reduceInput({ provider: this.provider, viewMode: this.viewMode }, key);
      this.provider = input.state.provider;
      this.viewMode = input.state.viewMode;

      switch (input.action) {
        case 'quit':
          this.quit();
          break;
        case 'clear':
          this.clearClaudeSessions();
          break;
        case 'refresh':
          this._weeklyCounter = 0;
          this.refresh();
          break;
        default:
          break;
      }
    });
  }

  quit() {
    if (this._teardownDone) process.exit(0);

    this.running = false;
    clearInterval(this._timer);

    if (this.isInteractive) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write(`${ESC}0m`);
      showCursor();
      leaveAltScreen();
    }

    this._teardownDone = true;
    process.exit(0);
  }

  run() {
    process.stdout.on('resize', () => {
      this.draw();
    });

    process.on('SIGINT', () => this.quit());
    process.on('SIGTERM', () => this.quit());

    if (this.isInteractive) {
      enterAltScreen();
      hideCursor();
      clearScreen();
    }

    this.refresh();

    this._timer = setInterval(() => {
      if (this.running) this.refresh();
    }, this.refreshInterval);

    this.setupInput();
  }
}

class InlineApp {
  constructor(config) {
    this.config = config;
    this.running = true;
    this.lineCount = 0;
  }

  render() {
    const snapshot = collectLocalSnapshot({
      provider: this.config.provider,
      cwd: process.cwd(),
    });

    if (this.config.format === 'json') {
      return JSON.stringify(snapshot, null, 2);
    }

    return renderInlineSnapshot(snapshot, {
      ansi: this.config.format !== 'plain',
      format: this.config.format,
      rows: this.config.rows,
      width: process.stdout.columns || 120,
    });
  }

  write(output) {
    const lines = output.split('\n');
    const maxLines = Math.max(this.lineCount, lines.length);

    if (this.lineCount > 0) {
      process.stdout.write(`${ESC}${this.lineCount}F`);
    }

    for (let i = 0; i < maxLines; i++) {
      process.stdout.write('\r\x1b[2K');
      process.stdout.write(lines[i] || '');
      if (i < maxLines - 1) {
        process.stdout.write('\n');
      }
    }

    this.lineCount = lines.length;
  }

  refresh() {
    this.write(this.render());
  }

  stop(exitCode = 0) {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    process.stdout.write(`\n${ESC}0m`);
    process.exit(exitCode);
  }

  run() {
    process.on('SIGINT', () => this.stop(0));
    process.on('SIGTERM', () => this.stop(0));
    process.stdout.on('resize', () => {
      if (this.running) this.refresh();
    });

    this.refresh();
    this.timer = setInterval(() => {
      if (this.running) this.refresh();
    }, this.config.refreshInterval);
  }
}

async function readStdinJson() {
  if (process.stdin.isTTY) return null;

  let buffer = '';
  for await (const chunk of process.stdin) {
    buffer += chunk;
  }

  const trimmed = buffer.trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

function renderFormattedSnapshot(snapshot, config) {
  if (config.format === 'json') {
    return JSON.stringify(snapshot, null, 2);
  }

  return renderInlineSnapshot(snapshot, {
    ansi: config.format !== 'plain',
    format: config.format,
    rows: config.rows,
    width: process.stdout.columns || 120,
  });
}

async function runHookAdapter(config) {
  const hookData = await readStdinJson();
  if (!hookData) {
    process.stderr.write('token-gauge: expected hook JSON on stdin\n');
    process.exit(1);
  }

  const snapshot = config.host === 'claude'
    ? createClaudeHookSnapshot(hookData)
    : createCodexHookSnapshot(hookData);

  process.stdout.write(`${renderFormattedSnapshot(snapshot, config)}\n`);
}

function printStandaloneInline(config) {
  const snapshot = collectLocalSnapshot({
    provider: config.provider,
    cwd: process.cwd(),
  });
  process.stdout.write(`${renderFormattedSnapshot(snapshot, config)}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const config = parseCliArgs(args);
  config.ascii = resolveAscii(config);

  if (config.help) {
    printHelp();
    process.exit(0);
  }

  if (config.host !== 'standalone') {
    await runHookAdapter(config);
    return;
  }

  if (config.mode === 'inline') {
    if (config.once || !process.stdout.isTTY) {
      printStandaloneInline(config);
      return;
    }

    new InlineApp(config).run();
    return;
  }

  const app = new FullscreenApp(config);

  if (config.once) {
    app.collectData();
    app.autoClear();
    process.stdout.write(renderDashboard({
      provider: app.provider,
      viewMode: app.viewMode,
      claudeSessions: app.claudeSessions,
      claudeWeeklyData: app.provider === 'claude' ? refreshWeeklyData() : null,
      codexData: app.codexData,
      codexWeeklyData: app.provider === 'codex' ? refreshCodexWeeklyData() : null,
      cols: process.stdout.columns,
      ascii: app.ascii,
      budget: app.budget,
    }) + '\n');
    return;
  }

  app.run();
}

await main();
