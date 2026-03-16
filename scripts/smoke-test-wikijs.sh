#!/usr/bin/env bash
# smoke-test-wikijs.sh — End-to-end smoke test for the Wiki.js + MCP stack on OCI
#
# Usage:
#   WIKI_ADMIN_TOKEN=<jwt> ./scripts/smoke-test-wikijs.sh <instance-ip>
#   # Or let the script obtain a token automatically:
#   WIKI_ADMIN_EMAIL=admin@wiki.local WIKI_ADMIN_PASSWORD=ChangeMe123! \
#     ./scripts/smoke-test-wikijs.sh <instance-ip>
#
#   # When running ON the server itself (port not exposed externally):
#   WIKI_HOST=localhost WIKI_ADMIN_EMAIL=admin@wiki.local WIKI_ADMIN_PASSWORD=ChangeMe123! \
#     ./scripts/smoke-test-wikijs.sh <instance-ip>
#
# Prerequisites:
#   - curl, jq installed locally
#   - SSH key at ~/.ssh/oci_agent_coder with access to opc@<instance-ip>
#   - Wiki.js stack deployed and running on the instance
#
# Exit codes:
#   0 — all checks passed (PASS)
#   1 — one or more checks failed (FAIL)

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
INSTANCE_IP="${1:-}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/oci_agent_coder}"
SSH_USER="${SSH_USER:-opc}"
WIKI_PORT="${WIKI_PORT:-3000}"
# WIKI_HOST overrides the HTTP host for GraphQL/curl calls (use 'localhost' when
# running the script directly on the OCI instance where the port isn't exposed externally)
WIKI_HTTP_HOST="${WIKI_HOST:-${INSTANCE_IP}}"
WIKI_BASE_URL="http://${WIKI_HTTP_HOST}:${WIKI_PORT}"
GRAPHQL_URL="${WIKI_BASE_URL}/graphql"
WIKI_ADMIN_EMAIL="${WIKI_ADMIN_EMAIL:-admin@wiki.local}"
WIKI_ADMIN_PASSWORD="${WIKI_ADMIN_PASSWORD:-ChangeMe123!}"
MAX_WAIT_SECONDS=360   # 6 minutes for sync pipeline
POLL_INTERVAL=10       # poll every 10 seconds

# Container names (must match deploy-wikijs.sh)
PG_CONTAINER="wikijs-postgres"
MCP_CONTAINER="wikijs-mcp"

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── Helpers ──────────────────────────────────────────────────────────────────
log()  { echo -e "${CYAN}[smoke]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }

# Run a command on the remote host; redirect to temp file to avoid WSL stdout swallowing
ssh_run() {
  local tmpfile
  tmpfile=$(mktemp /tmp/smoke-ssh-XXXXXX)
  ssh -i "$SSH_KEY" \
      -o StrictHostKeyChecking=no \
      -o ConnectTimeout=15 \
      -o BatchMode=yes \
      "${SSH_USER}@${INSTANCE_IP}" "$@" > "$tmpfile" 2>&1
  local rc=$?
  cat "$tmpfile"
  rm -f "$tmpfile"
  return $rc
}

# Unauthenticated GraphQL call
graphql() {
  curl -s --max-time 15 -X POST "$GRAPHQL_URL" \
    -H "Content-Type: application/json" \
    -d "$1"
}

# Authenticated GraphQL call
graphql_auth() {
  curl -s --max-time 15 -X POST "$GRAPHQL_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${WIKI_ADMIN_TOKEN}" \
    -d "$1"
}

# ─── Result tracking ──────────────────────────────────────────────────────────
RESULTS=()
OVERALL_PASS=true
START_TIME=$(date +%s)

record() {
  local label="$1"
  local status="$2"   # PASS or FAIL
  local detail="${3:-}"
  RESULTS+=("${status}|${label}|${detail}")
  if [[ "$status" == "FAIL" ]]; then
    OVERALL_PASS=false
    echo -e "${RED}[FAIL]${NC} ${label}${detail:+  → ${detail}}"
  else
    echo -e "${GREEN}[PASS]${NC} ${label}${detail:+  (${detail})}"
  fi
}

print_summary() {
  local end_time
  end_time=$(date +%s)
  local elapsed=$(( end_time - START_TIME ))

  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  Wiki.js MCP Smoke Test Summary"
  printf "  Instance: %-20s  Elapsed: %ds\n" "${INSTANCE_IP}" "${elapsed}"
  echo "════════════════════════════════════════════════════════"
  for entry in "${RESULTS[@]}"; do
    local status="${entry%%|*}"
    local rest="${entry#*|}"
    local label="${rest%%|*}"
    local detail="${rest#*|}"
    if [[ "$status" == "PASS" ]]; then
      echo -e "  ${GREEN}✓${NC} ${label}${detail:+  (${detail})}"
    else
      echo -e "  ${RED}✗${NC} ${label}${detail:+  → ${detail}}"
    fi
  done
  echo "────────────────────────────────────────────────────────"
  if [[ "$OVERALL_PASS" == "true" ]]; then
    echo -e "  ${GREEN}OVERALL: PASS${NC}"
  else
    echo -e "  ${RED}OVERALL: FAIL${NC}"
  fi
  echo "════════════════════════════════════════════════════════"
}

# ─── Argument validation ──────────────────────────────────────────────────────
if [[ -z "$INSTANCE_IP" ]]; then
  echo "Usage: $0 <instance-ip>"
  echo ""
  echo "Environment variables:"
  echo "  WIKI_ADMIN_TOKEN     JWT token (skip login if set)"
  echo "  WIKI_ADMIN_EMAIL     Admin email    (default: admin@wiki.local)"
  echo "  WIKI_ADMIN_PASSWORD  Admin password (default: ChangeMe123!)"
  echo "  SSH_KEY              SSH key path   (default: ~/.ssh/oci_agent_coder)"
  echo "  SSH_USER             SSH user       (default: opc)"
  exit 1
fi

log "Starting smoke test against ${INSTANCE_IP}"
log "Wiki.js URL: ${WIKI_BASE_URL}"

# ─── Step 1: Obtain admin token ───────────────────────────────────────────────
log ""
log "Step 1: Obtaining Wiki.js admin token..."

if [[ -z "${WIKI_ADMIN_TOKEN:-}" ]]; then
  log "  Authenticating with ${WIKI_ADMIN_EMAIL}..."
  AUTH_RESPONSE=$(graphql '{
    "query": "mutation($u:String!,$p:String!){authentication{login(username:$u,password:$p,strategy:\"local\"){responseResult{succeeded,message}jwt}}}",
    "variables": {"u": "'"${WIKI_ADMIN_EMAIL}"'", "p": "'"${WIKI_ADMIN_PASSWORD}"'"}
  }')

  WIKI_ADMIN_TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.data.authentication.login.jwt // empty' 2>/dev/null || true)
  AUTH_OK=$(echo "$AUTH_RESPONSE" | jq -r '.data.authentication.login.responseResult.succeeded // false' 2>/dev/null || echo "false")

  if [[ -z "$WIKI_ADMIN_TOKEN" || "$AUTH_OK" != "true" ]]; then
    AUTH_MSG=$(echo "$AUTH_RESPONSE" | jq -r '.data.authentication.login.responseResult.message // "unknown"' 2>/dev/null || echo "parse error")
    record "Obtain admin token" "FAIL" "Auth failed: ${AUTH_MSG}"
    print_summary
    exit 1
  fi
  log "  Token obtained."
else
  log "  Using provided WIKI_ADMIN_TOKEN."
fi
record "Obtain admin token" "PASS"

# ─── Step 2: Create test page ─────────────────────────────────────────────────
log ""
log "Step 2: Creating test wiki page..."

TEST_UNIQUE="smoketest-$(date +%s)"
TEST_TITLE="Smoke Test Page ${TEST_UNIQUE}"
TEST_PATH="smoke-test/${TEST_UNIQUE}"
TEST_CONTENT="# Smoke Test Page

This is an automated smoke test page created at $(date -u +%Y-%m-%dT%H:%M:%SZ).

## Unique Identifier

The unique token for this test run is: ${TEST_UNIQUE}

## Purpose

This page verifies the end-to-end pipeline: Wiki.js creation → embedding sync → pgvector indexing → MCP semantic search.

If you see this page in the wiki, the smoke test cleanup may have failed. It is safe to delete."

# Build the GraphQL mutation payload using jq to handle escaping safely
CREATE_PAYLOAD=$(jq -n \
  --arg content "$TEST_CONTENT" \
  --arg title "$TEST_TITLE" \
  --arg path "$TEST_PATH" \
  '{
    query: "mutation($content:String!,$description:String!,$editor:String!,$isPublished:Boolean!,$isPrivate:Boolean!,$locale:String!,$path:String!,$tags:[String]!,$title:String!){pages{create(content:$content,description:$description,editor:$editor,isPublished:$isPublished,isPrivate:$isPrivate,locale:$locale,path:$path,tags:$tags,title:$title){responseResult{succeeded,errorCode,message}page{id,path,title}}}}",
    variables: {
      content: $content,
      description: "Automated smoke test page",
      editor: "markdown",
      isPublished: true,
      isPrivate: false,
      locale: "en",
      path: $path,
      tags: ["smoke-test"],
      title: $title
    }
  }')

CREATE_RESPONSE=$(graphql_auth "$CREATE_PAYLOAD")
CREATE_OK=$(echo "$CREATE_RESPONSE" | jq -r '.data.pages.create.responseResult.succeeded // false' 2>/dev/null || echo "false")
PAGE_ID=$(echo "$CREATE_RESPONSE" | jq -r '.data.pages.create.page.id // empty' 2>/dev/null || true)

if [[ "$CREATE_OK" != "true" || -z "$PAGE_ID" ]]; then
  CREATE_MSG=$(echo "$CREATE_RESPONSE" | jq -r '.data.pages.create.responseResult.message // "unknown"' 2>/dev/null || echo "parse error")
  record "Create test page" "FAIL" "GraphQL: ${CREATE_MSG}"
  print_summary
  exit 1
fi

log "  Created page id=${PAGE_ID} path=${TEST_PATH}"
record "Create test page" "PASS" "id=${PAGE_ID}"

# ─── Step 3: Wait for embedding sync ─────────────────────────────────────────
log ""
log "Step 3: Waiting for MCP sync pipeline to index page (up to ${MAX_WAIT_SECONDS}s)..."

INDEXED=false
WAIT_START=$(date +%s)
CHUNK_COUNT=0

while true; do
  NOW=$(date +%s)
  ELAPSED_WAIT=$(( NOW - WAIT_START ))

  if (( ELAPSED_WAIT >= MAX_WAIT_SECONDS )); then
    break
  fi

  # Poll the DB via SSH → podman exec into the postgres container
  DB_RESULT=$(ssh_run \
    "podman exec ${PG_CONTAINER} psql -U wiki -d wiki -t -c \
     \"SELECT COUNT(*) FROM wiki_embeddings WHERE page_id = ${PAGE_ID};\" 2>/dev/null" \
    2>/dev/null || echo "0")
  CHUNK_COUNT=$(echo "$DB_RESULT" | tr -d '[:space:]' | grep -E '^[0-9]+$' | head -1 || echo "0")
  CHUNK_COUNT="${CHUNK_COUNT:-0}"

  if [[ "$CHUNK_COUNT" -gt 0 ]]; then
    INDEXED=true
    log "  Indexed: ${CHUNK_COUNT} chunk(s) found after ${ELAPSED_WAIT}s"
    break
  fi

  log "  Waiting... ${ELAPSED_WAIT}s elapsed (no embeddings yet for page_id=${PAGE_ID})"
  sleep "$POLL_INTERVAL"
done

if [[ "$INDEXED" == "true" ]]; then
  record "Embedding sync (index page)" "PASS" "${CHUNK_COUNT} chunk(s) in ${ELAPSED_WAIT:-?}s"
else
  record "Embedding sync (index page)" "FAIL" "Not indexed after ${MAX_WAIT_SECONDS}s"
fi

# ─── Step 4: MCP search_wiki via podman exec ──────────────────────────────────
log ""
log "Step 4: Testing MCP search_wiki tool..."

if [[ "$INDEXED" == "true" ]]; then
  # Run a Node.js snippet inside the MCP container (which has all deps at /app)
  # The container has access to localhost:5432 (same pod network)
  SEARCH_SCRIPT=$(cat <<'NODESCRIPT'
import { searchWiki } from '/app/src/tools.js';
import pg from 'pg';
const { Client } = pg;
const client = new Client({
  host: 'localhost', port: 5432,
  database: 'wiki', user: 'wiki',
  password: process.env.PGPASSWORD,
});
await client.connect();
const results = await searchWiki(client, 'http://localhost:3000', {
  query: process.env.SEARCH_QUERY,
  top_k: 5
});
await client.end();
console.log(JSON.stringify(results));
NODESCRIPT
)

  SEARCH_RESULT=$(ssh_run \
    "PGPASSWORD=\$(podman exec ${PG_CONTAINER} printenv POSTGRES_PASSWORD 2>/dev/null) \
     SEARCH_QUERY='${TEST_UNIQUE}' \
     podman exec \
       -e PGPASSWORD=\"\$PGPASSWORD\" \
       -e SEARCH_QUERY='${TEST_UNIQUE}' \
       ${MCP_CONTAINER} \
       node --input-type=module <<'NODESCRIPT'
${SEARCH_SCRIPT}
NODESCRIPT
    " 2>/dev/null || echo "[]")

  # Check if test page appears in results (by page_id or unique token in chunk_text)
  FOUND_BY_ID=$(echo "$SEARCH_RESULT" | jq -e --argjson id "$PAGE_ID" \
    'if type == "array" then map(select(.page_id == $id)) | length else 0 end' 2>/dev/null || echo "0")
  FOUND_BY_TOKEN=$(echo "$SEARCH_RESULT" | jq -e --arg token "$TEST_UNIQUE" \
    'if type == "array" then map(select(.chunk_text // "" | contains($token))) | length else 0 end' 2>/dev/null || echo "0")

  if [[ "$FOUND_BY_ID" -gt 0 || "$FOUND_BY_TOKEN" -gt 0 ]]; then
    RELEVANCE=$(echo "$SEARCH_RESULT" | jq -r --argjson id "$PAGE_ID" \
      '[.[] | select(.page_id == $id) | .relevance_score][0] // "?"' 2>/dev/null || echo "?")
    record "MCP search_wiki finds test page" "PASS" "relevance=${RELEVANCE}"
  else
    RESULT_PREVIEW=$(echo "$SEARCH_RESULT" | jq -c '.[0:2]' 2>/dev/null || echo "${SEARCH_RESULT:0:150}")
    record "MCP search_wiki finds test page" "FAIL" "page_id=${PAGE_ID} not found. Got: ${RESULT_PREVIEW}"
  fi
else
  record "MCP search_wiki finds test page" "FAIL" "skipped — page was not indexed"
fi

# ─── Step 5: MCP get_wiki_page via podman exec ────────────────────────────────
log ""
log "Step 5: Testing MCP get_wiki_page tool..."

if [[ "$INDEXED" == "true" ]]; then
  GET_SCRIPT=$(cat <<'NODESCRIPT'
import { getWikiPage } from '/app/src/tools.js';
const result = await getWikiPage('http://localhost:3000', {
  page_id: parseInt(process.env.PAGE_ID, 10)
});
console.log(JSON.stringify(result));
NODESCRIPT
)

  GET_RESULT=$(ssh_run \
    "PAGE_ID='${PAGE_ID}' \
     podman exec \
       -e PAGE_ID='${PAGE_ID}' \
       ${MCP_CONTAINER} \
       node --input-type=module <<'NODESCRIPT'
${GET_SCRIPT}
NODESCRIPT
    " 2>/dev/null || echo '{"error":"ssh/exec failed"}')

  # Verify the returned content contains our unique token
  CONTENT_OK=$(echo "$GET_RESULT" | jq -e --arg token "$TEST_UNIQUE" \
    '(.content // "") | contains($token)' 2>/dev/null || echo "false")

  if [[ "$CONTENT_OK" == "true" ]]; then
    RETURNED_TITLE=$(echo "$GET_RESULT" | jq -r '.title // "?"' 2>/dev/null || echo "?")
    record "MCP get_wiki_page returns correct content" "PASS" "title=${RETURNED_TITLE}"
  else
    GET_ERR=$(echo "$GET_RESULT" | jq -r '.error // "content mismatch or missing unique token"' 2>/dev/null || echo "parse error")
    record "MCP get_wiki_page returns correct content" "FAIL" "${GET_ERR}"
  fi
else
  record "MCP get_wiki_page returns correct content" "FAIL" "skipped — page was not indexed"
fi

# ─── Step 6: Cleanup — delete test page ──────────────────────────────────────
log ""
log "Step 6: Cleaning up test page (id=${PAGE_ID})..."

DELETE_PAYLOAD=$(jq -n --argjson id "$PAGE_ID" '{
  query: "mutation($id:Int!){pages{delete(id:$id){responseResult{succeeded,message}}}}",
  variables: {id: $id}
}')

DELETE_RESPONSE=$(graphql_auth "$DELETE_PAYLOAD")
DELETE_OK=$(echo "$DELETE_RESPONSE" | jq -r '.data.pages.delete.responseResult.succeeded // false' 2>/dev/null || echo "false")

if [[ "$DELETE_OK" == "true" ]]; then
  log "  Test page deleted."
  record "Cleanup (delete test page)" "PASS"
else
  DELETE_MSG=$(echo "$DELETE_RESPONSE" | jq -r '.data.pages.delete.responseResult.message // "unknown"' 2>/dev/null || echo "parse error")
  warn "  Failed to delete test page: ${DELETE_MSG}"
  record "Cleanup (delete test page)" "FAIL" "${DELETE_MSG}"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
print_summary

if [[ "$OVERALL_PASS" == "true" ]]; then
  exit 0
else
  exit 1
fi
