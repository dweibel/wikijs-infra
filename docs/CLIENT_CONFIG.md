# Client Configuration Guide

## Overview

The Wiki REST API Gateway exposes HTTP/JSON endpoints authenticated via Bearer API keys. Clients connect either directly to port 3001 on the host or through a Cloudflare tunnel for external access.

Two access tiers are available:
- **Read-only** (`API_KEY_RO`): List pages, get pages, semantic search
- **Read-write** (`API_KEY_RW`): All read operations plus create, update, delete, move pages

## Connecting to the Gateway

Load API keys from `.env` before running any examples:

```bash
set -a && source .env && set +a
```

### Direct Access (same host or network)

```bash
# Health check (no auth)
curl http://localhost:3001/health

# Authenticated request
curl -H "Authorization: Bearer $API_KEY_RO" http://localhost:3001/api/pages
```

### Via Cloudflare Tunnel (external access)

```bash
curl -H "Authorization: Bearer $API_KEY_RO" https://wiki-api.yourdomain.com/api/pages
```

The Cloudflare tunnel provides TLS termination. Authentication is handled by the gateway itself via API keys — Cloudflare does not add or replace the gateway's auth.

## Usage Examples

### Read Operations (RO or RW key)

```bash
# List all pages
curl -H "Authorization: Bearer $API_KEY_RO" \
  http://localhost:3001/api/pages

# Get page by ID
curl -H "Authorization: Bearer $API_KEY_RO" \
  http://localhost:3001/api/pages/42

# Get page by path
curl -H "Authorization: Bearer $API_KEY_RO" \
  "http://localhost:3001/api/pages/by-path?path=/home"

# Semantic search
curl -X POST \
  -H "Authorization: Bearer $API_KEY_RO" \
  -H "Content-Type: application/json" \
  -d '{"query": "how to deploy applications", "top_k": 5}' \
  http://localhost:3001/api/search
```

### Write Operations (RW key only)

```bash
# Create a page
curl -X POST \
  -H "Authorization: Bearer $API_KEY_RW" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Getting Started",
    "path": "/guides/getting-started",
    "content": "# Getting Started\n\nWelcome to our wiki...",
    "description": "A guide for new users",
    "tags": ["guide", "tutorial"]
  }' \
  http://localhost:3001/api/pages

# Update a page
curl -X PUT \
  -H "Authorization: Bearer $API_KEY_RW" \
  -H "Content-Type: application/json" \
  -d '{"content": "# Updated content...", "tags": ["guide", "updated"]}' \
  http://localhost:3001/api/pages/42

# Move a page
curl -X POST \
  -H "Authorization: Bearer $API_KEY_RW" \
  -H "Content-Type: application/json" \
  -d '{"destination_path": "/guides/beginner/getting-started"}' \
  http://localhost:3001/api/pages/42/move

# Delete a page
curl -X DELETE \
  -H "Authorization: Bearer $API_KEY_RW" \
  http://localhost:3001/api/pages/42
```

## Programmatic Access

### Node.js / JavaScript

```javascript
const BASE_URL = 'http://localhost:3001';
const API_KEY = process.env.API_KEY_RO;

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

// List pages
const pages = await fetch(`${BASE_URL}/api/pages`, { headers }).then(r => r.json());

// Semantic search
const results = await fetch(`${BASE_URL}/api/search`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ query: 'deployment guide', top_k: 5 }),
}).then(r => r.json());

// Get page by ID
const page = await fetch(`${BASE_URL}/api/pages/42`, { headers }).then(r => r.json());
```

### Python

```python
import requests

BASE_URL = "http://localhost:3001"
HEADERS = {"Authorization": f"Bearer {API_KEY}"}

# List pages
pages = requests.get(f"{BASE_URL}/api/pages", headers=HEADERS).json()

# Semantic search
results = requests.post(
    f"{BASE_URL}/api/search",
    headers=HEADERS,
    json={"query": "deployment guide", "top_k": 5},
).json()

# Create page (requires RW key)
result = requests.post(
    f"{BASE_URL}/api/pages",
    headers={**HEADERS, "Authorization": f"Bearer {API_KEY_RW}"},
    json={"title": "New Page", "path": "/new-page", "content": "# Hello"},
).json()
```

## Integrating with AI Agents

The REST API can be called from any AI agent or tool that supports HTTP requests. Unlike the former MCP server, no special protocol or SDK is needed — standard HTTP clients work.

### From Goose (via wiki-cli)

The recommended way to access the wiki from Goose is via the `wiki-cli` tool, which is pre-installed in the Goose container. Goose invokes it as a shell command through its Developer extension, bypassing the stdio MCP transport entirely.

```bash
# Set required env vars
export WIKI_GATEWAY_API_KEY=$API_KEY_RO
export WIKI_GATEWAY_URL=http://localhost:3001

# For write operations, also set:
# export WIKI_GATEWAY_API_KEY=$API_KEY_RW
# export ENABLE_WRITE_OPS=true

# Search
wiki-cli search "kubernetes deployment"

# Get page
wiki-cli get --id 42
wiki-cli get --path "devops/kubernetes"

# List all pages
wiki-cli list

# Create page (requires ENABLE_WRITE_OPS=true and RW key)
wiki-cli create --title "New Page" --path "guides/new" --content "# Hello"

# Update page
wiki-cli update --id 42 --content "# Updated"

# Delete page
wiki-cli delete --id 42

# Move page
wiki-cli move --id 42 --destination "new/path"
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `WIKI_GATEWAY_API_KEY` | Yes | — | API key (RO or RW) |
| `WIKI_GATEWAY_URL` | No | `http://localhost:3001` | Gateway URL |
| `ENABLE_WRITE_OPS` | No | `false` | Set to `true` for create/update/delete/move |

All output is JSON to stdout, errors to stderr. See the [CLI Reference](./CLI.md) for full documentation.

### From Kiro / IDE Agents

Configure an MCP tool or custom HTTP tool to call the gateway endpoints. Example using a simple fetch wrapper:

```javascript
// Search wiki from an agent
async function searchWiki(query) {
  const res = await fetch('http://localhost:3001/api/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.WIKI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, top_k: 5 }),
  });
  return res.json();
}
```

### From Shell Scripts

```bash
#!/bin/bash
# Search and display results
curl -s -X POST \
  -H "Authorization: Bearer $API_KEY_RO" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"$1\", \"top_k\": 5}" \
  http://localhost:3001/api/search | jq '.[] | {title: .page_title, score: .relevance_score}'
```

## Security Best Practices

### API Key Management

1. Never commit API keys to git — use environment variables or secret managers
2. Use read-only keys by default; only use read-write keys when mutations are needed
3. Rotate keys periodically (every 90–180 days)
4. Use separate keys for different clients/environments

### Network Security

1. The gateway is the only port exposed from the Podman pod (3001)
2. Wiki.js (3000) and PostgreSQL (5432) are pod-internal only
3. Use Cloudflare tunnel for external access — no need to open firewall ports
4. Restrict OCI security list rules to known client IPs when possible

### Access Control

1. Grant read-only keys to search/retrieval clients
2. Reserve read-write keys for trusted automation that needs to create/modify content
3. Monitor gateway logs for unauthorized access attempts

## Obtaining a Wiki.js Admin Token

The `WIKI_ADMIN_TOKEN` is used internally by the gateway for write operations. It's not needed by API clients — clients authenticate with `API_KEY_RO` or `API_KEY_RW`.

To configure write operations on the server:

```bash
# Using the deployment script
eval $(./scripts/deploy-wikijs.sh get-token)

# Or manually via GraphQL
curl -s -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation($u:String!,$p:String!){authentication{login(username:$u,password:$p,strategy:\"local\"){jwt}}}",
    "variables": {"u": "admin@wiki.local", "p": "your-password"}
  }' | jq -r '.data.authentication.login.jwt'
```

## Troubleshooting

### 401 Unauthorized

- Verify the API key is correct: `echo $API_KEY_RO`
- Ensure the `Authorization` header uses `Bearer` scheme
- Check the key matches what was configured during deployment

### 403 Forbidden

- You're using a read-only key on a write endpoint
- Use `API_KEY_RW` for create/update/delete/move operations

### Connection Refused

- Verify the gateway is running: `podman ps | grep wikijs-gateway`
- Check the gateway port: default is 3001
- If using Cloudflare tunnel, check tunnel status: `podman logs cloudflared`

### 502 Bad Gateway (on search)

- Embedding generation failed — check OpenRouter API key validity
- Database connection issue — check PostgreSQL container status
- View gateway logs: `podman logs wikijs-gateway`

### Empty Search Results

- The sync pipeline may not have indexed content yet (runs every 5 minutes)
- Check embedding count: `podman exec wikijs-postgres psql -U wiki -d wiki -c "SELECT COUNT(*) FROM wiki_embeddings;"`
- Restart gateway to trigger immediate sync: `podman restart wikijs-gateway`

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEY_RO` | At least one key | — | Read-only API key |
| `API_KEY_RW` | At least one key | — | Read-write API key |
| `WIKI_ADMIN_TOKEN` | If `API_KEY_RW` set | — | Wiki.js admin JWT (server-side only) |
| `OPENROUTER_API_KEY` | Yes | — | OpenRouter API key for embeddings |
| `EMBEDDING_MODEL` | No | `openai/text-embedding-3-small` | Embedding model |
| `GATEWAY_PORT` | No | `3001` | Gateway listen port |
| `WIKI_BASE_URL` | No | `http://localhost:3000` | Wiki.js URL (pod-internal) |
| `PGHOST` | No | `localhost` | PostgreSQL host |
| `PGPORT` | No | `5432` | PostgreSQL port |
| `PGDATABASE` | No | `wiki` | PostgreSQL database |
| `PGUSER` | No | `wiki` | PostgreSQL user |
| `PGPASSWORD` | No | — | PostgreSQL password |
| `SYNC_INTERVAL_MS` | No | `300000` | Sync interval (ms) |

## Additional Resources

- [API Reference](./API.md) — complete endpoint documentation
- [CLI Reference](./CLI.md) — `wiki-cli` command reference and usage
- [Deployment Guide](./DEPLOYMENT.md) — deployment instructions
- [Testing Guide](./TESTING.md) — testing procedures
- [Wiki.js GraphQL API](./WIKI-API.md) — underlying API reference
