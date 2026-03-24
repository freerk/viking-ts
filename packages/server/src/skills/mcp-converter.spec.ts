import { isMcpFormat, mcpToSkill, McpToolInput } from './mcp-converter';

describe('mcp-converter', () => {
  describe('isMcpFormat', () => {
    it('should return true when inputSchema is present', () => {
      expect(isMcpFormat({ name: 'tool', inputSchema: { type: 'object' } })).toBe(true);
    });

    it('should return false for plain skill data', () => {
      expect(isMcpFormat({ name: 'skill', description: 'desc', content: 'c' })).toBe(false);
    });

    it('should return false for null', () => {
      expect(isMcpFormat(null)).toBe(false);
    });

    it('should return false for string', () => {
      expect(isMcpFormat('not an object')).toBe(false);
    });
  });

  describe('mcpToSkill', () => {
    it('should convert snake_case name to kebab-case', () => {
      const mcp: McpToolInput = { name: 'search_web', inputSchema: {} };
      const result = mcpToSkill(mcp);
      expect(result.name).toBe('search-web');
    });

    it('should use unnamed-tool when name is missing', () => {
      const mcp = { inputSchema: {} } as McpToolInput;
      const result = mcpToSkill(mcp);
      expect(result.name).toBe('unnamed-tool');
    });

    it('should generate YAML frontmatter', () => {
      const mcp: McpToolInput = { name: 'my_tool', description: 'Does stuff', inputSchema: {} };
      const result = mcpToSkill(mcp);
      expect(result.content).toContain('---\nname: my-tool\ndescription: Does stuff\n---');
    });

    it('should include parameters section with required annotations', () => {
      const mcp: McpToolInput = {
        name: 'fetch',
        description: 'Fetch a URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL to fetch' },
            timeout: { type: 'number', description: 'Timeout in ms' },
          },
          required: ['url'],
        },
      };

      const result = mcpToSkill(mcp);
      expect(result.content).toContain('**url** (string) (required): The URL to fetch');
      expect(result.content).toContain('**timeout** (number) (optional): Timeout in ms');
    });

    it('should omit parameters section when no properties', () => {
      const mcp: McpToolInput = { name: 'ping', description: 'Ping', inputSchema: {} };
      const result = mcpToSkill(mcp);
      expect(result.content).not.toContain('## Parameters');
    });

    it('should include usage section referencing the tool name', () => {
      const mcp: McpToolInput = { name: 'search_web', inputSchema: {} };
      const result = mcpToSkill(mcp);
      expect(result.content).toContain('## Usage');
      expect(result.content).toContain('MCP tool `search-web`');
    });

    it('should set description from MCP description', () => {
      const mcp: McpToolInput = { name: 'tool', description: 'A great tool', inputSchema: {} };
      const result = mcpToSkill(mcp);
      expect(result.description).toBe('A great tool');
    });

    it('should default description to empty string', () => {
      const mcp: McpToolInput = { name: 'tool', inputSchema: {} };
      const result = mcpToSkill(mcp);
      expect(result.description).toBe('');
    });
  });
});
