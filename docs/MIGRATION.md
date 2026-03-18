# Migration Guide: agent-infra to wikijs-infra

This guide covers migrating from an existing Wiki.js deployment in agent-infra to the dedicated wikijs-infra repository.

## Overview

The wikijs-infra repository is a standalone repository for Wiki.js infrastructure. The service has been converted from an MCP (Model Context Protocol) server to a REST API gateway — clients now use plain HTTP/JSON endpoints with API key authentication instead of the MCP protocol over stdio.

Key changes from agent-infra:
- Transport: MCP over stdio → REST API over HTTP (Express)
- Authentication: None / Cloudflare Zero Trust → API key Bearer tokens (two-tier: RO/RW)
- Network: Wiki.js port 3000 exposed → only gateway port 3001 exposed
- Container name: `wikijs-mcp` → `wikijs-gateway`

## Prerequisites

- Existing Wiki.js deployment from agent-infra
- SSH access to the OCI instance
- Podman installed on target system

## Migration Steps

### 1. Export Existing Data

```bash
ssh -i ~/.ssh/oci_agent_coder opc@<instance-ip>

# Export Wiki.js database
podman exec wikijs-postgres pg_dump -U wiki -d wiki > ~/wiki-backup.sql

# Export embeddings
podman exec wikijs-postgres pg_dump -U wiki -d wiki -t wiki_embeddings | gzip > ~/embeddings-backup.sql.gz
```

### 2. Stop Existing Deployment

```bash
# From agent-infra
./scripts/deploy-wikijs.sh stop
./scripts/deploy-wikijs.sh destroy
```

### 3. Clone and Configure wikijs-infra

```bash
git clone <wikijs-infra-repo-url>
cd wikijs-infra
cp .env.example .env
# Edit .env with your values
```

### 4. Deploy New Stack

```bash
source .env
API_KEY_RO=my-read-key \
OPENROUTER_API_KEY=$OPENROUTER_API_KEY \
./scripts/deploy-wikijs.sh deploy
```

### 5. Restore Data

```bash
scp -i ~/.ssh/oci_agent_coder ~/wiki-backup.sql opc@<instance-ip>:~/
ssh -i ~/.ssh/oci_agent_coder opc@<instance-ip>
podman exec -i wikijs-postgres psql -U wiki -d wiki < ~/wiki-backup.sql
```

### 6. Restore Embeddings

```bash
scp -i ~/.ssh/oci_agent_coder ~/embeddings-backup.sql.gz opc@<instance-ip>:~/
ssh -i ~/.ssh/oci_agent_coder opc@<instance-ip>
gunzip -c ~/embeddings-backup.sql.gz | podman exec -i wikijs-postgres psql -U wiki -d wiki
```

### 7. Verify

```bash
# Health check
curl http://<instance-ip>:3001/health

# Test authenticated access
curl -H "Authorization: Bearer $API_KEY_RO" http://<instance-ip>:3001/api/pages

# Run smoke test
./scripts/smoke-test-wikijs.sh <instance-ip>
```

## Client Migration

Clients that previously used the MCP protocol need to switch to HTTP/JSON:

**Before (MCP client):**
```json
{
  "mcpServers": {
    "wiki": {
      "command": "node",
      "args": ["src/index.js"],
      "env": { "PGHOST": "...", "OPENROUTER_API_KEY": "..." }
    }
  }
}
```

**After (HTTP client):**
```bash
# Search
curl -X POST -H "Authorization: Bearer $API_KEY_RO" \
  -H "Content-Type: application/json" \
  -d '{"query": "search term", "top_k": 5}' \
  http://localhost:3001/api/search

# Get page
curl -H "Authorization: Bearer $API_KEY_RO" http://localhost:3001/api/pages/42
```

No special SDK or protocol is needed — any HTTP client works.

## Backward Compatibility

The underlying data is fully compatible:
- Same database schema (`wiki_embeddings` table)
- Same embedding model (OpenRouter text-embedding-3-small)
- Same Wiki.js GraphQL API usage internally

What changed:
- Client-facing protocol (MCP → REST)
- Authentication mechanism (none → API keys)
- Container name (`wikijs-mcp` → `wikijs-gateway`)
- Port exposure (3000+3001 → 3001 only)

## Rollback

If you need to rollback to agent-infra:

```bash
cd wikijs-infra
./scripts/deploy-wikijs.sh destroy

cd agent-infra
./scripts/deploy-wikijs.sh deploy
```

Restore backups if needed.

## Support

- [API Reference](API.md)
- [Deployment Guide](DEPLOYMENT.md)
- [Testing Guide](TESTING.md)
- [Client Configuration](CLIENT_CONFIG.md)
