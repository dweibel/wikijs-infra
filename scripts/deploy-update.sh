#!/bin/bash
# Wiki MCP Server Deployment Script
# Executes on OCI instance to update to latest version with write operations support

set -euo pipefail

# Load from environment or .env file - never hardcode secrets
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
    if [ -f "$HOME/wikijs/.env" ]; then
        OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' "$HOME/wikijs/.env" | cut -d'=' -f2-)
    fi
fi
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
    echo "ERROR: OPENROUTER_API_KEY not set. Export it or add it to $HOME/wikijs/.env"
    exit 1
fi
EMBEDDING_MODEL="openai/text-embedding-3-small"
WIKI_DIR="$HOME/wikijs"

echo "=== Wiki MCP Server Deployment ==="
echo "Starting deployment at $(date)"
echo ""

# Step 1: Backup current deployment
echo "Step 1: Creating backup..."
if [ -d "$WIKI_DIR/services/wiki-mcp-server.backup" ]; then
    rm -rf "$WIKI_DIR/services/wiki-mcp-server.backup"
fi
cp -r "$WIKI_DIR/services/wiki-mcp-server" "$WIKI_DIR/services/wiki-mcp-server.backup"
echo "✓ Backup created"
echo ""

# Step 2: Check current status
echo "Step 2: Checking current deployment..."
podman ps --filter name=wikijs
echo ""

# Step 3: Update deployment script
echo "Step 3: Updating deployment scripts..."
cd "$WIKI_DIR"

# Make scripts executable
chmod +x scripts/deploy-wikijs.sh 2>/dev/null || true
chmod +x scripts/smoke-test-wikijs.sh 2>/dev/null || true
echo "✓ Scripts ready"
echo ""

# Step 4: Pull images and rebuild
echo "Step 4: Updating Wiki MCP Server..."
echo "This will:"
echo "  - Pull latest PostgreSQL and Wiki.js images"
echo "  - Rebuild MCP server with new code"
echo "  - Restart all containers"
echo "  - Preserve all data"
echo ""

cd "$WIKI_DIR"
OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
EMBEDDING_MODEL="$EMBEDDING_MODEL" \
./scripts/deploy-wikijs.sh update 2>&1 | tee /tmp/wiki-deploy.log

echo ""
echo "Step 5: Verifying deployment..."
sleep 5
podman ps --filter name=wikijs
echo ""

# Step 6: Check MCP server logs
echo "Step 6: Checking MCP server startup..."
podman logs wikijs-mcp --tail 50 | tail -20
echo ""

# Step 7: Database migration
echo "Step 7: Executing database migration..."
cd "$WIKI_DIR/services/wiki-mcp-server"

# Backup database first
echo "Creating database backup..."
podman exec wikijs-postgres pg_dump -U wiki wiki > "$HOME/wiki_backup_$(date +%Y%m%d_%H%M%S).sql"
echo "✓ Database backed up"

# Execute migration
echo "Executing OpenRouter migration..."
if [ -f "migration-openrouter.sql" ]; then
    podman exec -i wikijs-postgres psql -U wiki -d wiki < migration-openrouter.sql
    echo "✓ Migration executed"
else
    echo "⚠ Migration file not found, skipping"
fi

# Verify migration
echo "Verifying migration..."
podman exec wikijs-postgres psql -U wiki -d wiki -c "\d wiki_embeddings" | grep vector
echo ""

echo "=== Deployment Complete ==="
echo "Completed at $(date)"
echo ""
echo "Next steps:"
echo "1. Run smoke test from local machine:"
echo "   ./scripts/smoke-test-wikijs.sh 193.122.215.174"
echo ""
echo "2. To enable write operations:"
echo "   eval \$(./scripts/deploy-wikijs.sh get-token)"
echo "   ENABLE_WRITE_OPERATIONS=true OPENROUTER_API_KEY=\$OPENROUTER_API_KEY ./scripts/deploy-wikijs.sh update"
echo ""
echo "Logs saved to: /tmp/wiki-deploy.log"
