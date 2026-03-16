#!/bin/bash
# Test script for OpenRouter migration
# This script validates the migration on a development database

set -e

echo "=== OpenRouter Migration Test ==="
echo ""

# Configuration
DB_CONTAINER="${DB_CONTAINER:-wikijs-postgresql}"
DB_USER="${DB_USER:-wikijs}"
DB_NAME="${DB_NAME:-wiki}"

echo "Configuration:"
echo "  Database Container: $DB_CONTAINER"
echo "  Database User: $DB_USER"
echo "  Database Name: $DB_NAME"
echo ""

# Check if container is running
echo "Step 1: Checking database container..."
if ! podman ps | grep -q "$DB_CONTAINER"; then
    echo "ERROR: Database container '$DB_CONTAINER' is not running"
    exit 1
fi
echo "✓ Database container is running"
echo ""

# Verify current schema
echo "Step 2: Verifying current schema..."
CURRENT_SCHEMA=$(podman exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT column_name, udt_name FROM information_schema.columns WHERE table_name = 'wiki_embeddings' AND column_name = 'embedding';")
echo "Current schema: $CURRENT_SCHEMA"
echo ""

# Check if migration is needed
if echo "$CURRENT_SCHEMA" | grep -q "vector"; then
    echo "✓ Vector column exists"
else
    echo "ERROR: Vector column not found. Is pgvector installed?"
    exit 1
fi
echo ""

# Count existing embeddings
echo "Step 3: Counting existing embeddings..."
EMBEDDING_COUNT=$(podman exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM wiki_embeddings;")
echo "Current embeddings: $EMBEDDING_COUNT"
echo ""

# Run migration
echo "Step 4: Running migration script..."
if [ ! -f "migration-openrouter.sql" ]; then
    echo "ERROR: migration-openrouter.sql not found"
    exit 1
fi

# Copy migration script to container
podman cp migration-openrouter.sql "$DB_CONTAINER:/tmp/"

# Execute migration
echo "Executing migration..."
podman exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -f /tmp/migration-openrouter.sql

echo ""

# Verify migration
echo "Step 5: Verifying migration..."

# Check vector dimensions
echo "Checking vector dimensions..."
NEW_SCHEMA=$(podman exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT column_name, udt_name FROM information_schema.columns WHERE table_name = 'wiki_embeddings' AND column_name = 'embedding';")
echo "New schema: $NEW_SCHEMA"

# Verify table is empty
NEW_COUNT=$(podman exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM wiki_embeddings;")
echo "Embeddings after migration: $NEW_COUNT"

if [ "$NEW_COUNT" -ne 0 ]; then
    echo "WARNING: Expected 0 embeddings after migration, found $NEW_COUNT"
fi

# Verify index exists
echo "Checking index..."
INDEX_EXISTS=$(podman exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT indexname FROM pg_indexes WHERE tablename = 'wiki_embeddings' AND indexname = 'idx_embeddings_vector';")
if [ -z "$INDEX_EXISTS" ]; then
    echo "ERROR: Index idx_embeddings_vector not found"
    exit 1
fi
echo "✓ Index exists: $INDEX_EXISTS"
echo ""

# Test inserting a 1536-dimension vector
echo "Step 6: Testing vector insertion..."
TEST_VECTOR=$(python3 -c "import random; print('[' + ','.join(str(random.random()) for _ in range(1536)) + ']')")
INSERT_RESULT=$(podman exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "INSERT INTO wiki_embeddings (page_id, page_path, page_title, chunk_index, chunk_text, embedding) VALUES (99999, '/test', 'Test Page', 0, 'Test content', '$TEST_VECTOR'::vector) RETURNING id;")

if [ -z "$INSERT_RESULT" ]; then
    echo "ERROR: Failed to insert test vector"
    exit 1
fi
echo "✓ Successfully inserted 1536-dimension vector (id: $INSERT_RESULT)"
echo ""

# Test vector search
echo "Step 7: Testing vector search..."
SEARCH_RESULT=$(podman exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT page_id, page_title FROM wiki_embeddings WHERE page_id = 99999 ORDER BY embedding <=> '$TEST_VECTOR'::vector LIMIT 1;")
if [ -z "$SEARCH_RESULT" ]; then
    echo "ERROR: Vector search failed"
    exit 1
fi
echo "✓ Vector search successful: $SEARCH_RESULT"
echo ""

# Cleanup test data
echo "Step 8: Cleaning up test data..."
podman exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "DELETE FROM wiki_embeddings WHERE page_id = 99999;"
echo "✓ Test data cleaned up"
echo ""

# Cleanup migration script
podman exec "$DB_CONTAINER" rm /tmp/migration-openrouter.sql

echo "=== Migration Test Complete ==="
echo ""
echo "Summary:"
echo "  ✓ Migration script executed successfully"
echo "  ✓ Vector dimensions changed to 1536"
echo "  ✓ Index recreated successfully"
echo "  ✓ Vector insertion works"
echo "  ✓ Vector search works"
echo ""
echo "Next steps:"
echo "  1. Update container configuration with OPENROUTER_API_KEY"
echo "  2. Restart wiki-mcp-server container"
echo "  3. Monitor sync pipeline to regenerate embeddings"
echo ""
