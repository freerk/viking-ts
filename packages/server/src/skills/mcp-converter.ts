export interface McpToolInput {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

export interface SkillInput {
  name: string;
  description: string;
  content: string;
  tags?: string[];
}

export function isMcpFormat(data: unknown): data is McpToolInput {
  return typeof data === 'object' && data !== null && 'inputSchema' in data;
}

export function mcpToSkill(mcp: McpToolInput): SkillInput {
  const name = (mcp.name ?? 'unnamed-tool').replace(/_/g, '-');
  const description = mcp.description ?? '';
  const inputSchema = mcp.inputSchema ?? {};

  const frontmatter = `---\nname: ${name}\ndescription: ${description}\n---\n\n`;

  const bodyParts: string[] = [`# ${name}\n\n`];
  if (description) bodyParts.push(`${description}\n`);

  const properties = inputSchema.properties ?? {};
  const required = inputSchema.required ?? [];
  const propEntries = Object.entries(properties);

  if (propEntries.length > 0) {
    bodyParts.push('\n## Parameters\n\n');
    for (const [paramName, paramInfo] of propEntries) {
      const paramType = paramInfo.type ?? 'any';
      const paramDesc = paramInfo.description ?? '';
      const isRequired = required.includes(paramName);
      const reqStr = isRequired ? ' (required)' : ' (optional)';
      bodyParts.push(`- **${paramName}** (${paramType})${reqStr}: ${paramDesc}\n`);
    }
  }

  bodyParts.push('\n## Usage\n\n');
  bodyParts.push(`This tool wraps the MCP tool \`${name}\`. `);
  bodyParts.push('Call this when the user needs functionality matching the description above.\n');

  const content = frontmatter + bodyParts.join('');
  return { name, description, content };
}
