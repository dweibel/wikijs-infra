# Migration Guide: agent-infra to wikijs-infra

This guide helps you migrate from an existing Wiki.js deployment in agent-infra to the new dedicated wikijs-infra repository.

## Overview

The wikijs-infra repository is a standalone, focused repository for Wiki.js infrastructure. It contains:
- MCP server source code
- Deployment scripts
- Documentation
- Testing infrastructure

## Prerequisites

- Existing Wiki.js deployment from agent-infra
- Access to the OCI instance running Wiki.js
- SSH access to the remote host (if applicable)
- Podman installed on target system

## Migration Steps

### 1. Export Existing Wiki.js Data

Before migrating, export your existing Wiki.js content:

```bash
# Connect to your OCI instance
ssh -i ~/.ssh/oci_agent_coder opc@<instance-ip>

# Export Wiki.js database
podman exec wikijs-postgres pg_dump -U wiki -d wiki > ~/wiki-backup.sql

# Verify backup
ls -lh ~/wiki-backup.sql
```

### 2. Backup Existing Embeddings

Export the vector embeddings from your current deployment:

```bash
# From agent-infra repository
cd agent-infra/services/wiki-mcp-server
./backup-embeddings.sh --remote-host <instance-ip> --output ~/embeddings-backup.sql.gz

# Or on the remote host directly
ssh -i ~/.ssh/oci_agent_coder opc@<instance-ip>
podman exec wikijs-postgres pg_dump -U wiki -d wiki -t wiki_embeddings | gzip > ~/embeddings-backup-$(date +%Y%m%d-%H%M%S).sql.gz
```

### 3. Stop Existing Deployment

Stop the old deployment from agent-infra:

```bash
# From agent-infra repository
cd agent-infra
./scripts/deploy-wikijs.sh stop

# Or destroy completely (preserves volumes)
./scripts/deploy-wikijs.sh destroy
```

### 4. Clone wikijs-infra Repository

```bash
git clone <wikijs-infra-repo-url>
cd wikijs-infra
```

### 5. Configure Environment

Copy and configure your environment variables:

```bash
cp .env.example .env
nano .env
```

Set the same values you used in agent-infra:
- `OPENROUTER_API_KEY` - Your OpenRouter API key
- `WIKI_ADMIN_EMAIL` - Same admin email
- `WIKI_ADMIN_PASSWORD` - Same admin password
- `EMBEDDING_MODEL` - Same embedding model
- Other configuration as needed

### 6. Deploy New Stack

Deploy using the wikijs-infra scripts:

```bash
# Load environment
source .env

# Deploy to remote host
OPENROUTER_API_KEY=$OPENROUTER_API_KEY ./scripts/deploy-wikijs.sh deploy
```

### 7. Restore Wiki.js Data

Restore your exported Wiki.js content:

```bash
# Copy backup to remote host
scp -i ~/.ssh/oci_agent_coder ~/wiki-backup.sql opc@<instance-ip>:~/

# Restore on remote host
ssh -i ~/.ssh/oci_agent_coder opc@<instance-ip>
podman exec -i wikijs-postgres psql -U wiki -d wiki < ~/wiki-backup.sql
```

### 8. Restore Embeddings

Restore the vector embeddings:

```bash
# Copy embeddings backup to remote host
scp -i ~/.ssh/oci_agent_coder ~/embeddings-backup.sql.gz opc@<instance-ip>:~/

# Restore on remote host
ssh -i ~/.ssh/oci_agent_coder opc@<instance-ip>
gunzip -c ~/embeddings-backup.sql.gz | podman exec -i wikijs-postgres psql -U wiki -d wiki
```

### 9. Verify Migration

Run the smoke test to verify everything works:

```bash
# From wikijs-infra repository
./scripts/smoke-test-wikijs.sh <instance-ip>
```

Check that:
- Wiki.js UI is accessible at `http://<instance-ip>:3000`
- MCP server is accessible at `http://<instance-ip>:3001`
- Search functionality works
- All your pages are present

### 10. Update MCP Client Configuration

If you're using the MCP server with Kiro or Claude, update your client configuration to point to the new deployment. The configuration format remains the same:

```json
{
  "mcpServers": {
    "wiki": {
      "command": "node",
      "args": ["/path/to/wikijs-infra/services/wiki-mcp-server/src/client.js"],
      "env": {
        "WIKI_BASE_URL": "http://<instance-ip>:3000",
        "OPENROUTER_API_KEY": "sk-or-v1-...",
        "PGHOST": "<instance-ip>",
        "PGPORT": "5432",
        "PGDATABASE": "wiki",
        "PGUSER": "wiki",
        "PGPASSWORD": "your-password"
      }
    }
  }
}
```

## Backward Compatibility

The wikijs-infra repository maintains full backward compatibility with agent-infra:

- Same MCP server API
- Same deployment script commands
- Same environment variable names
- Same container names and ports
- Same database schema

Your existing MCP client configurations will work without modification (just update paths if needed).

## Troubleshooting

### Embeddings Not Restored

If embeddings aren't working after restore:

```bash
# Verify embeddings table exists
ssh -i ~/.ssh/oci_agent_coder opc@<instance-ip>
podman exec wikijs-postgres psql -U wiki -d wiki -c "SELECT COUNT(*) FROM wiki_embeddings;"

# Re-run sync pipeline manually
podman restart wikijs-mcp
podman logs -f wikijs-mcp
```

### MCP Server Connection Issues

Check MCP server logs:

```bash
./scripts/deploy-wikijs.sh logs wikijs-mcp
```

Verify environment variables:

```bash
podman exec wikijs-mcp env | grep -E '(OPENROUTER|PGHOST|WIKI_BASE)'
```

### Database Connection Errors

Verify PostgreSQL is running:

```bash
./scripts/deploy-wikijs.sh status
podman exec wikijs-postgres pg_isready -U wiki
```

## Rollback Procedure

If you need to rollback to agent-infra:

1. Stop wikijs-infra deployment:
   ```bash
   cd wikijs-infra
   ./scripts/deploy-wikijs.sh destroy
   ```

2. Redeploy from agent-infra:
   ```bash
   cd agent-infra
   ./scripts/deploy-wikijs.sh deploy
   ```

3. Restore your backups if needed

## Post-Migration Cleanup

After successful migration and verification:

1. Remove old deployment artifacts from agent-infra (optional)
2. Update documentation references
3. Update CI/CD pipelines if applicable
4. Archive agent-infra backups

## Support

For issues or questions:
- Check the [DEPLOYMENT.md](DEPLOYMENT.md) guide
- Review [TESTING.md](TESTING.md) for testing procedures
- Check [API.md](API.md) for MCP server API reference
