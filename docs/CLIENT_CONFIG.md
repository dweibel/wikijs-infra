# Client Configuration Guide

## Overview

The Wiki MCP Server is accessible via two deployment modes with different access levels:

- **Read-Only Mode**: Search and retrieve wiki content (default)
- **Read-Write Mode**: Full CRUD operations on wiki pages (requires admin token)

When deployed with Cloudflare Zero Trust, two separate endpoints can be configured:
- **Read-Only Endpoint**: `https://wiki-search.dirkweibel.dev` (search and retrieve)
- **Admin Endpoint**: `https://wiki-admin.dirkweibel.dev` (full CRUD access)

## Read-Only Client Configuration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wiki-search": {
      "command": "node",
      "args": ["/path/to/wiki-mcp-server/src/index.js"],
      "env": {
        "WIKI_BASE_URL": "http://localhost:3000",
        "PGHOST": "localhost",
        "PGPORT": "5432",
        "PGDATABASE": "wiki",
        "PGUSER": "wiki",
        "PGPASSWORD": "your-password",
        "OPENROUTER_API_KEY": "sk-or-v1-your-key",
        "ENABLE_WRITE_OPERATIONS": "false"
      }
    }
  }
}
```

### Via Cloudflare Tunnel (with Service Token)

```json
{
  "mcpServers": {
    "wiki-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/client-stdio"],
      "env": {
        "MCP_SERVER_URL": "https://wiki-search.dirkweibel.dev",
        "CF_ACCESS_CLIENT_ID": "your-read-only-client-id",
        "CF_ACCESS_CLIENT_SECRET": "your-read-only-client-secret"
      }
    }
  }
}
```

### Available Tools

- `search_wiki` - Semantic search across wiki content
- `get_wiki_page` - Retrieve full page content by ID or path

### Example Usage

```javascript
// Search for content
const results = await search_wiki({
  query: "how to deploy applications",
  top_k: 5
});

// Get specific page by path
const page = await get_wiki_page({
  path: "/guides/deployment"
});

// Get specific page by ID
const page = await get_wiki_page({
  page_id: 42
});
```

## Read-Write Client Configuration

### Claude Desktop (Local)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wiki-admin": {
      "command": "node",
      "args": ["/path/to/wiki-mcp-server/src/index.js"],
      "env": {
        "WIKI_BASE_URL": "http://localhost:3000",
        "PGHOST": "localhost",
        "PGPORT": "5432",
        "PGDATABASE": "wiki",
        "PGUSER": "wiki",
        "PGPASSWORD": "your-password",
        "OPENROUTER_API_KEY": "sk-or-v1-your-key",
        "ENABLE_WRITE_OPERATIONS": "true",
        "WIKI_ADMIN_TOKEN": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
      }
    }
  }
}
```

### Via Cloudflare Tunnel (with Admin Service Token)

```json
{
  "mcpServers": {
    "wiki-admin": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/client-stdio"],
      "env": {
        "MCP_SERVER_URL": "https://wiki-admin.dirkweibel.dev",
        "CF_ACCESS_CLIENT_ID": "your-admin-client-id",
        "CF_ACCESS_CLIENT_SECRET": "your-admin-client-secret"
      }
    }
  }
}
```

### Available Tools

All read-only tools plus:

- `create_wiki_page` - Create new pages
- `update_wiki_page` - Update existing pages
- `delete_wiki_page` - Delete pages
- `move_wiki_page` - Move/rename pages

### Example Usage

```javascript
// Create a new page
const result = await create_wiki_page({
  title: "New Deployment Guide",
  path: "/guides/new-deployment",
  content: "# New Deployment Guide\n\nThis guide covers...",
  description: "Guide for deploying new applications",
  tags: ["guide", "deployment", "tutorial"],
  is_published: true,
  is_private: false
});

console.log(`Created page ${result.page_id} at ${result.path}`);

// Update existing page
await update_wiki_page({
  page_id: result.page_id,
  content: "# Updated Deployment Guide\n\nThis updated guide covers...",
  tags: ["guide", "deployment", "tutorial", "updated"]
});

// Move page to new location
await move_wiki_page({
  page_id: result.page_id,
  destination_path: "/guides/deployment/new-deployment"
});

// Delete page
await delete_wiki_page({
  page_id: result.page_id
});
```

## Other MCP Clients

### Cline (VS Code Extension)

Add to VS Code settings (`settings.json`):

```json
{
  "cline.mcpServers": {
    "wiki-search": {
      "command": "node",
      "args": ["/path/to/wiki-mcp-server/src/index.js"],
      "env": {
        "WIKI_BASE_URL": "http://localhost:3000",
        "PGHOST": "localhost",
        "PGDATABASE": "wiki",
        "PGUSER": "wiki",
        "PGPASSWORD": "your-password",
        "OPENROUTER_API_KEY": "sk-or-v1-your-key"
      }
    }
  }
}
```

### Custom MCP Client

```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/path/to/wiki-mcp-server/src/index.js'],
  env: {
    WIKI_BASE_URL: 'http://localhost:3000',
    PGHOST: 'localhost',
    PGDATABASE: 'wiki',
    PGUSER: 'wiki',
    PGPASSWORD: 'your-password',
    OPENROUTER_API_KEY: 'sk-or-v1-your-key',
    ENABLE_WRITE_OPERATIONS: 'false'
  }
});

const client = new Client({
  name: 'wiki-client',
  version: '1.0.0'
}, {
  capabilities: {}
});

await client.connect(transport);

// Use tools
const result = await client.callTool({
  name: 'search_wiki',
  arguments: {
    query: 'deployment guide',
    top_k: 5
  }
});
```

## Obtaining Service Tokens (Cloudflare)

If using Cloudflare Zero Trust:

1. Log into Cloudflare dashboard
2. Navigate to: Zero Trust > Access > Service Auth
3. Create service token:
   - **Read-Only Token**: Name it "Wiki Search - Read Only"
   - **Admin Token**: Name it "Wiki Admin - Read Write"
4. Copy Client ID and Client Secret
5. Store securely (never commit to git)

See [CLOUDFLARE_SETUP.md](./CLOUDFLARE_SETUP.md) for detailed instructions.

## Obtaining Wiki.js Admin Token

Required for read-write mode:

### Method 1: Using Deployment Script

```bash
cd ~/deploy
eval $(./scripts/deploy-wikijs.sh get-token)
echo $WIKI_ADMIN_TOKEN
```

### Method 2: Manual via GraphQL

```bash
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation($u:String!,$p:String!){authentication{login(username:$u,password:$p,strategy:\"local\"){jwt}}}",
    "variables": {"u": "admin@wiki.local", "p": "your-password"}
  }' | jq -r '.data.authentication.login.jwt'
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for more details.

## Security Best Practices

### Token Management

1. **Never commit tokens to git**
   - Use environment variables
   - Store in secure credential managers
   - Use `.gitignore` for config files

2. **Rotate tokens regularly**
   - Admin tokens: Every 90 days
   - Service tokens: Every 180 days
   - Immediately after suspected compromise

3. **Use read-only tokens by default**
   - Only use admin tokens when write operations needed
   - Separate clients for read-only vs admin access
   - Monitor admin token usage

### Access Control

1. **Restrict admin access**
   - Only trusted systems/users
   - Use IP restrictions when possible
   - Monitor audit logs

2. **Use Cloudflare Zero Trust**
   - Service tokens for machine-to-machine
   - Access policies for fine-grained control
   - Audit logging for compliance

3. **Network security**
   - Deploy behind firewall
   - Use HTTPS in production
   - Restrict MCP server port access

### Monitoring

1. **Log all operations**
   - Enable MCP server logging
   - Monitor Wiki.js audit logs
   - Track Cloudflare Access logs

2. **Set up alerts**
   - Failed authentication attempts
   - Unusual write operation patterns
   - High error rates

3. **Regular audits**
   - Review access logs monthly
   - Check for unauthorized access
   - Verify token usage patterns

## Troubleshooting

### Authentication Failures

**Symptom**: 403 Forbidden or authentication errors

**Solutions**:
1. Verify service token is correct:
   ```bash
   echo $CF_ACCESS_CLIENT_ID
   echo $CF_ACCESS_CLIENT_SECRET
   ```

2. Check token hasn't expired:
   - Cloudflare service tokens don't expire by default
   - Wiki.js JWT tokens expire after 30 days

3. Verify hostname matches policy:
   - Read-only: `wiki-search.dirkweibel.dev`
   - Admin: `wiki-admin.dirkweibel.dev`

4. Check Cloudflare Access logs for details

### Connection Timeouts

**Symptom**: Request timeouts or connection refused

**Solutions**:
1. Verify MCP server is running:
   ```bash
   podman ps | grep wiki-mcp-server
   ```

2. Check Cloudflare tunnel status:
   ```bash
   podman logs cloudflared
   ```

3. Verify network connectivity:
   ```bash
   curl https://wiki-search.dirkweibel.dev/health
   ```

4. Check firewall rules

### Tool Not Found

**Symptom**: "Tool not available" errors

**Solutions**:
1. **Read-only endpoint**: Only `search_wiki` and `get_wiki_page` available
2. **Admin endpoint**: All 6 tools available
3. Verify `ENABLE_WRITE_OPERATIONS=true` on server:
   ```bash
   podman exec wiki-mcp-server env | grep ENABLE_WRITE_OPERATIONS
   ```

### Write Operations Failing

**Symptom**: create/update/delete operations return errors

**Solutions**:
1. Verify admin token is set:
   ```bash
   podman exec wiki-mcp-server env | grep WIKI_ADMIN_TOKEN
   ```

2. Check token validity:
   ```bash
   curl http://localhost:3000/graphql \
     -H "Authorization: Bearer $WIKI_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"query":"{pages{list{id}}}"}'
   ```

3. Regenerate token if expired:
   ```bash
   eval $(./scripts/deploy-wikijs.sh get-token)
   ```

### Slow Search Performance

**Symptom**: Search queries take >5 seconds

**Solutions**:
1. Check database connection:
   ```bash
   podman exec wikijs-postgres pg_isready -U wiki
   ```

2. Verify embedding count:
   ```bash
   podman exec wikijs-postgres psql -U wiki -d wiki \
     -c "SELECT COUNT(*) FROM wiki_embeddings;"
   ```

3. Check for database locks:
   ```bash
   podman exec wikijs-postgres psql -U wiki -d wiki \
     -c "SELECT * FROM pg_stat_activity WHERE state = 'active';"
   ```

4. Consider database tuning for large wikis (>10,000 pages)

## Configuration Examples

### Development Environment

```json
{
  "mcpServers": {
    "wiki-dev": {
      "command": "node",
      "args": ["./src/index.js"],
      "env": {
        "WIKI_BASE_URL": "http://localhost:3000",
        "PGHOST": "localhost",
        "PGDATABASE": "wiki",
        "PGUSER": "wiki",
        "PGPASSWORD": "dev-password",
        "OPENROUTER_API_KEY": "sk-or-v1-dev-key",
        "ENABLE_WRITE_OPERATIONS": "true",
        "WIKI_ADMIN_TOKEN": "dev-token",
        "SYNC_INTERVAL_MS": "60000"
      }
    }
  }
}
```

### Production (Read-Only)

```json
{
  "mcpServers": {
    "wiki-prod": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/client-stdio"],
      "env": {
        "MCP_SERVER_URL": "https://wiki-search.company.com",
        "CF_ACCESS_CLIENT_ID": "prod-read-client-id",
        "CF_ACCESS_CLIENT_SECRET": "prod-read-client-secret"
      }
    }
  }
}
```

### Production (Admin)

```json
{
  "mcpServers": {
    "wiki-admin-prod": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/client-stdio"],
      "env": {
        "MCP_SERVER_URL": "https://wiki-admin.company.com",
        "CF_ACCESS_CLIENT_ID": "prod-admin-client-id",
        "CF_ACCESS_CLIENT_SECRET": "prod-admin-client-secret"
      }
    }
  }
}
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WIKI_BASE_URL` | Yes | `http://localhost:3000` | Wiki.js base URL |
| `PGHOST` | Yes | `localhost` | PostgreSQL host |
| `PGPORT` | No | `5432` | PostgreSQL port |
| `PGDATABASE` | Yes | `wiki` | PostgreSQL database |
| `PGUSER` | Yes | `wiki` | PostgreSQL username |
| `PGPASSWORD` | Yes | - | PostgreSQL password |
| `OPENROUTER_API_KEY` | Yes | - | OpenRouter API key |
| `EMBEDDING_MODEL` | No | `openai/text-embedding-3-small` | Embedding model |
| `OPENROUTER_BASE_URL` | No | `https://openrouter.ai/api/v1` | OpenRouter API URL |
| `ENABLE_WRITE_OPERATIONS` | No | `false` | Enable write tools |
| `WIKI_ADMIN_TOKEN` | Conditional* | - | Wiki.js admin JWT |
| `SYNC_INTERVAL_MS` | No | `300000` | Sync interval (5 min) |
| `CF_ACCESS_CLIENT_ID` | Conditional** | - | Cloudflare service token ID |
| `CF_ACCESS_CLIENT_SECRET` | Conditional** | - | Cloudflare service token secret |

*Required when `ENABLE_WRITE_OPERATIONS=true`  
**Required when using Cloudflare tunnel

## Support

For issues or questions:

1. Check server logs: `podman logs wiki-mcp-server`
2. Review [DEPLOYMENT.md](./DEPLOYMENT.md) troubleshooting section
3. Consult [API.md](./API.md) for tool documentation
4. Check [CLOUDFLARE_SETUP.md](./CLOUDFLARE_SETUP.md) for Cloudflare issues
5. Review [TESTING.md](./TESTING.md) for testing guidance

## Additional Resources

- [API Documentation](./API.md) - Complete API reference
- [Deployment Guide](./DEPLOYMENT.md) - Deployment instructions
- [Testing Guide](./TESTING.md) - Testing procedures
- [Cloudflare Setup](./CLOUDFLARE_SETUP.md) - Cloudflare Zero Trust configuration
- [Wiki.js GraphQL API](./WIKI-GRAPHQL-API.md) - Underlying API reference
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification
