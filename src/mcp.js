import { collectStandaloneState } from './full-state.js';
import {
  normalizePeriod,
  normalizeProvider,
  normalizeViewMode,
  parseCliArgs,
} from './state.js';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_INFO = {
  name: 'token-gauge',
  version: '1.0.0',
};
export const STANDALONE_STATE_RESOURCE_URI = 'token-gauge://standalone-state';
export const GET_STANDALONE_STATE_TOOL = 'get_standalone_state';

function parseBudget(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeString(value, fallback = null) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function buildToolDefinition() {
  return {
    name: GET_STANDALONE_STATE_TOOL,
    description: 'Return the full standalone token-gauge state for Claude and Codex sessions.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        provider: {
          type: 'string',
          enum: ['claude', 'codex'],
          description: 'Selected provider tab reflected in the returned state.',
        },
        viewMode: {
          type: 'string',
          enum: ['compact', 'detail'],
          description: 'Selected standalone view mode reflected in the returned state.',
        },
        budget: {
          type: 'number',
          description: 'Optional budget target in USD.',
        },
        period: {
          type: 'string',
          enum: ['today', '7d', '30d', 'month'],
          description: 'Optional reporting window for summary and analytics.',
        },
        cwd: {
          type: 'string',
          description: 'Optional current working directory used to resolve the active Codex session.',
        },
        aggregateDir: {
          type: 'string',
          description: 'Optional shared weekly aggregation directory override.',
        },
      },
    },
  };
}

function buildResourceDefinition() {
  return {
    uri: STANDALONE_STATE_RESOURCE_URI,
    name: 'Standalone Token Gauge State',
    description: 'Full standalone token-gauge state using config-file defaults.',
    mimeType: 'application/json',
  };
}

export function buildStandaloneState(args = {}, opts = {}) {
  const defaultConfig = opts.defaultConfig || parseCliArgs([], opts.parseCliArgsOpts);
  const cwd = normalizeString(args.cwd, opts.cwd || process.cwd());
  const aggregateDir = normalizeString(args.aggregateDir, defaultConfig.aggregateDir);

  return (opts.collectStandaloneStateFn || collectStandaloneState)({
    provider: normalizeProvider(args.provider ?? defaultConfig.provider),
    viewMode: normalizeViewMode(args.viewMode ?? args.view ?? defaultConfig.viewMode),
    period: normalizePeriod(args.period ?? defaultConfig.period),
    budget: parseBudget(args.budget, defaultConfig.budget || 0),
    aggregateDir,
  }, {
    cwd,
    generatedAt: opts.generatedAt,
  });
}

function createJsonRpcResult(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function createJsonRpcError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  };
}

export async function handleMcpRequest(request, opts = {}) {
  if (!request || typeof request !== 'object') {
    return createJsonRpcError(null, -32600, 'Invalid Request');
  }

  const { id = null, method, params = {} } = request;
  if (!method || typeof method !== 'string') {
    return createJsonRpcError(id, -32600, 'Invalid Request');
  }

  if (method === 'notifications/initialized' || request.id === undefined) {
    return null;
  }

  try {
    switch (method) {
      case 'initialize':
        return createJsonRpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: {},
            resources: {},
          },
          serverInfo: MCP_SERVER_INFO,
        });
      case 'ping':
        return createJsonRpcResult(id, {});
      case 'tools/list':
        return createJsonRpcResult(id, {
          tools: [buildToolDefinition()],
        });
      case 'tools/call': {
        if (params?.name !== GET_STANDALONE_STATE_TOOL) {
          return createJsonRpcError(id, -32602, `Unknown tool: ${params?.name || 'undefined'}`);
        }

        const state = buildStandaloneState(params.arguments || {}, opts);
        return createJsonRpcResult(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(state, null, 2),
            },
          ],
          structuredContent: state,
        });
      }
      case 'resources/list':
        return createJsonRpcResult(id, {
          resources: [buildResourceDefinition()],
        });
      case 'resources/templates/list':
        return createJsonRpcResult(id, {
          resourceTemplates: [],
        });
      case 'prompts/list':
        return createJsonRpcResult(id, {
          prompts: [],
        });
      case 'resources/read': {
        if (params?.uri !== STANDALONE_STATE_RESOURCE_URI) {
          return createJsonRpcError(id, -32602, `Unknown resource: ${params?.uri || 'undefined'}`);
        }

        const state = buildStandaloneState({}, opts);
        return createJsonRpcResult(id, {
          contents: [
            {
              uri: STANDALONE_STATE_RESOURCE_URI,
              mimeType: 'application/json',
              text: JSON.stringify(state, null, 2),
            },
          ],
        });
      }
      default:
        return createJsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    return createJsonRpcError(id, -32000, error instanceof Error ? error.message : 'Internal error');
  }
}

export function createMcpServer({
  input = process.stdin,
  output = process.stdout,
  onError = error => process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`),
  ...opts
} = {}) {
  let buffer = Buffer.alloc(0);

  function writeMessage(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    output.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
    output.write(body);
  }

  async function processMessage(message) {
    const response = await handleMcpRequest(message, opts);
    if (response) writeMessage(response);
  }

  async function processBuffer() {
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headerText = buffer.slice(0, headerEnd).toString('utf8');
      const contentLengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        onError(new Error('Missing Content-Length header'));
        buffer = Buffer.alloc(0);
        return;
      }

      const contentLength = Number.parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (buffer.length < messageEnd) return;

      const messageText = buffer.slice(messageStart, messageEnd).toString('utf8');
      buffer = buffer.slice(messageEnd);

      try {
        await processMessage(JSON.parse(messageText));
      } catch (error) {
        onError(error);
        writeMessage(createJsonRpcError(null, -32700, 'Parse error'));
      }
    }
  }

  return {
    start() {
      input.on('data', chunk => {
        buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
        void processBuffer();
      });
    },
  };
}
