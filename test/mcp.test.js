import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  createMcpServer,
  GET_STANDALONE_STATE_TOOL,
  STANDALONE_STATE_RESOURCE_URI,
  handleMcpRequest,
} from '../src/mcp.js';

function createStubState(overrides = {}) {
  return {
    version: 2,
    host: 'standalone',
    generatedAt: '2026-04-12T12:30:00.000Z',
    selectedProvider: 'codex',
    selectedViewMode: 'detail',
    selectedPeriod: '7d',
    budget: 25,
    claude: {
      sessions: [],
      projectMetrics: [],
      rateLimits: null,
      summary: { totalTokens: 0, window: { label: 'Last 7 days' } },
      analytics: { categoryBreakdown: [] },
    },
    codex: {
      activeSession: { id: 'session-1' },
      recentThreads: [],
      summary: { totalTokens: 1000, window: { label: 'Last 7 days' } },
      analytics: { categoryBreakdown: [] },
    },
    ...overrides,
  };
}

function createFramedMessage(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function parseFramedMessages(buffer) {
  const messages = [];
  let remaining = buffer;

  while (remaining.length > 0) {
    const headerEnd = remaining.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = remaining.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    assert.ok(match, `missing content length in ${header}`);
    const length = Number.parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (remaining.length < bodyEnd) break;
    const body = remaining.slice(bodyStart, bodyEnd);
    messages.push(JSON.parse(body));
    remaining = remaining.slice(bodyEnd);
  }

  return { messages, remaining };
}

test('handleMcpRequest exposes initialize, tools, resource, and tool call results', async () => {
  const collectStandaloneStateFn = config => createStubState({
    selectedProvider: config.provider,
    selectedViewMode: config.viewMode,
    selectedPeriod: config.period,
    budget: config.budget,
  });

  const initialize = await handleMcpRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {},
  }, { collectStandaloneStateFn });
  assert.equal(initialize.result.serverInfo.name, 'token-gauge');
  assert.ok(initialize.result.capabilities.tools);
  assert.ok(initialize.result.capabilities.resources);

  const tools = await handleMcpRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  }, { collectStandaloneStateFn });
  assert.equal(tools.result.tools.length, 1);
  assert.equal(tools.result.tools[0].name, GET_STANDALONE_STATE_TOOL);

  const resources = await handleMcpRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'resources/list',
    params: {},
  }, { collectStandaloneStateFn });
  assert.equal(resources.result.resources[0].uri, STANDALONE_STATE_RESOURCE_URI);

  const toolCall = await handleMcpRequest({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: GET_STANDALONE_STATE_TOOL,
      arguments: {
        provider: 'claude',
        viewMode: 'compact',
        period: '30d',
        budget: 12.5,
      },
    },
  }, { collectStandaloneStateFn });
  assert.equal(toolCall.result.structuredContent.selectedProvider, 'claude');
  assert.equal(toolCall.result.structuredContent.selectedViewMode, 'compact');
  assert.equal(toolCall.result.structuredContent.selectedPeriod, '30d');
  assert.equal(toolCall.result.structuredContent.budget, 12.5);
  assert.match(toolCall.result.content[0].text, /"selectedProvider": "claude"/);

  const resourceRead = await handleMcpRequest({
    jsonrpc: '2.0',
    id: 5,
    method: 'resources/read',
    params: {
      uri: STANDALONE_STATE_RESOURCE_URI,
    },
  }, { collectStandaloneStateFn });
  assert.equal(resourceRead.result.contents[0].uri, STANDALONE_STATE_RESOURCE_URI);
  assert.match(resourceRead.result.contents[0].text, /"host": "standalone"/);
});

test('createMcpServer speaks Content-Length framed JSON-RPC over stdio', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const collectStandaloneStateFn = () => createStubState();
  const responses = [];
  let responseBuffer = '';

  output.setEncoding('utf8');
  output.on('data', chunk => {
    responseBuffer += chunk;
    const parsed = parseFramedMessages(responseBuffer);
    responses.push(...parsed.messages);
    responseBuffer = parsed.remaining;
  });

  createMcpServer({
    input,
    output,
    collectStandaloneStateFn,
  }).start();

  input.write(createFramedMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: GET_STANDALONE_STATE_TOOL,
      arguments: {
        provider: 'codex',
      },
    },
  }));

  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(responses.length, 1);
  assert.equal(responses[0].id, 1);
  assert.equal(responses[0].result.structuredContent.selectedProvider, 'codex');
});
