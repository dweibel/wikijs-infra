# Testing Guide — Wiki REST API Gateway

This document covers the testing strategy for the Wiki REST API Gateway: unit tests, property-based tests, integration tests, and the OCI smoke test.

---

## Unit Tests

Unit tests cover core business logic (chunker, embeddings, db, wiki-client, sync, tools) and gateway-specific components (auth middleware, routes, config validation). They run in-process with mocked dependencies — no containers or network required.

### Prerequisites

- Node.js 20+
- `npm install` completed in `services/wiki-api-gateway/`

### Run

```bash
cd services/wiki-api-gateway
npm test
# or single run (no watch):
npm test -- --run
```

### Key test files

| File | What it tests |
|------|---------------|
| `src/chunker.test.js` | Text chunking logic |
| `src/db.test.js` | Database operations (mocked) |
| `src/embeddings.test.js` | OpenRouter embedding client (mocked) |
| `src/wiki-client.test.js` | Wiki.js GraphQL client (mocked) |
| `src/sync.test.js` | Sync pipeline logic |
| `src/tools.test.js` | Business logic handlers (search, CRUD) |
| `src/config.test.js` | Configuration loading and validation |
| `src/middleware/auth.test.js` | API key authentication and access tiers |

---

## Property-Based Tests

Property-based tests use `fast-check` to validate correctness properties with randomly generated inputs (50–100 iterations per property). These verify that the REST API gateway behaves correctly across the full input space.

### Run

```bash
cd services/wiki-api-gateway
npm test -- src/*.property.test.js src/**/*.property.test.js
```

### Key test files

| File | Properties tested |
|------|-------------------|
| `src/middleware/auth.property.test.js` | Auth enforcement, access tier enforcement |
| `src/routes/response.property.test.js` | Response shapes, Content-Type headers, error structure |
| `src/routes/validation.property.test.js` | Invalid `:id` → 400, missing fields → 400 |
| `src/routes/create.property.test.js` | Optional field forwarding on page creation |
| `src/server.property.test.js` | Unhandled exception safety |
| `src/tools.property.test.js` | Write operation round-trips |
| `src/sync.property.test.js` | Sync pipeline error resilience |
| `src/sync.resilience.property.test.js` | Sync resilience under failures |
| `src/embeddings.property.test.js` | Embedding dimension correctness |
| `src/index.property.test.js` | Startup configuration validation |
| `src/health.property.test.js` | Health endpoint properties |
| `src/deploy.property.test.js` | Deployment configuration properties |
| `src/json.property.test.js` | JSON utility correctness |

---

## Integration Tests

Integration tests spin up a real `pgvector/pgvector:pg16` container via `testcontainers` and run the database layer, search pipeline, and chunker round-trip against it.

### Prerequisites

- Podman (or Docker) installed and running
- The `pgvector/pgvector:pg16` image for `linux/arm64`:
  ```bash
  podman pull --platform linux/arm64 docker.io/pgvector/pgvector:pg16
  ```
- Node.js 20+
- `npm install` completed

### Run

```bash
cd services/wiki-api-gateway
npm run test:integration
```

### Test files

| File | What it tests |
|------|---------------|
| `src/integration/db.integration.test.js` | upsert, delete, search operations against real PostgreSQL |
| `src/integration/search-pipeline.integration.test.js` | End-to-end search through tools.js → db.js → PostgreSQL |
| `src/integration/chunker-db-roundtrip.integration.test.js` | Chunk → store → search → delete round-trip |

---

---

## wiki-cli Tests

The `wiki-cli` Go tool has its own test suite using Go's standard `testing` package, `testing/quick` for property-based tests, and `net/http/httptest` for HTTP mocking.

### Prerequisites

- Go 1.21+

### Run

```bash
cd services/wiki-cli
go test ./...
```

### Test organization

| Package | What it tests |
|---------|---------------|
| `config/config_test.go` | Config loading, env var parsing, URL validation |
| `client/client_test.go` | HTTP client, retry logic, error handling |
| `commands/*_test.go` | Per-command argument parsing, request construction, write gate |
| `main_test.go` | Entry point dispatch, no-args handling, unknown commands |

### Property-based tests

Property tests use `testing/quick` (Go stdlib) and validate 15 correctness properties defined in the design document. They cover config parsing, request construction, write gate enforcement, JSON passthrough, help system content, and error message formatting.

---

## OCI Smoke Test

The smoke test validates the full end-to-end stack on a live OCI deployment: page creation via Wiki.js GraphQL → sync pipeline indexes page → gateway search returns results → gateway get page returns content → cleanup.

### Prerequisites

- Deployed OCI instance running the Wiki.js stack
- SSH access: key at `~/.ssh/oci_agent_coder`, user `opc`
- `curl` and `jq` installed locally
- Wiki.js admin credentials

### Run

```bash
# Obtain admin token
eval $(./scripts/deploy-wikijs.sh get-token)

# Run smoke test
./scripts/smoke-test-wikijs.sh <instance-ip>
```

### What it does

1. Authenticates with Wiki.js and obtains a JWT
2. Creates a test page with a unique identifier via the GraphQL API
3. Polls PostgreSQL every 10 seconds (up to 6 minutes) until the sync pipeline indexes the page
4. Runs search via the gateway's tools.js inside the container and verifies the test page appears
5. Runs get page via tools.js and verifies content contains the unique identifier
6. Deletes the test page via GraphQL (cleanup)
7. Prints a PASS/FAIL summary

### Expected output

```
[smoke] Starting smoke test against 1.2.3.4
[smoke] Wiki.js URL: http://1.2.3.4:3000

[PASS] Obtain admin token
[PASS] Create test page  (id=42)
[PASS] Embedding sync (index page)  (3 chunk(s) in 30s)
[PASS] MCP search_wiki finds test page  (relevance=0.87)
[PASS] MCP get_wiki_page returns correct content
[PASS] Cleanup (delete test page)

════════════════════════════════════════════════════════
  Wiki.js MCP Smoke Test Summary
  Instance: 1.2.3.4               Elapsed: 45s
════════════════════════════════════════════════════════
  ✓ Obtain admin token
  ✓ Create test page
  ✓ Embedding sync (index page)
  ✓ search_wiki finds test page
  ✓ get_wiki_page returns correct content
  ✓ Cleanup (delete test page)
────────────────────────────────────────────────────────
  OVERALL: PASS
════════════════════════════════════════════════════════
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WIKI_ADMIN_TOKEN` | — | Pre-obtained JWT (skips login step) |
| `WIKI_ADMIN_EMAIL` | `admin@wiki.local` | Admin email for login |
| `WIKI_ADMIN_PASSWORD` | `ChangeMe123!` | Admin password for login |
| `SSH_KEY` | `~/.ssh/oci_agent_coder` | SSH private key path |
| `SSH_USER` | `opc` | SSH username |
| `WIKI_PORT` | `3000` | Wiki.js HTTP port |

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Auth failed | Wrong email/password | Check `WIKI_ADMIN_EMAIL` / `WIKI_ADMIN_PASSWORD` |
| GraphQL error on create | Wiki.js not fully started | Wait ~60s after deploy and retry |
| Sync times out (360s) | Sync pipeline not running | Check `podman logs wikijs-gateway` |
| Search returns empty | Embedding generation failed | Check gateway logs for OpenRouter errors |
| SSH connection refused | Wrong IP or firewall | Verify instance IP and security list |
