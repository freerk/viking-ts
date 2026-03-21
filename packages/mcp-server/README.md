# @viking-ts/mcp-server

MCP (Model Context Protocol) server that exposes viking-ts memory, resource, and session capabilities over Streamable HTTP. Designed for integration with claude.ai and other MCP-compatible clients.

## Setup

```bash
# Install dependencies
npm install

# Build
npm run build

# Set required environment variable
export MCP_AUTH_TOKEN="your-secure-random-token"

# Start (production)
npm start

# Start (development)
npm run dev
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MCP_AUTH_TOKEN` | Yes | (none, server refuses to start without it) | Bearer token for authenticating MCP clients |
| `VIKING_TS_URL` | No | `http://127.0.0.1:1934` | Base URL of the viking-ts server |
| `MCP_PORT` | No | `3001` | Port the MCP server listens on |
| `MCP_HOST` | No | `0.0.0.0` | Host/interface to bind to |

## Available tools

| Tool | Description |
|---|---|
| `search_memories` | Semantic search over stored memories |
| `add_memory` | Store a new memory with auto-generated abstracts |
| `list_memories` | List memories, optionally filtered by agent |
| `search_resources` | Semantic search over stored resources |
| `add_resource` | Store a new resource (document, file, note) |
| `list_resources` | List all stored resources |
| `capture_session` | Ingest a conversation and auto-extract memories |

## Adding to claude.ai

In your claude.ai MCP settings, add a remote server:

```json
{
  "mcpServers": {
    "viking-ts": {
      "type": "url",
      "url": "https://your-domain.com/mcp",
      "headers": {
        "Authorization": "Bearer your-secure-random-token"
      }
    }
  }
}
```

Replace `your-domain.com` with your server's public hostname and `your-secure-random-token` with your `MCP_AUTH_TOKEN` value.

## Security notes

- **Always use TLS in production.** Place a reverse proxy (nginx, Caddy, Cloudflare Tunnel) in front of this server to terminate TLS.
- **Never expose the viking-ts server (port 1934) directly to the internet.** Only this MCP server should be public-facing.
- **Rotate tokens regularly.** Generate a new `MCP_AUTH_TOKEN`, update your claude.ai config, then restart the server.
- **Restrict network access.** Use firewall rules to ensure only the MCP server can reach viking-ts on port 1934.
- The bearer token comparison uses `crypto.timingSafeEqual` to prevent timing attacks.

## Architecture

```
claude.ai / MCP client
       |
       | HTTPS + Bearer token
       v
  MCP Server (port 3001)    <-- this package
       |
       | HTTP (localhost only)
       v
  viking-ts (port 1934)     <-- packages/server
```
