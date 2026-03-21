import { randomUUID } from 'node:crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createBearerAuthMiddleware } from './auth.js';
import { registerMemoryTools } from './tools/memories.js';
import { registerResourceTools } from './tools/resources.js';
import { registerSessionTools } from './tools/sessions.js';

const MCP_AUTH_TOKEN = process.env['MCP_AUTH_TOKEN'];
const VIKING_TS_URL = process.env['VIKING_TS_URL'] ?? 'http://127.0.0.1:1934';
const MCP_PORT = Number(process.env['MCP_PORT'] ?? '3001');
const MCP_HOST = process.env['MCP_HOST'] ?? '0.0.0.0';

if (!MCP_AUTH_TOKEN) {
  process.stderr.write(
    'FATAL: MCP_AUTH_TOKEN environment variable is required. ' +
    'Set it to a secure random string before starting the server.\n',
  );
  process.exit(1);
}

const vikingConfig = { baseUrl: VIKING_TS_URL };

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'viking-ts-mcp',
    version: '0.1.0',
  });

  registerMemoryTools(server, vikingConfig);
  registerResourceTools(server, vikingConfig);
  registerSessionTools(server, vikingConfig);

  return server;
}

const transports = new Map<string, StreamableHTTPServerTransport>();

const app = express();
app.use(express.json());

const mcpRouter = express.Router();
mcpRouter.use(createBearerAuthMiddleware(MCP_AUTH_TOKEN));

mcpRouter.post('/', async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      transports.set(sessionId, transport);
    },
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) transports.delete(sid);
  };

  // Check if this is a request for an existing session
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && transports.has(sessionId)) {
    const existingTransport = transports.get(sessionId)!;
    await existingTransport.handleRequest(req, res, req.body);
    return;
  }

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

mcpRouter.get('/', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: 'Invalid or missing session ID' });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

mcpRouter.delete('/', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: 'Invalid or missing session ID' });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
  transports.delete(sessionId);
});

app.use('/mcp', mcpRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const server = app.listen(MCP_PORT, MCP_HOST, () => {
  process.stderr.write(`viking-ts MCP server listening on ${MCP_HOST}:${MCP_PORT}\n`);
  process.stderr.write(`Viking-ts backend: ${VIKING_TS_URL}\n`);
});

function shutdown(): void {
  process.stderr.write('Shutting down MCP server...\n');
  for (const [, transport] of transports) {
    transport.close().catch(() => {});
  }
  transports.clear();
  server.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { app, createMcpServer };
