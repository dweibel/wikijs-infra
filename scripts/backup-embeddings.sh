#!/bin/bash
# Backup script for wiki embeddings
# Creates a backup of the wiki_embeddings table before migration

set -e

# Configuration
DB_CONTAINER="${DB_CONTAINER:-wikijs-postgresql}"
DB_USER="${DB_USER:-wikijs}"
DB_NAME="${DB_NAME:-wiki}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "=== Wiki Embeddings Backup ==="
echo ""
echo "Configuration:"
echo "  Database Container: $DB_CONTAINER"
echo "  Database User: $DB_USER"
echo "  Database Name: $DB_NAME"
echo "  Backup Directory: $BACKUP_DIR"
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Check if container is running
echo "Checking database container..."
if ! podman ps | grep -q "$DB_CONTAINER"; then
    echo "ERROR: Database container '$DB_CONTAINER' is not running"
    exit 1
fi
echo "✓ Database container is running"
echo ""

# Count embeddings
EMBEDDING_COUNT=$(podman exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM wiki_embeddings;")
echo "Current embeddings: $EMBEDDING_COUNT"
echo ""

# Create full database backup
echo "Creating full database backup..."
FULL_BACKUP="$BACKUP_DIR/wiki_full_backup_$TIMESTAMP.sql"
podman exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" > "$FULL_BACKUP"
echo "✓ Full backup created: $FULL_BACKUP"
echo "  Size: $(du -h "$FULL_BACKUP" | cut -f1)"
echo ""

# Create embeddings table backup
echo "Creating embeddings table backup..."
EMBEDDINGS_BACKUP="$BACKUP_DIR/wiki_embeddings_backup_$TIMESTAMP.sql"
podman exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -t wiki_embeddings "$DB_NAME" > "$EMBEDDINGS_BACKUP"
echo "✓ Embeddings backup created: $EMBEDDINGS_BACKUP"
echo "  Size: $(du -h "$EMBEDDINGS_BACKUP" | cut -f1)"
echo ""

# Create schema-only backup
echo "Creating schema-only backup..."
SCHEMA_BACKUP="$BACKUP_DIR/wiki_schema_backup_$TIMESTAMP.sql"
podman exec "$DB_CONTAINER" pg_dump -U "$DB_USER" --schema-only "$DB_NAME" > "$SCHEMA_BACKUP"
echo "✓ Schema backup created: $SCHEMA_BACKUP"
echo "  Size: $(du -h "$SCHEMA_BACKUP" | cut -f1)"
echo ""

# Create backup manifest
MANIFEST="$BACKUP_DIR/backup_manifest_$TIMESTAMP.txt"
cat > "$MANIFEST" << EOF
Wiki Database Backup Manifest
==============================
Timestamp: $TIMESTAMP
Date: $(date)

Database Information:
  Container: $DB_CONTAINER
  User: $DB_USER
  Database: $DB_NAME
  Embeddings Count: $EMBEDDING_COUNT

Backup Files:
  Full Database: $FULL_BACKUP
  Embeddings Table: $EMBEDDINGS_BACKUP
  Schema Only: $SCHEMA_BACKUP

Restore Instructions:
  Full restore: podman exec -i $DB_CONTAINER psql -U $DB_USER $DB_NAME < $FULL_BACKUP
  Embeddings only: podman exec -i $DB_CONTAINER psql -U $DB_USER $DB_NAME < $EMBEDDINGS_BACKUP
  Schema only: podman exec -i $DB_CONTAINER psql -U $DB_USER $DB_NAME < $SCHEMA_BACKUP

Notes:
  - Keep backups for at least 30 days
  - Verify backup integrity before deleting
  - Test restore procedure on development database
EOF

echo "✓ Manifest created: $MANIFEST"
echo ""

# Verify backups
echo "Verifying backups..."
for file in "$FULL_BACKUP" "$EMBEDDINGS_BACKUP" "$SCHEMA_BACKUP"; do
    if [ ! -f "$file" ]; then
        echo "ERROR: Backup file not found: $file"
        exit 1
    fi
    if [ ! -s "$file" ]; then
        echo "ERROR: Backup file is empty: $file"
        exit 1
    fi
done
echo "✓ All backup files verified"
echo ""

echo "=== Backup Complete ==="
echo ""
echo "Backup Summary:"
echo "  Location: $BACKUP_DIR"
echo "  Timestamp: $TIMESTAMP"
echo "  Files:"
echo "    - $FULL_BACKUP"
echo "    - $EMBEDDINGS_BACKUP"
echo "    - $SCHEMA_BACKUP"
echo "    - $MANIFEST"
echo ""
echo "Total backup size: $(du -sh "$BACKUP_DIR" | cut -f1)"
echo ""
echo "To restore from backup:"
echo "  podman exec -i $DB_CONTAINER psql -U $DB_USER $DB_NAME < $FULL_BACKUP"
echo ""
