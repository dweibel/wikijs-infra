# Wiki MCP Server Deployment Guide

## Overview

This guide covers deploying the Wiki MCP Server with OpenRouter embeddings and optional write operations support.

## Prerequisites

- OCI VM.Standard.A1.Flex instance (ARM64)
- Podman installed
- OpenRouter API key from https://openrouter.ai/
- Wiki.js admin credentials

## Quick Start

### Read-Only Deployment (Recommended)

Deploy with search and retrieval only:

```bash
cd ~/deploy
OPENROUTER_API_KEY=sk-or-v1-your-key-here ./scripts/deploy-wikijs.sh deploy
```

This provides:
- `search_wiki` - Semantic search across wiki content
- `get_wiki_page` - Retrieve page content by ID or path

### Read-Write Deployment

Deploy with full CRUD operations:

```bash
# Step 1: Deploy in read-only mode first
OPENROUTER_API_KEY=sk-or-v1-your-key-here ./scripts/deploy-wikijs.sh deploy

# Step 2: Obtain admin JWT token
eval $(./scripts/deploy-wikijs.sh get-token)

# Step 3: Update with write operations enabled
ENABLE_WRITE_OPERATIONS=true \
OPENROUTER_API_KEY=sk-or-v1-your-key-here \
./scripts/deploy-wikijs.sh update
```

This adds:
- `create_wiki_page` - Create new pages
- `update_wiki_page` - Update existing pages
- `delete_wiki_page` - Delete pages
- `move_wiki_page` - Move/rename pages

## Obtaining Wiki.js Admin JWT Token

The JWT token is required for write operations. There are two methods:

### Method 1: Using Deployment Script (Recommended)

```bash
# Set credentials (if different from defaults)
export WIKI_ADMIN_EMAIL=admin@wiki.local
export WIKI_ADMIN_PASSWORD=your-password

# Get token and export to environment
eval $(./scripts/deploy-wikijs.sh get-token)

# Verify token is set
echo $WIKI_ADMIN_TOKEN
```

### Method 2: Manual via GraphQL

1. Log into Wiki.js: http://your-wiki:3000
2. Open browser developer tools (F12)
3. Go to Console tab
4. Run this GraphQL mutation:

```javascript
fetch('http://localhost:3000/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `mutation($u:String!,$p:String!){
      authentication{
        login(username:$u,password:$p,strategy:"local"){
          responseResult{succeeded,message}
          jwt
        }
      }
    }`,
    variables: {
      u: 'admin@wiki.local',
      p: 'your-password'
    }
  })
})
.then(r => r.json())
.then(d => console.log(d.data.authentication.login.jwt))
```

5. Copy the JWT token from console output

### Method 3: Via Wiki.js API Access (Future)

Wiki.js 2.x doesn't have a built-in API key management UI. Use methods 1 or 2 above.

**Token Format**: `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...`

**Security Notes**:
- Never commit tokens to git
- Store as Podman secrets (deployment script handles this)
- Rotate tokens regularly (every 90 days recommended)
- Use read-only mode when write operations aren't needed

## Configuration Options

### Environment Variables

Set these when running `deploy-wikijs.sh`:

**Required**:
- `OPENROUTER_API_KEY` - OpenRouter API key (get from https://openrouter.ai/)

**Optional**:
- `ENABLE_WRITE_OPERATIONS` - Enable write tools (default: false)
- `WIKI_ADMIN_TOKEN` - JWT token (required if write ops enabled)
- `EMBEDDING_MODEL` - Model to use (default: openai/text-embedding-3-small)
- `OPENROUTER_BASE_URL` - API base URL (default: https://openrouter.ai/api/v1)
- `SYNC_INTERVAL_MS` - Sync interval (default: 300000 = 5 minutes)
- `WIKI_ADMIN_EMAIL` - Admin email (default: admin@wiki.local)
- `WIKI_ADMIN_PASSWORD` - Admin password (default: ChangeMe123!)

### Example Configurations

**Development (read-only)**:
```bash
OPENROUTER_API_KEY=sk-or-v1-dev-key \
./scripts/deploy-wikijs.sh deploy
```

**Production (read-only)**:
```bash
OPENROUTER_API_KEY=sk-or-v1-prod-key \
WIKI_ADMIN_EMAIL=admin@company.com \
WIKI_ADMIN_PASSWORD=SecurePass123! \
./scripts/deploy-wikijs.sh deploy
```

**Production (read-write)**:
```bash
# First deploy
OPENROUTER_API_KEY=sk-or-v1-prod-key \
WIKI_ADMIN_EMAIL=admin@company.com \
WIKI_ADMIN_PASSWORD=SecurePass123! \
./scripts/deploy-wikijs.sh deploy

# Get token
WIKI_ADMIN_EMAIL=admin@company.com \
WIKI_ADMIN_PASSWORD=SecurePass123! \
eval $(./scripts/deploy-wikijs.sh get-token)

# Update with write ops
ENABLE_WRITE_OPERATIONS=true \
OPENROUTER_API_KEY=sk-or-v1-prod-key \
./scripts/deploy-wikijs.sh update
```

## Deployment Commands

### Deploy (Initial Setup)

```bash
./scripts/deploy-wikijs.sh deploy
```

Creates:
- Podman pod with 3 containers (PostgreSQL, Wiki.js, MCP Server)
- Named volumes for data persistence
- Podman secrets for credentials
- Systemd unit for auto-start on boot

### Start/Stop

```bash
# Start existing pod
./scripts/deploy-wikijs.sh start

# Stop pod gracefully
./scripts/deploy-wikijs.sh stop
```

### Update (Pull Latest Images)

```bash
./scripts/deploy-wikijs.sh update
```

Preserves:
- Database data
- Wiki.js content
- Podman secrets
- Configuration

### Status

```bash
./scripts/deploy-wikijs.sh status
```

Shows:
- Pod status
- Container status
- Port mappings

### Logs

```bash
# Wiki.js logs
./scripts/deploy-wikijs.sh logs wikijs-app

# MCP Server logs
./scripts/deploy-wikijs.sh logs wikijs-mcp

# PostgreSQL logs
./scripts/deploy-wikijs.sh logs wikijs-postgres
```

### Destroy

```bash
./scripts/deploy-wikijs.sh destroy
```

Removes:
- Pod and containers
- Preserves volumes and secrets

## Post-Deployment

### Verify Deployment

1. **Check pod status**:
```bash
./scripts/deploy-wikijs.sh status
```

Expected: All containers running

2. **Check MCP server logs**:
```bash
./scripts/deploy-wikijs.sh logs wikijs-mcp
```

Expected:
```
[Sync] Starting embedding sync pipeline
[Sync] Found X new pages to process
[Sync] Embedding sync completed successfully
```

3. **Test Wiki.js access**:
```bash
curl http://localhost:3000
```

Expected: HTML response

4. **Test MCP server**:
```bash
curl http://localhost:3001/health
```

Expected: `{"status":"ok"}`

### Configure Firewall

Add OCI security list rules:

```bash
# Wiki.js (port 3000)
oci network security-list update \
  --security-list-id <your-security-list-ocid> \
  --ingress-security-rules '[
    {"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":3000,"max":3000}},"isStateless":false,"description":"Wiki.js HTTP"}
  ]'

# MCP Server (port 3001) - restrict to agent hosts only
oci network security-list update \
  --security-list-id <your-security-list-ocid> \
  --ingress-security-rules '[
    {"protocol":"6","source":"<agent-ip>/32","tcpOptions":{"destinationPortRange":{"min":3001,"max":3001}},"isStateless":false,"description":"MCP Server"}
  ]'
```

Or via Terraform:
```hcl
ingress_security_rules = [
  {
    protocol    = "6"
    source      = "0.0.0.0/0"
    tcp_options = {
      min = 3000
      max = 3000
    }
    description = "Wiki.js HTTP"
  },
  {
    protocol    = "6"
    source      = var.agent_ip
    tcp_options = {
      min = 3001
      max = 3001
    }
    description = "MCP Server"
  }
]
```

### Monitor Sync Pipeline

The sync pipeline runs every 5 minutes (configurable via `SYNC_INTERVAL_MS`):

```bash
# Watch sync logs
./scripts/deploy-wikijs.sh logs wikijs-mcp | grep Sync

# Check embedding count
podman exec wikijs-postgres psql -U wiki -d wiki -c "SELECT COUNT(*) FROM wiki_embeddings;"
```

Expected behavior:
- New pages detected and processed
- Embeddings generated within 5 minutes
- No errors in logs

## Troubleshooting

### Container Won't Start

**Symptoms**: Container exits immediately after start

**Check logs**:
```bash
./scripts/deploy-wikijs.sh logs wikijs-mcp
```

**Common causes**:
- Missing OPENROUTER_API_KEY
- Invalid API key
- Database connection failed
- Port already in use

**Solutions**:
1. Verify API key: `podman secret inspect wikijs-openrouter-key`
2. Check database: `podman exec wikijs-postgres pg_isready -U wiki`
3. Check ports: `netstat -tuln | grep -E '3000|3001'`

### Embeddings Not Generating

**Symptoms**: Search returns no results, embedding count is 0

**Check**:
```bash
# Check sync logs
./scripts/deploy-wikijs.sh logs wikijs-mcp | grep -i "sync\|error"

# Check embedding count
podman exec wikijs-postgres psql -U wiki -d wiki -c "SELECT COUNT(*) FROM wiki_embeddings;"
```

**Common causes**:
- OpenRouter API key invalid
- Network connectivity issues
- Sync pipeline not running
- Database migration not completed

**Solutions**:
1. Test API key:
```bash
curl https://openrouter.ai/api/v1/embeddings \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/text-embedding-3-small","input":"test"}'
```

2. Restart MCP server:
```bash
podman restart wikijs-mcp
```

3. Check database schema:
```bash
podman exec wikijs-postgres psql -U wiki -d wiki -c "\d wiki_embeddings"
```

### Write Operations Failing

**Symptoms**: create_wiki_page returns error

**Check**:
```bash
# Verify write ops enabled
podman exec wikijs-mcp env | grep ENABLE_WRITE_OPERATIONS

# Verify admin token set
podman exec wikijs-mcp env | grep WIKI_ADMIN_TOKEN
```

**Common causes**:
- ENABLE_WRITE_OPERATIONS not set to true
- WIKI_ADMIN_TOKEN missing or invalid
- Token expired

**Solutions**:
1. Verify configuration:
```bash
./scripts/deploy-wikijs.sh status
```

2. Regenerate token:
```bash
eval $(./scripts/deploy-wikijs.sh get-token)
ENABLE_WRITE_OPERATIONS=true OPENROUTER_API_KEY=... ./scripts/deploy-wikijs.sh update
```

3. Check token validity:
```bash
curl http://localhost:3000/graphql \
  -H "Authorization: Bearer $WIKI_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"{pages{list{id,title}}}"}'
```

### High Memory Usage

**Symptoms**: Container using excessive memory

**Check**:
```bash
podman stats wikijs-mcp
```

**Common causes**:
- Large sync batch
- Memory leak
- Too many concurrent embeddings

**Solutions**:
1. Increase sync interval:
```bash
SYNC_INTERVAL_MS=600000 ./scripts/deploy-wikijs.sh update
```

2. Restart container:
```bash
podman restart wikijs-mcp
```

3. Monitor over time:
```bash
watch -n 5 'podman stats --no-stream wikijs-mcp'
```

## Rollback Procedures

### Disable Write Operations

```bash
# Stop container
podman stop wikijs-mcp
podman rm wikijs-mcp

# Redeploy in read-only mode
ENABLE_WRITE_OPERATIONS=false \
OPENROUTER_API_KEY=... \
./scripts/deploy-wikijs.sh update
```

### Revert to Previous Version

```bash
# Tag current version
podman tag wikijs-mcp-server:latest wikijs-mcp-server:backup

# Pull/build previous version
cd ~/deploy/services/wiki-mcp-server
git checkout <previous-commit>
podman build --platform linux/arm64 -t wikijs-mcp-server:latest .

# Update deployment
./scripts/deploy-wikijs.sh update
```

### Full Rollback

```bash
# Stop and remove everything
./scripts/deploy-wikijs.sh destroy

# Remove volumes (WARNING: deletes all data)
podman volume rm wikijs-pgdata wikijs-assets

# Remove secrets
podman secret rm wikijs-pg-password wikijs-openrouter-key wikijs-admin-token

# Redeploy from scratch
OPENROUTER_API_KEY=... ./scripts/deploy-wikijs.sh deploy
```

## Security Best Practices

1. **API Keys**:
   - Never commit to git
   - Store as Podman secrets
   - Rotate every 90 days
   - Use separate keys for dev/prod

2. **Admin Tokens**:
   - Generate fresh for each deployment
   - Don't reuse across environments
   - Revoke when no longer needed
   - Monitor usage in Wiki.js logs

3. **Network Security**:
   - Restrict MCP port (3001) to agent hosts only
   - Use HTTPS in production (add reverse proxy)
   - Enable OCI security lists
   - Monitor access logs

4. **Write Operations**:
   - Only enable when necessary
   - Use separate deployment for write-enabled instances
   - Audit all write operations
   - Implement backup strategy

5. **Monitoring**:
   - Check logs daily
   - Monitor embedding generation
   - Track API usage and costs
   - Set up alerts for errors

## Backup and Recovery

### Backup

```bash
# Full database backup
podman exec wikijs-postgres pg_dump -U wiki wiki > wiki_backup_$(date +%Y%m%d).sql

# Embeddings only
podman exec wikijs-postgres pg_dump -U wiki -t wiki_embeddings wiki > embeddings_backup_$(date +%Y%m%d).sql

# Wiki.js assets
podman volume export wikijs-assets > assets_backup_$(date +%Y%m%d).tar
```

### Restore

```bash
# Restore database
podman exec -i wikijs-postgres psql -U wiki wiki < wiki_backup_YYYYMMDD.sql

# Restore embeddings
podman exec -i wikijs-postgres psql -U wiki wiki < embeddings_backup_YYYYMMDD.sql

# Restore assets
podman volume import wikijs-assets < assets_backup_YYYYMMDD.tar
```

## Performance Tuning

### Sync Interval

Adjust based on wiki update frequency:

```bash
# High-traffic wiki (check every 2 minutes)
SYNC_INTERVAL_MS=120000 ./scripts/deploy-wikijs.sh update

# Low-traffic wiki (check every 15 minutes)
SYNC_INTERVAL_MS=900000 ./scripts/deploy-wikijs.sh update
```

### Database Tuning

For large wikis (>1000 pages):

```bash
# Increase shared buffers
podman exec wikijs-postgres psql -U wiki -d wiki -c "ALTER SYSTEM SET shared_buffers = '256MB';"
podman restart wikijs-postgres
```

### Embedding Model

Choose based on requirements:

```bash
# Faster, smaller (1536 dimensions)
EMBEDDING_MODEL=openai/text-embedding-3-small

# Better quality, larger (3072 dimensions)
EMBEDDING_MODEL=openai/text-embedding-3-large
```

## Cost Optimization

### OpenRouter Costs

Monitor usage at https://openrouter.ai/dashboard

Typical costs:
- text-embedding-3-small: $0.00002 per 1K tokens
- 100 pages × 5 chunks × 200 tokens = 100K tokens = $0.002 per full sync
- Daily cost (4 syncs/hour × 24 hours): ~$0.20/day

### Reduce Costs

1. Increase sync interval (less frequent updates)
2. Use smaller embedding model
3. Implement incremental sync (only changed pages)
4. Cache embeddings longer

## Support

For issues:
1. Check logs: `./scripts/deploy-wikijs.sh logs wikijs-mcp`
2. Review this troubleshooting section
3. Check OpenRouter status: https://openrouter.ai/status
4. Consult design document: `.kiro/specs/wiki-mcp-access-control/design.md`
5. Review migration guide: `services/wiki-mcp-server/MIGRATION.md`
