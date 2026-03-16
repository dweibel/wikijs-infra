#!/usr/bin/env bash
set -euo pipefail

# Usage: deploy-wikijs.sh <command> [args]
# Commands: deploy, start, stop, status, update, logs, destroy

# ─── Constants / Configuration ───────────────────────────────────────────────
POD_NAME="wikijs"
PG_CONTAINER="wikijs-postgres"
WIKI_CONTAINER="wikijs-app"
MCP_CONTAINER="wikijs-mcp"
PG_VOLUME="wikijs-pgdata"
WIKI_VOLUME="wikijs-assets"
PG_SECRET="wikijs-pg-password"
OPENROUTER_SECRET="wikijs-openrouter-key"
WIKI_PORT=3000
MCP_PORT=3001
PG_PORT=5432
PG_IMAGE="docker.io/pgvector/pgvector:pg16"
WIKI_IMAGE="ghcr.io/requarks/wiki:2"
MCP_IMAGE="wikijs-mcp-server:latest"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_SERVER_DIR="$(dirname "$SCRIPT_DIR")/services/wiki-mcp-server"
INIT_SQL="$MCP_SERVER_DIR/init-pgvector.sql"

# ─── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [args]

Commands:
  deploy     Pull images, create volumes, create pod, start all containers
  start      Start existing pod
  stop       Stop pod gracefully
  status     Show pod and container status
  update     Pull latest images, recreate containers (preserves volumes)
  logs       Tail container logs (default: $WIKI_CONTAINER)
  destroy    Stop and remove pod/containers (preserves volumes)
  get-token  Obtain a Wiki.js admin JWT and print an export statement

Environment variables (deploy/update):
  WIKI_ADMIN_EMAIL       Wiki.js admin email    (default: admin@wiki.local)
  WIKI_ADMIN_PASSWORD    Wiki.js admin password (default: ChangeMe123!)
  OPENROUTER_API_KEY     OpenRouter API key     (required for embeddings)
  EMBEDDING_MODEL        Embedding model        (default: openai/text-embedding-3-small)
  OPENROUTER_BASE_URL    OpenRouter base URL    (default: https://openrouter.ai/api/v1)
  SYNC_INTERVAL_MS       Embedding sync interval ms (default: 300000)
  ENABLE_WRITE_OPERATIONS Enable write tools    (default: false)
  WIKI_ADMIN_TOKEN       Wiki.js admin JWT      (required if ENABLE_WRITE_OPERATIONS=true)

Environment variables (get-token):
  WIKI_ADMIN_EMAIL     Admin email    (default: admin@wiki.local)
  WIKI_ADMIN_PASSWORD  Admin password (default: ChangeMe123!)
  WIKI_HOST            Host/IP of Wiki.js (default: localhost)

Network security note:
  Ensure OCI security list allows inbound TCP on port $WIKI_PORT (Wiki.js)
  and port $MCP_PORT (MCP Server) from your desired CIDR range.
  PostgreSQL port $PG_PORT is NOT exposed to the host — pod-internal only.
EOF
  exit 1
}

# ─── Image Pull (shared by deploy and update) ─────────────────────────────────
pull_images() {
  echo "Pulling container images (linux/arm64)..."
  podman pull --platform linux/arm64 "$PG_IMAGE" || { echo "ERROR: Failed to pull $PG_IMAGE"; exit 1; }
  podman pull --platform linux/arm64 "$WIKI_IMAGE" || { echo "ERROR: Failed to pull $WIKI_IMAGE"; exit 1; }
  echo "Building MCP server image..."
  podman build --platform linux/arm64 -t "$MCP_IMAGE" "$MCP_SERVER_DIR" || { echo "ERROR: Failed to build MCP server image"; exit 1; }
  echo "All images ready."
}

# ─── Start containers (shared by deploy and update) ───────────────────────────
start_containers() {
  # Create pod with port mappings
  podman pod create --name "$POD_NAME" \
    -p "${WIKI_PORT}:${WIKI_PORT}" \
    -p "${MCP_PORT}:${MCP_PORT}"

  # Start PostgreSQL first
  podman run -d \
    --name "$PG_CONTAINER" \
    --pod "$POD_NAME" \
    --secret "$PG_SECRET",type=env,target=POSTGRES_PASSWORD \
    -e POSTGRES_DB=wiki \
    -e POSTGRES_USER=wiki \
    -v "${PG_VOLUME}:/var/lib/postgresql/data" \
    "$PG_IMAGE"

  # Wait for PostgreSQL to be ready (max 60s)
  echo "Waiting for PostgreSQL to be ready..."
  for i in $(seq 1 60); do
    if podman exec "$PG_CONTAINER" pg_isready -U wiki -d wiki >/dev/null 2>&1; then
      echo "PostgreSQL is ready"
      break
    fi
    if [ "$i" -eq 60 ]; then
      echo "ERROR: PostgreSQL did not become ready within 60 seconds"
      exit 1
    fi
    sleep 1
  done

  # Run init SQL via exec (avoids bind-mount permission issues)
  echo "Initialising pgvector schema..."
  podman exec -i "$PG_CONTAINER" psql -U wiki -d wiki < "$INIT_SQL" \
    || { echo "ERROR: Failed to run init-pgvector.sql"; exit 1; }
  echo "Schema initialised."

  # Start Wiki.js
  podman run -d \
    --name "$WIKI_CONTAINER" \
    --pod "$POD_NAME" \
    --secret "$PG_SECRET",type=env,target=DB_PASS \
    -e DB_TYPE=postgres \
    -e DB_HOST=localhost \
    -e DB_PORT=5432 \
    -e DB_NAME=wiki \
    -e DB_USER=wiki \
    -e WIKI_ADMIN_EMAIL="${WIKI_ADMIN_EMAIL:-admin@wiki.local}" \
    -e WIKI_ADMIN_PASSWORD="${WIKI_ADMIN_PASSWORD:-ChangeMe123!}" \
    -v "${WIKI_VOLUME}:/wiki/data" \
    "$WIKI_IMAGE"

  # Start MCP server
  local mcp_env_args=(
    -e PGHOST=localhost
    -e PGPORT=5432
    -e PGDATABASE=wiki
    -e PGUSER=wiki
    -e WIKI_BASE_URL=http://localhost:3000
    -e SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS:-300000}"
    -e EMBEDDING_MODEL="${EMBEDDING_MODEL:-openai/text-embedding-3-small}"
    -e OPENROUTER_BASE_URL="${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}"
    -e ENABLE_WRITE_OPERATIONS="${ENABLE_WRITE_OPERATIONS:-false}"
  )

  # Add OpenRouter API key secret (required)
  local mcp_secret_args=(
    --secret "$PG_SECRET",type=env,target=PGPASSWORD
    --secret "$OPENROUTER_SECRET",type=env,target=OPENROUTER_API_KEY
  )

  # Add Wiki admin token secret if write operations enabled
  if [ "${ENABLE_WRITE_OPERATIONS:-false}" = "true" ]; then
    if [ -z "${WIKI_ADMIN_TOKEN:-}" ]; then
      echo "ERROR: WIKI_ADMIN_TOKEN required when ENABLE_WRITE_OPERATIONS=true"
      echo "  Obtain token with: eval \$(./scripts/deploy-wikijs.sh get-token)"
      exit 1
    fi
    echo -n "$WIKI_ADMIN_TOKEN" | podman secret create wikijs-admin-token - 2>/dev/null || \
      (podman secret rm wikijs-admin-token && echo -n "$WIKI_ADMIN_TOKEN" | podman secret create wikijs-admin-token -)
    mcp_secret_args+=(--secret wikijs-admin-token,type=env,target=WIKI_ADMIN_TOKEN)
  fi

  podman run -d \
    --name "$MCP_CONTAINER" \
    --pod "$POD_NAME" \
    "${mcp_secret_args[@]}" \
    "${mcp_env_args[@]}" \
    "$MCP_IMAGE"
}

# ─── Commands ─────────────────────────────────────────────────────────────────
cmd_deploy() {
  echo "=== Deploying Wiki.js pod ==="

  # Validate OpenRouter API key
  if [ -z "${OPENROUTER_API_KEY:-}" ]; then
    echo "ERROR: OPENROUTER_API_KEY environment variable is required"
    echo "  Obtain API key from: https://openrouter.ai/"
    echo "  Example: OPENROUTER_API_KEY=sk-or-v1-... ./scripts/deploy-wikijs.sh deploy"
    exit 1
  fi

  # Validate write operations configuration
  if [ "${ENABLE_WRITE_OPERATIONS:-false}" = "true" ] && [ -z "${WIKI_ADMIN_TOKEN:-}" ]; then
    echo "ERROR: WIKI_ADMIN_TOKEN required when ENABLE_WRITE_OPERATIONS=true"
    echo "  First deploy without write operations, then obtain token:"
    echo "  1. OPENROUTER_API_KEY=sk-or-v1-... ./scripts/deploy-wikijs.sh deploy"
    echo "  2. eval \$(./scripts/deploy-wikijs.sh get-token)"
    echo "  3. ENABLE_WRITE_OPERATIONS=true OPENROUTER_API_KEY=sk-or-v1-... ./scripts/deploy-wikijs.sh update"
    exit 1
  fi

  # Pre-pull validation — must succeed before touching any existing state
  pull_images

  # Create podman secret for DB password
  PG_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
  echo -n "$PG_PASS" | podman secret create "$PG_SECRET" - 2>/dev/null || \
    (podman secret rm "$PG_SECRET" && echo -n "$PG_PASS" | podman secret create "$PG_SECRET" -)

  # Create podman secret for OpenRouter API key
  echo -n "$OPENROUTER_API_KEY" | podman secret create "$OPENROUTER_SECRET" - 2>/dev/null || \
    (podman secret rm "$OPENROUTER_SECRET" && echo -n "$OPENROUTER_API_KEY" | podman secret create "$OPENROUTER_SECRET" -)

  # Create named volumes (idempotent)
  podman volume create "$PG_VOLUME" 2>/dev/null || true
  podman volume create "$WIKI_VOLUME" 2>/dev/null || true

  # Create pod and start containers
  start_containers

  # Generate systemd unit for auto-start on boot
  cmd_systemd

  echo ""
  echo "=== Wiki.js deployed successfully ==="
  echo "  Wiki.js:    http://localhost:${WIKI_PORT}"
  echo "  MCP Server: http://localhost:${MCP_PORT}"
  echo ""
  echo "  Admin email:    ${WIKI_ADMIN_EMAIL:-admin@wiki.local}"
  echo "  Admin password: ${WIKI_ADMIN_PASSWORD:-ChangeMe123!}"
  echo ""
  echo "  Embedding Model: ${EMBEDDING_MODEL:-openai/text-embedding-3-small}"
  echo "  Write Operations: ${ENABLE_WRITE_OPERATIONS:-false}"
  echo ""
  # Warn if using default admin password
  if [ "${WIKI_ADMIN_PASSWORD:-}" = "ChangeMe123!" ] || [ -z "${WIKI_ADMIN_PASSWORD:-}" ]; then
    echo "  ⚠️  WARNING: Using default admin password. Set WIKI_ADMIN_PASSWORD before deploying to production."
    echo "  Example: WIKI_ADMIN_PASSWORD=MySecurePass123! ./scripts/deploy-wikijs.sh deploy"
  fi

  # Warn about write operations
  if [ "${ENABLE_WRITE_OPERATIONS:-false}" = "true" ]; then
    echo "  ⚠️  Write operations ENABLED. MCP server can create/update/delete pages."
  else
    echo "  ℹ️  Write operations DISABLED (read-only mode)."
    echo "  To enable: Set ENABLE_WRITE_OPERATIONS=true and WIKI_ADMIN_TOKEN"
  fi

  print_firewall_rules
}

cmd_start() {
  echo "Starting pod $POD_NAME..."
  podman pod start "$POD_NAME"
  echo "Pod started."
}

cmd_stop() {
  echo "Stopping pod $POD_NAME gracefully..."
  podman pod stop "$POD_NAME"
  echo "Pod stopped."
}

cmd_status() {
  echo "=== Pod Status ==="
  podman pod ps --filter name="$POD_NAME"
  echo ""
  echo "=== Container Status ==="
  podman ps -a --filter pod="$POD_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
}

cmd_update() {
  echo "=== Updating Wiki.js pod ==="

  # Pre-pull validation — exit on failure without touching running containers
  pull_images

  # Stop and remove containers (preserve volumes and secret)
  echo "Stopping pod..."
  podman pod stop "$POD_NAME"
  echo "Removing containers..."
  podman rm "$PG_CONTAINER" "$WIKI_CONTAINER" "$MCP_CONTAINER"
  echo "Removing pod..."
  podman pod rm "$POD_NAME"

  # Recreate pod and start containers (reuses existing volumes and secret)
  start_containers

  echo ""
  echo "=== Wiki.js updated successfully ==="
  echo "  Wiki.js:    http://localhost:${WIKI_PORT}"
  echo "  MCP Server: http://localhost:${MCP_PORT}"
}

cmd_logs() {
  local container="${2:-$WIKI_CONTAINER}"
  echo "Tailing logs for $container (Ctrl+C to stop)..."
  podman logs -f "$container"
}

cmd_destroy() {
  echo "=== Destroying Wiki.js pod (volumes preserved) ==="
  podman pod stop "$POD_NAME" 2>/dev/null || true
  podman rm "$PG_CONTAINER" "$WIKI_CONTAINER" "$MCP_CONTAINER" 2>/dev/null || true
  podman pod rm "$POD_NAME" 2>/dev/null || true
  echo "Pod and containers removed. Volumes ($PG_VOLUME, $WIKI_VOLUME) preserved."
}

cmd_get_token() {
  local wiki_host="${WIKI_HOST:-localhost}"
  local wiki_url="http://${wiki_host}:${WIKI_PORT}/graphql"
  local email="${WIKI_ADMIN_EMAIL:-admin@wiki.local}"
  local password="${WIKI_ADMIN_PASSWORD:-ChangeMe123!}"

  # Build the auth mutation payload safely with jq
  local payload
  payload=$(jq -n \
    --arg u "$email" \
    --arg p "$password" \
    '{
      query: "mutation($u:String!,$p:String!){authentication{login(username:$u,password:$p,strategy:\"local\"){responseResult{succeeded,message}jwt}}}",
      variables: {u: $u, p: $p}
    }')

  local response
  response=$(curl -s --max-time 15 -X POST "$wiki_url" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null) || {
    echo "ERROR: Could not reach Wiki.js at ${wiki_url}" >&2
    exit 1
  }

  local succeeded
  succeeded=$(echo "$response" | jq -r '.data.authentication.login.responseResult.succeeded // false' 2>/dev/null || echo "false")

  if [[ "$succeeded" != "true" ]]; then
    local msg
    msg=$(echo "$response" | jq -r '.data.authentication.login.responseResult.message // "unknown error"' 2>/dev/null || echo "parse error")
    echo "ERROR: Authentication failed: ${msg}" >&2
    echo "  Check WIKI_ADMIN_EMAIL and WIKI_ADMIN_PASSWORD are correct." >&2
    echo "  Wiki.js URL: ${wiki_url}" >&2
    exit 1
  fi

  local token
  token=$(echo "$response" | jq -r '.data.authentication.login.jwt' 2>/dev/null || true)

  if [[ -z "$token" || "$token" == "null" ]]; then
    echo "ERROR: Auth succeeded but no JWT returned. Response: ${response}" >&2
    exit 1
  fi

  # Print as an export statement so callers can use: eval $(./deploy-wikijs.sh get-token)
  echo "export WIKI_ADMIN_TOKEN='${token}'"
}

print_firewall_rules() {
  cat <<EOF

=== OCI Security List Rules Required ===
Add the following INGRESS rules to your OCI VCN security list:

  Protocol: TCP
  Source CIDR: <your-ip>/32  (or 0.0.0.0/0 for public access)
  Destination Port: ${WIKI_PORT}   → Wiki.js web UI
  Description: Wiki.js HTTP access

  Protocol: TCP
  Source CIDR: <your-ip>/32  (restrict to agent hosts only)
  Destination Port: ${MCP_PORT}   → MCP Server (vector search)
  Description: MCP Server access

IMPORTANT: PostgreSQL port ${PG_PORT} is pod-internal only — do NOT add a rule for it.

To add rules via OCI CLI:
  oci network security-list update \\
    --security-list-id <your-security-list-ocid> \\
    --ingress-security-rules '[
      {"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":${WIKI_PORT},"max":${WIKI_PORT}}},"isStateless":false,"description":"Wiki.js HTTP"},
      {"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":${MCP_PORT},"max":${MCP_PORT}}},"isStateless":false,"description":"MCP Server"}
    ]'

Or update via Terraform by adding wiki_port=${WIKI_PORT} and mcp_port=${MCP_PORT} to the
oci-network module's allowed_http_cidrs / security list ingress rules.
EOF
}

cmd_systemd() {
  local unit_dir="$HOME/.config/systemd/user"
  local unit_file="$unit_dir/wikijs-pod.service"
  mkdir -p "$unit_dir"
  cat > "$unit_file" <<EOF
[Unit]
Description=Wiki.js Pod
Wants=network-online.target
After=network-online.target

[Service]
Type=forking
Restart=on-failure
ExecStart=/usr/bin/podman pod start wikijs
ExecStop=/usr/bin/podman pod stop wikijs
TimeoutStartSec=30

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user enable wikijs-pod.service 2>/dev/null || true
  loginctl enable-linger "$(whoami)" 2>/dev/null || true
  echo "Systemd unit installed: $unit_file"
}

# ─── Main Dispatch ────────────────────────────────────────────────────────────
case "${1:-help}" in
  deploy)     cmd_deploy ;;
  start)      cmd_start ;;
  stop)       cmd_stop ;;
  status)     cmd_status ;;
  update)     cmd_update ;;
  logs)       cmd_logs "$@" ;;
  destroy)    cmd_destroy ;;
  get-token)  cmd_get_token ;;
  *)          usage ;;
esac
