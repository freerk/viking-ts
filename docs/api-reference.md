# API Reference

Base URL: `http://localhost:1934`

Interactive Swagger docs: `http://localhost:1934/docs`

All responses use the envelope format:

```json
{
  "status": "ok",
  "result": "<payload>",
  "time": 0.042
}
```

Error responses:

```json
{
  "status": "error",
  "error": { "code": "NOT_FOUND", "message": "Memory not found" },
  "time": 0.001
}
```

---

## Health

### GET /health

Returns server status and version.

```bash
curl http://localhost:1934/health
```

```json
{ "status": "ok", "version": "0.1.0" }
```

---

## Memories

### POST /api/v1/memories

Create a memory.

**Request body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | Memory content (max 10,000 chars) |
| `category` | enum | Yes | One of: `profile`, `preferences`, `entities`, `events`, `cases`, `patterns`, `general` |
| `type` | enum | No | `user` (default) or `agent` |
| `agentId` | string | No | Agent identifier |
| `userId` | string | No | User identifier |
| `uri` | string | No | Custom Viking URI (auto-generated if omitted) |

```bash
curl -X POST http://localhost:1934/api/v1/memories \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "User prefers dark mode and monospace fonts",
    "category": "preferences",
    "agentId": "simon"
  }'
```

```json
{
  "status": "ok",
  "result": {
    "id": "a1b2c3d4-...",
    "text": "User prefers dark mode and monospace fonts",
    "type": "user",
    "category": "preferences",
    "agentId": "simon",
    "userId": null,
    "uri": "viking://user/memories/preferences/a1b2c3d4-...",
    "l0Abstract": "User has a preference for dark mode interfaces and monospace typography.",
    "l1Overview": "## Preferences\n- Dark mode UI\n- Monospace fonts",
    "l2Content": "User prefers dark mode and monospace fonts",
    "createdAt": "2026-03-21T10:00:00.000Z",
    "updatedAt": "2026-03-21T10:00:00.000Z"
  },
  "time": 1.234
}
```

### GET /api/v1/memories/search

Semantic search across memories.

**Query parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | (required) | Search query |
| `limit` | number | 6 | Max results (1-100) |
| `scoreThreshold` | number | 0.01 | Minimum similarity score (0-1) |
| `uri` | string | (none) | Filter by URI prefix |

```bash
curl 'http://localhost:1934/api/v1/memories/search?q=UI+preferences&limit=3'
```

```json
{
  "status": "ok",
  "result": [
    {
      "id": "a1b2c3d4-...",
      "uri": "viking://user/memories/preferences/a1b2c3d4-...",
      "text": "User prefers dark mode and monospace fonts",
      "score": 0.89,
      "l0Abstract": "User has a preference for dark mode interfaces and monospace typography.",
      "category": "preferences",
      "type": "user"
    }
  ],
  "time": 0.156
}
```

### GET /api/v1/memories

List memories with optional filters.

**Query parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `agentId` | string | (none) | Filter by agent |
| `userId` | string | (none) | Filter by user |
| `type` | enum | (none) | Filter by type (`user` or `agent`) |
| `category` | enum | (none) | Filter by category |
| `limit` | number | 100 | Max results (1-1000) |
| `offset` | number | 0 | Pagination offset |

```bash
curl 'http://localhost:1934/api/v1/memories?agentId=simon&category=preferences&limit=10'
```

```json
{
  "status": "ok",
  "result": [
    {
      "id": "a1b2c3d4-...",
      "text": "User prefers dark mode and monospace fonts",
      "type": "user",
      "category": "preferences",
      "agentId": "simon",
      "userId": null,
      "uri": "viking://user/memories/preferences/a1b2c3d4-...",
      "l0Abstract": "...",
      "l1Overview": "...",
      "l2Content": "...",
      "createdAt": "2026-03-21T10:00:00.000Z",
      "updatedAt": "2026-03-21T10:00:00.000Z"
    }
  ],
  "time": 0.012
}
```

### GET /api/v1/memories/:id

Get a single memory by ID.

```bash
curl http://localhost:1934/api/v1/memories/a1b2c3d4-...
```

### DELETE /api/v1/memories/:id

Delete a memory.

```bash
curl -X DELETE http://localhost:1934/api/v1/memories/a1b2c3d4-...
```

```json
{
  "status": "ok",
  "result": { "deleted": true },
  "time": 0.008
}
```

---

## Sessions

### POST /api/v1/sessions/capture

Ingest a conversation and automatically extract memories using the LLM.

**Request body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | array | Yes | Conversation messages |
| `messages[].role` | enum | Yes | `user` or `assistant` |
| `messages[].content` | string | Yes | Message text |
| `agentId` | string | No | Agent identifier |
| `userId` | string | No | User identifier |

```bash
curl -X POST http://localhost:1934/api/v1/sessions/capture \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [
      {"role": "user", "content": "I work at Acme Corp as a backend engineer. We use Go and PostgreSQL."},
      {"role": "assistant", "content": "Got it! You are a backend engineer at Acme Corp working with Go and PostgreSQL."},
      {"role": "user", "content": "Yes, and I prefer vim keybindings in my editor."}
    ],
    "agentId": "simon"
  }'
```

```json
{
  "status": "ok",
  "result": {
    "memoriesExtracted": 3,
    "memories": [
      {
        "id": "...",
        "text": "User works at Acme Corp as a backend engineer",
        "category": "profile",
        "type": "user",
        "agentId": "simon",
        "uri": "viking://user/memories/profile/...",
        "l0Abstract": "...",
        "l1Overview": "...",
        "l2Content": "...",
        "createdAt": "...",
        "updatedAt": "..."
      }
    ]
  },
  "time": 3.456
}
```

---

## Resources

### POST /api/v1/resources

Create a resource. Provide either `text` (inline content) or `url` (fetch later).

**Request body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Resource title |
| `text` | string | No | Resource content (max 50,000 chars). Required if no `url`. |
| `url` | string | No | Source URL (max 2,000 chars). Required if no `text`. |
| `uri` | string | No | Custom Viking URI |

```bash
curl -X POST http://localhost:1934/api/v1/resources \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "TypeScript strict mode guide",
    "text": "Enable strict mode in tsconfig.json with \"strict\": true. This enables strictNullChecks, noImplicitAny, and other checks.",
    "uri": "viking://resources/guides/typescript-strict.md"
  }'
```

```json
{
  "status": "ok",
  "result": {
    "id": "...",
    "title": "TypeScript strict mode guide",
    "uri": "viking://resources/guides/typescript-strict.md",
    "sourceUrl": null,
    "l0Abstract": "...",
    "l1Overview": "...",
    "l2Content": "Enable strict mode in tsconfig.json...",
    "createdAt": "...",
    "updatedAt": "..."
  },
  "time": 1.789
}
```

### GET /api/v1/resources/search

Semantic search across resources.

**Query parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | (required) | Search query |
| `limit` | number | 10 | Max results (1-100) |
| `scoreThreshold` | number | 0.01 | Minimum similarity score (0-1) |

```bash
curl 'http://localhost:1934/api/v1/resources/search?q=typescript+configuration&limit=5'
```

### GET /api/v1/resources

List all resources.

```bash
curl http://localhost:1934/api/v1/resources
```

### GET /api/v1/resources/:id

Get a single resource by ID.

```bash
curl http://localhost:1934/api/v1/resources/abc123-...
```

### DELETE /api/v1/resources/:id

Delete a resource.

```bash
curl -X DELETE http://localhost:1934/api/v1/resources/abc123-...
```

---

## Skills

### POST /api/v1/skills

Create a skill (returns HTTP 201).

**Request body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Skill name |
| `description` | string | Yes | Skill description |
| `content` | string | Yes | Full skill content (max 50,000 chars) |
| `tags` | string[] | No | Categorization tags |

```bash
curl -X POST http://localhost:1934/api/v1/skills \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "code-review",
    "description": "Expert code review with focus on TypeScript patterns",
    "content": "# Code Review Skill\n\nWhen reviewing code, focus on...",
    "tags": ["typescript", "quality"]
  }'
```

```json
{
  "status": "ok",
  "result": {
    "id": "...",
    "name": "code-review",
    "description": "Expert code review with focus on TypeScript patterns",
    "uri": "viking://agent/skills/code-review/",
    "tags": ["typescript", "quality"],
    "l0Abstract": "...",
    "l1Overview": "...",
    "l2Content": "# Code Review Skill\n\nWhen reviewing code, focus on...",
    "createdAt": "...",
    "updatedAt": "..."
  },
  "time": 1.567
}
```

### GET /api/v1/skills/search

Semantic search across skills.

**Query parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | (required) | Search query |
| `limit` | number | 10 | Max results (1-100) |
| `scoreThreshold` | number | 0.01 | Minimum similarity score (0-1) |

```bash
curl 'http://localhost:1934/api/v1/skills/search?q=code+quality&limit=5'
```

### GET /api/v1/skills

List skills with optional tag filter.

**Query parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 100 | Max results (1-1000) |
| `offset` | number | 0 | Pagination offset |
| `tag` | string | (none) | Filter by tag |

```bash
curl 'http://localhost:1934/api/v1/skills?tag=typescript'
```

### GET /api/v1/skills/:id

Get a single skill by ID.

```bash
curl http://localhost:1934/api/v1/skills/abc123-...
```

### DELETE /api/v1/skills/:id

Delete a skill (returns HTTP 204, no body).

```bash
curl -X DELETE http://localhost:1934/api/v1/skills/abc123-...
```

---

## Viking URI Navigation

### GET /api/v1/ls

List direct children at a Viking URI.

**Query parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `uri` | string | Yes | Viking URI to list (e.g. `viking://agent/`) |

```bash
curl 'http://localhost:1934/api/v1/ls?uri=viking://agent/'
```

```json
{
  "status": "ok",
  "result": {
    "uri": "viking://agent/",
    "children": [
      "viking://agent/memories/",
      "viking://agent/skills/"
    ]
  },
  "time": 0.005
}
```

### GET /api/v1/tree

Recursive tree view of a Viking URI namespace.

**Query parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `uri` | string | (required) | Root URI for tree |
| `depth` | number | 2 | Max recursion depth |

```bash
curl 'http://localhost:1934/api/v1/tree?uri=viking://agent/&depth=3'
```

```json
{
  "status": "ok",
  "result": {
    "uri": "viking://agent/",
    "name": "agent",
    "type": "directory",
    "children": [
      {
        "uri": "viking://agent/memories/",
        "name": "memories",
        "type": "directory",
        "children": [
          {
            "uri": "viking://agent/memories/identity/",
            "name": "identity",
            "type": "directory",
            "children": [
              {
                "uri": "viking://agent/memories/identity/SOUL.md",
                "name": "SOUL.md",
                "type": "file"
              }
            ]
          }
        ]
      },
      {
        "uri": "viking://agent/skills/",
        "name": "skills",
        "type": "directory",
        "children": []
      }
    ]
  },
  "time": 0.023
}
```

---

## Authentication

The API supports an optional `X-API-Key` header. This is documented in the Swagger spec but not enforced by default. To add authentication, configure it at the reverse proxy level or implement a NestJS guard.

## Rate limits

No built-in rate limiting. For production use, add rate limiting at the reverse proxy level (nginx, Caddy, Cloudflare Tunnel).

## Error codes

| HTTP Status | Meaning |
|-------------|---------|
| 200 | Success |
| 201 | Created (POST /api/v1/skills) |
| 204 | No Content (DELETE /api/v1/skills/:id) |
| 400 | Bad Request (validation failure, missing required params) |
| 404 | Not Found |
| 500 | Internal Server Error |
