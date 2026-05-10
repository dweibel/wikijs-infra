#!/usr/bin/env bash
set -euo pipefail

# Usage: deploy-wikijs.sh <command> [args]
# Commands: deploy, start, stop, status, update, logs, destroy

# ─── Constants / Configuration ───────────────────────────────────────────────
POD_NAME="wikijs"
PG_CONTAINER="wikijs-postgres"
WIKI_CONTAINER="wikijs-app"
GATEWAY_CONTAINER="wikijs-gateway"
PG_VOLUME="/mnt/workspace/wikijs/pgdata"
WIKI_VOLUME="/mnt/workspace/wikijs/assets"
PG_SECRET="wikijs-pg-password"
OPENROUTER_SECRET="wikijs-openrouter-key"
API_KEY_RO_SECRET="wikijs-api-key-ro"
API_KEY_RW_SECRET="wikijs-api-key-rw"
ADMIN_TOKEN_SECRET="wikijs-admin-token"
GATEWAY_PORT=3001
PG_PORT=5432
PG_IMAGE="docker.io/pgvector/pgvector:pg16"
WIKI_IMAGE="ghcr.io/requarks/wiki:2"
GATEWAY_IMAGE="wikijs-gateway:latest"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_DIR="$(dirname "$SCRIPT_DIR")/services/wiki-api-gateway"
INIT_SQL="$GATEWAY_DIR/init-pgvector.sql"

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
  API_KEY_RO             Read-only API key      (at least one of RO/RW required)
  API_KEY_RW             Read-write API key     (at least one of RO/RW required)
  WIKI_ADMIN_TOKEN       Wiki.js admin JWT      (required if API_KEY_RW is set)

Environment variables (get-token):
  WIKI_ADMIN_EMAIL     Admin email    (default: admin@wiki.local)
  WIKI_ADMIN_PASSWORD  Admin password (default: ChangeMe123!)
  WIKI_HOST            Host/IP of Wiki.js (default: localhost)

Network security note:
  Ensure OCI security list allows inbound TCP on port $GATEWAY_PORT (REST API Gateway)
  from your desired CIDR range.
  Wiki.js (port 3000) and PostgreSQL port $PG_PORT are pod-internal only — NOT exposed to the host.
EOF
  exit 1
}

# ─── Image Pull (shared by deploy and update) ─────────────────────────────────
pull_images() {
  echo "Pulling container images (linux/arm64)..."
  podman pull --platform linux/arm64 "$PG_IMAGE" || { echo "ERROR: Failed to pull $PG_IMAGE"; exit 1; }
  podman pull --platform linux/arm64 "$WIKI_IMAGE" || { echo "ERROR: Failed to pull $WIKI_IMAGE"; exit 1; }
  echo "Building gateway image..."
  podman build --platform linux/arm64 -t "$GATEWAY_IMAGE" "$GATEWAY_DIR" || { echo "ERROR: Failed to build gateway image"; exit 1; }
  echo "All images ready."
}

# ─── Start containers (shared by deploy and update) ───────────────────────────
start_containers() {
  # Create pod with port mappings (gateway + wiki.js web UI)
  podman pod create --name "$POD_NAME" \
    -p "${GATEWAY_PORT}:${GATEWAY_PORT}" \
    -p "3000:3000"

  # Start PostgreSQL first
  podman run -d \
    --name "$PG_CONTAINER" \
    --pod "$POD_NAME" \
    --secret "$PG_SECRET",type=env,target=POSTGRES_PASSWORD \
    -e POSTGRES_DB=wiki \
    -e POSTGRES_USER=wiki \
    -v "${PG_VOLUME}:/var/lib/postgresql/data:Z" \
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
    -v "${WIKI_VOLUME}:/wiki/data:Z" \
    "$WIKI_IMAGE"

  # Start REST API Gateway
  local gw_env_args=(
    -e PGHOST=localhost
    -e PGPORT=5432
    -e PGDATABASE=wiki
    -e PGUSER=wiki
    -e WIKI_BASE_URL=http://localhost:3000
    -e SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS:-300000}"
    -e EMBEDDING_MODEL="${EMBEDDING_MODEL:-openai/text-embedding-3-small}"
    -e OPENROUTER_BASE_URL="${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}"
    -e GATEWAY_PORT="${GATEWAY_PORT}"
  )

  # Required secrets
  local gw_secret_args=(
    --secret "$PG_SECRET",type=env,target=PGPASSWORD
    --secret "$OPENROUTER_SECRET",type=env,target=OPENROUTER_API_KEY
  )

  # Add API key secrets (at least one must exist — validated in cmd_deploy)
  if [ -n "${API_KEY_RO:-}" ]; then
    gw_secret_args+=(--secret "$API_KEY_RO_SECRET",type=env,target=API_KEY_RO)
  fi
  if [ -n "${API_KEY_RW:-}" ]; then
    gw_secret_args+=(--secret "$API_KEY_RW_SECRET",type=env,target=API_KEY_RW)
    # Wiki admin token is required when RW key is configured
    gw_secret_args+=(--secret "$ADMIN_TOKEN_SECRET",type=env,target=WIKI_ADMIN_TOKEN)
  fi

  podman run -d \
    --name "$GATEWAY_CONTAINER" \
    --pod "$POD_NAME" \
    "${gw_secret_args[@]}" \
    "${gw_env_args[@]}" \
    "$GATEWAY_IMAGE"
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
  if [ -z "${API_KEY_RO:-}" ] && [ -z "${API_KEY_RW:-}" ]; then
    echo "ERROR: At least one of API_KEY_RO or API_KEY_RW must be set"
    echo "  Example: API_KEY_RO=my-read-key ./scripts/deploy-wikijs.sh deploy"
    exit 1
  fi

  if [ -n "${API_KEY_RW:-}" ] && [ -z "${WIKI_ADMIN_TOKEN:-}" ]; then
    echo "ERROR: WIKI_ADMIN_TOKEN required when API_KEY_RW is set"
    echo "  First deploy with read-only key, then obtain token:"
    echo "  1. API_KEY_RO=my-read-key OPENROUTER_API_KEY=sk-or-v1-... ./scripts/deploy-wikijs.sh deploy"
    echo "  2. eval \$(./scripts/deploy-wikijs.sh get-token)"
    echo "  3. API_KEY_RW=my-write-key WIKI_ADMIN_TOKEN=... ./scripts/deploy-wikijs.sh update"
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

  # Create podman secrets for API keys
  if [ -n "${API_KEY_RO:-}" ]; then
    echo -n "$API_KEY_RO" | podman secret create "$API_KEY_RO_SECRET" - 2>/dev/null || \
      (podman secret rm "$API_KEY_RO_SECRET" && echo -n "$API_KEY_RO" | podman secret create "$API_KEY_RO_SECRET" -)
  fi
  if [ -n "${API_KEY_RW:-}" ]; then
    echo -n "$API_KEY_RW" | podman secret create "$API_KEY_RW_SECRET" - 2>/dev/null || \
      (podman secret rm "$API_KEY_RW_SECRET" && echo -n "$API_KEY_RW" | podman secret create "$API_KEY_RW_SECRET" -)
    echo -n "$WIKI_ADMIN_TOKEN" | podman secret create "$ADMIN_TOKEN_SECRET" - 2>/dev/null || \
      (podman secret rm "$ADMIN_TOKEN_SECRET" && echo -n "$WIKI_ADMIN_TOKEN" | podman secret create "$ADMIN_TOKEN_SECRET" -)
  fi

  # Verify bind mount directories exist on block volume
  if [ ! -d "$PG_VOLUME" ] || [ ! -d "$WIKI_VOLUME" ]; then
    echo "ERROR: Bind mount directories not found."
    echo "  Expected: $PG_VOLUME and $WIKI_VOLUME"
    echo "  Run setup-block-volume.sh first (from oci-infra repo)."
    exit 1
  fi

  # Create pod and start containers
  start_containers

  # Generate systemd unit for auto-start on boot
  cmd_systemd

  echo ""
  echo "=== Wiki.js deployed successfully ==="
  echo "  Gateway: http://localhost:${GATEWAY_PORT}"
  echo ""
  echo "  Admin email:    ${WIKI_ADMIN_EMAIL:-admin@wiki.local}"
  echo "  Admin password: ${WIKI_ADMIN_PASSWORD:-ChangeMe123!}"
  echo ""
  echo "  Embedding Model: ${EMBEDDING_MODEL:-openai/text-embedding-3-small}"
  echo "  API_KEY_RO: ${API_KEY_RO:+(set)}"
  echo "  API_KEY_RW: ${API_KEY_RW:+(set)}"
  echo ""
  # Warn if using default admin password
  if [ "${WIKI_ADMIN_PASSWORD:-}" = "ChangeMe123!" ] || [ -z "${WIKI_ADMIN_PASSWORD:-}" ]; then
    echo "  ⚠️  WARNING: Using default admin password. Set WIKI_ADMIN_PASSWORD before deploying to production."
    echo "  Example: WIKI_ADMIN_PASSWORD=MySecurePass123! ./scripts/deploy-wikijs.sh deploy"
  fi

  # Inform about access tier
  if [ -n "${API_KEY_RW:-}" ]; then
    echo "  ⚠️  Read-write API key configured. Gateway can create/update/delete pages."
  else
    echo "  ℹ️  Read-only API key configured. Gateway provides read-only access."
    echo "  To enable writes: Set API_KEY_RW and WIKI_ADMIN_TOKEN"
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
  podman rm "$PG_CONTAINER" "$WIKI_CONTAINER" "$GATEWAY_CONTAINER"
  echo "Removing pod..."
  podman pod rm "$POD_NAME"

  # Recreate pod and start containers (reuses existing volumes and secret)
  start_containers

  echo ""
  echo "=== Wiki.js updated successfully ==="
  echo "  Gateway: http://localhost:${GATEWAY_PORT}"
}

cmd_logs() {
  local container="${2:-$WIKI_CONTAINER}"
  echo "Tailing logs for $container (Ctrl+C to stop)..."
  podman logs -f "$container"
}

cmd_destroy() {
  echo "=== Destroying Wiki.js pod (volumes preserved) ==="
  podman pod stop "$POD_NAME" 2>/dev/null || true
  podman rm "$PG_CONTAINER" "$WIKI_CONTAINER" "$GATEWAY_CONTAINER" 2>/dev/null || true
  podman pod rm "$POD_NAME" 2>/dev/null || true
  echo "Pod and containers removed. Data preserved on block volume ($PG_VOLUME, $WIKI_VOLUME)."
}

cmd_get_token() {
  local wiki_host="${WIKI_HOST:-localhost}"
  local wiki_url="http://${wiki_host}:3000/graphql"
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
Add the following INGRESS rule to your OCI VCN security list:

  Protocol: TCP
  Source CIDR: <your-ip>/32  (restrict to agent hosts only)
  Destination Port: ${GATEWAY_PORT}   → REST API Gateway
  Description: Wiki REST API Gateway access

IMPORTANT: Wiki.js (port 3000) and PostgreSQL port ${PG_PORT} are pod-internal only — do NOT add rules for them.

To add rules via OCI CLI:
  oci network security-list update \\
    --security-list-id <your-security-list-ocid> \\
    --ingress-security-rules '[
      {"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":${GATEWAY_PORT},"max":${GATEWAY_PORT}}},"isStateless":false,"description":"Wiki REST API Gateway"}
    ]'

Or update via Terraform by adding gateway_port=${GATEWAY_PORT} to the
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
