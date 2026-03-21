describe('MCP server startup', () => {
  const originalEnv = process.env;
  const originalExit = process.exit;
  const originalStderrWrite = process.stderr.write;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exit = originalExit;
    process.stderr.write = originalStderrWrite;
  });

  it('should refuse to start without MCP_AUTH_TOKEN', () => {
    delete process.env['MCP_AUTH_TOKEN'];
    let exitCode: number | undefined;
    let stderrOutput = '';

    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error('process.exit called');
    }) as never;

    process.stderr.write = ((chunk: string) => {
      stderrOutput += chunk;
      return true;
    }) as typeof process.stderr.write;

    expect(() => require('./index')).toThrow('process.exit called');
    expect(exitCode).toBe(1);
    expect(stderrOutput).toContain('MCP_AUTH_TOKEN');
  });
});

describe('createMcpServer', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should register all expected tools', async () => {
    process.env['MCP_AUTH_TOKEN'] = 'test-token-for-tests';

    // Mock express to avoid actually listening
    const express = require('express');
    const mockServer = { close: jest.fn() };
    const mockApp = express();
    jest.spyOn(mockApp, 'listen').mockReturnValue(mockServer);

    jest.doMock('express', () => {
      const fn = () => mockApp;
      fn.json = express.json;
      fn.Router = express.Router;
      return fn;
    });

    const { createMcpServer } = require('./index');
    const server = createMcpServer();

    // Access the private _registeredTools object to verify tool registration
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registeredTools = (server as any)._registeredTools as Record<string, unknown>;
    const toolNames = Object.keys(registeredTools).sort();

    expect(toolNames).toEqual([
      'add_memory',
      'add_resource',
      'capture_session',
      'list_memories',
      'list_resources',
      'search_memories',
      'search_resources',
    ]);

    mockServer.close();
  });
});
