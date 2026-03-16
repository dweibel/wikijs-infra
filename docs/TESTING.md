# Testing Guide — Wiki.js MCP Server

This document covers how to run the three levels of tests for the Wiki.js MCP server:
unit tests, integration tests (local containers), and the OCI smoke test (live deployment).

---

## Unit Tests

Unit tests cover the core business logic modules (chunker, embeddings, db, wiki-client, sync, tools).
They run entirely in-process with mocked dependencies — no containers or network required.

### Prerequisites

- Node.js 20+
- `npm install` completed in `services/wiki-mcp-server/`

### Run

```bash
cd services/wiki-mcp-server
npm test
# or for a single run (no watch mode):
npm test -- --run
```

### Expected output

```
✓ src/chunker.test.js (8 tests)
✓ src/db.test.js (6 tests)
✓ src/embeddings.test.js (4 tests)
✓ src/wiki-client.test.js (5 tests)
✓ src/sync.test.js (7 tests)
✓ src/tools.test.js (6 tests)

Test Files  6 passed (6)
Tests      36 passed (36)
```

---

## Integration Tests (local containers)

Integration tests spin up a real `pgvector/pgvector:pg16` container via `testcontainers` and run
the database layer, search pipeline, and chunker round-trip against it. Only Amazon Bedrock is
mocked — all other I/O uses real containers.

### Prerequisites

- **Podman** (or Docker) installed and running locally
- The `pgvector/pgvector:pg16` image available for `linux/arm64`:
  ```bash
  podman pull --platform linux/arm64 docker.io/pgvector/pgvector:pg16
  ```
- Node.js 20+
- `npm install` completed (includes `testcontainers` devDependency)

### Run

```bash
cd services/wiki-mcp-server
npm run test:integration
```

This uses `vitest.integration.config.js` with a 60-second timeout per test.

### Test files

| File | What it tests |
|------|---------------|
| `src/integration/db.integration.test.js` | `upsertEmbeddings`, `deletePageEmbeddings`, `searchSimilar`, upsert idempotency |
| `src/integration/search-pipeline.integration.test.js` | End-to-end `searchWiki` through `tools.js` → `db.js` → real PostgreSQL |
| `src/integration/chunker-db-roundtrip.integration.test.js` | Chunk → store → search → delete round-trip |

### Expected output

```
✓ src/integration/db.integration.test.js (5 tests) 8234ms
✓ src/integration/search-pipeline.integration.test.js (4 tests) 5102ms
✓ src/integration/chunker-db-roundtrip.integration.test.js (3 tests) 6891ms

Test Files  3 passed (3)
Tests      12 passed (12)
```

> Note: First run may be slower while testcontainers pulls the pgvector image.

---

## Property-Based Tests

Property-based tests use `fast-check` to validate correctness properties with randomly generated inputs (50-100 iterations per property).

### Prerequisites

- Same as unit tests
- `fast-check` installed (included in devDependencies)

### Run

```bash
cd services/wiki-mcp-server
npm test -- src/*.property.test.js
# or run all tests (includes property tests):
npm test
```

### Test files

| File | What it tests |
|------|---------------|
| `src/tools.property.test.js` | Write operation properties (create, update, delete, move round-trips) |
| `src/sync.property.test.js` | Embedding sync processes all page changes |
| `src/embeddings.property.test.js` | All embeddings have correct dimensions (1536) |
| `src/index.property.test.js` | Write tools only registered when enabled |

### Expected output

```
✓ src/tools.property.test.js (4 properties) 12345ms
  ✓ property: page creation round-trip (100 runs)
  ✓ property: page update round-trip (100 runs)
  ✓ property: page deletion removes content (100 runs)
  ✓ property: move operation preserves content (100 runs)
✓ src/sync.property.test.js (1 property) 8901ms
  ✓ property: embedding sync processes changes (50 runs)
✓ src/embeddings.property.test.js (1 property) 5678ms
  ✓ property: all embeddings have 1536 dimensions (100 runs)
✓ src/index.property.test.js (1 property) 3456ms
  ✓ property: write tools conditional registration (100 runs)

Test Files  4 passed (4)
Tests       7 passed (7)
```

---

## Write Operations Tests

Tests for write operation tools (create, update, delete, move).

### Prerequisites

- Node.js 20+
- `npm install` completed
- Write operations enabled in test environment

### Run

```bash
cd services/wiki-mcp-server
npm test -- src/tools.test.js
```

### Test coverage

Write operation tests in `src/tools.test.js`:

| Tool | Unit Tests | Property Tests |
|------|-----------|----------------|
| `createWikiPage` | 5 tests | 1 property (round-trip) |
| `updateWikiPage` | 5 tests | 1 property (round-trip) |
| `deleteWikiPage` | 4 tests | 1 property (removes content) |
| `moveWikiPage` | 3 tests | 1 property (preserves content) |

### Example test cases

**Create Page**:
```javascript
it('creates page successfully with all parameters', async () => {
  const result = await createWikiPage(wikiBaseUrl, token, {
    title: 'Test Page',
    path: '/test-page',
    content: '# Test\n\nContent here',
    description: 'Test description',
    tags: ['test', 'example'],
    is_published: true,
    is_private: false,
  });
  
  expect(result.success).toBe(true);
  expect(result.page_id).toBeTypeOf('number');
  expect(result.path).toBe('/test-page');
});
```

**Update Page**:
```javascript
it('updates page content successfully', async () => {
  const result = await updateWikiPage(wikiBaseUrl, token, {
    page_id: 42,
    content: 'Updated content',
  });
  
  expect(result.success).toBe(true);
  expect(result.updated_at).toBeDefined();
});
```

**Delete Page**:
```javascript
it('deletes page successfully', async () => {
  const result = await deleteWikiPage(wikiBaseUrl, token, {
    page_id: 42,
  });
  
  expect(result.success).toBe(true);
  expect(result.page_id).toBe(42);
});
```

**Move Page**:
```javascript
it('moves page to new path', async () => {
  const result = await moveWikiPage(wikiBaseUrl, token, {
    page_id: 42,
    destination_path: '/new-path',
  });
  
  expect(result.success).toBe(true);
  expect(result.old_path).toBeDefined();
  expect(result.new_path).toBe('/new-path');
});
```

---

## OCI Smoke Test (post-deploy)

The smoke test validates the full end-to-end stack on a live OCI deployment:

**Read-Only Mode**:
```
Wiki.js GraphQL API → MCP sync pipeline indexes pages
  → MCP search_wiki returns results
    → MCP get_wiki_page returns correct content
```

**Read-Write Mode**:
```
MCP create_wiki_page → Wiki.js creates page
  → MCP sync pipeline indexes page
    → MCP search_wiki finds the page
      → MCP update_wiki_page modifies content
        → MCP move_wiki_page changes path
          → MCP delete_wiki_page removes page
            → cleanup complete
```

### Prerequisites

- A deployed OCI instance running the Wiki.js stack (see `scripts/deploy-wikijs.sh`)
- SSH access: key at `~/.ssh/oci_agent_coder`, user `opc`
- `curl` and `jq` installed locally
- Wiki.js admin credentials

### Obtain an admin token

```bash
# Obtain a JWT and export it for the smoke test
eval $(./scripts/deploy-wikijs.sh get-token)
# With custom credentials or remote host:
WIKI_HOST=<instance-ip> \
WIKI_ADMIN_EMAIL=admin@wiki.local \
WIKI_ADMIN_PASSWORD=MySecurePass123! \
  eval $(./scripts/deploy-wikijs.sh get-token)

echo "Token: ${WIKI_ADMIN_TOKEN:0:20}..."
```

### Run the smoke test

**Read-Only Mode**:
```bash
# Test search and retrieval only
./scripts/smoke-test-wikijs.sh <instance-ip>
```

**Read-Write Mode**:
```bash
# Using a pre-obtained token:
ENABLE_WRITE_OPERATIONS=true \
WIKI_ADMIN_TOKEN="$WIKI_ADMIN_TOKEN" \
  ./scripts/smoke-test-wikijs.sh <instance-ip>

# Or let the script authenticate automatically:
ENABLE_WRITE_OPERATIONS=true \
WIKI_ADMIN_EMAIL=admin@wiki.local \
WIKI_ADMIN_PASSWORD=MySecurePass123! \
  ./scripts/smoke-test-wikijs.sh <instance-ip>
```

### What it does

**Read-Only Mode** (`ENABLE_WRITE_OPERATIONS=false` or not set):
1. Authenticates with Wiki.js and obtains a JWT (or uses `WIKI_ADMIN_TOKEN`)
2. Creates a test page with a unique identifier via the GraphQL API
3. Polls the PostgreSQL database via SSH every 10 seconds (up to 6 minutes) until the MCP sync pipeline has indexed the page
4. Runs `search_wiki` inside the MCP container via `podman exec` and asserts the test page appears in results
5. Runs `get_wiki_page` inside the MCP container and asserts the content contains the unique identifier
6. Deletes the test page via the GraphQL API (cleanup)
7. Prints a PASS/FAIL summary with timing

**Read-Write Mode** (`ENABLE_WRITE_OPERATIONS=true`):
1. Authenticates with Wiki.js and obtains a JWT
2. Tests `create_wiki_page` MCP tool to create a test page
3. Waits for sync pipeline to index the page (up to 6 minutes)
4. Tests `search_wiki` to find the created page
5. Tests `get_wiki_page` to retrieve page content
6. Tests `update_wiki_page` to modify page content
7. Tests `move_wiki_page` to change page path
8. Tests `delete_wiki_page` to remove the page
9. Verifies embeddings are removed after deletion
10. Prints a PASS/FAIL summary with timing for all operations

### Expected output

**Read-Only Mode**:
```
[smoke] Starting smoke test against 1.2.3.4
[smoke] Wiki.js URL: http://1.2.3.4:3000
[smoke] Mode: Read-Only

[smoke] Step 1: Obtaining Wiki.js admin token...
[smoke]   Token obtained.
[PASS] Obtain admin token

[smoke] Step 2: Creating test wiki page via GraphQL...
[smoke]   Created page id=42 path=smoke-test/smoketest-1718000000
[PASS] Create test page  (id=42)

[smoke] Step 3: Waiting for MCP sync pipeline to index page (up to 360s)...
[smoke]   Waiting... 10s elapsed (no embeddings yet for page_id=42)
[smoke]   Waiting... 20s elapsed (no embeddings yet for page_id=42)
[smoke]   Indexed: 3 chunk(s) found after 30s
[PASS] Embedding sync (index page)  (3 chunk(s) in 30s)

[smoke] Step 4: Testing MCP search_wiki tool...
[PASS] MCP search_wiki finds test page  (relevance=0.87)

[smoke] Step 5: Testing MCP get_wiki_page tool...
[PASS] MCP get_wiki_page returns correct content  (title=Smoke Test Page smoketest-1718000000)

[smoke] Step 6: Cleaning up test page via GraphQL...
[smoke]   Test page deleted.
[PASS] Cleanup (delete test page)

════════════════════════════════════════════════════════
  Wiki.js MCP Smoke Test Summary (Read-Only Mode)
  Instance: 1.2.3.4               Elapsed: 45s
════════════════════════════════════════════════════════
  ✓ Obtain admin token
  ✓ Create test page  (id=42)
  ✓ Embedding sync (index page)  (3 chunk(s) in 30s)
  ✓ MCP search_wiki finds test page  (relevance=0.87)
  ✓ MCP get_wiki_page returns correct content
  ✓ Cleanup (delete test page)
────────────────────────────────────────────────────────
  OVERALL: PASS
════════════════════════════════════════════════════════
```

**Read-Write Mode**:
```
[smoke] Starting smoke test against 1.2.3.4
[smoke] Wiki.js URL: http://1.2.3.4:3000
[smoke] Mode: Read-Write (ENABLE_WRITE_OPERATIONS=true)

[smoke] Step 1: Obtaining Wiki.js admin token...
[smoke]   Token obtained.
[PASS] Obtain admin token

[smoke] Step 2: Testing MCP create_wiki_page tool...
[smoke]   Created page id=123 path=/smoke-test/create-1718000000
[PASS] MCP create_wiki_page  (id=123, 2.3s)

[smoke] Step 3: Waiting for MCP sync pipeline to index page (up to 360s)...
[smoke]   Indexed: 2 chunk(s) found after 20s
[PASS] Embedding sync (index page)  (2 chunk(s) in 20s)

[smoke] Step 4: Testing MCP search_wiki tool...
[PASS] MCP search_wiki finds test page  (relevance=0.91)

[smoke] Step 5: Testing MCP get_wiki_page tool...
[PASS] MCP get_wiki_page returns correct content

[smoke] Step 6: Testing MCP update_wiki_page tool...
[smoke]   Updated page id=123
[PASS] MCP update_wiki_page  (1.8s)

[smoke] Step 7: Testing MCP move_wiki_page tool...
[smoke]   Moved page from /smoke-test/create-1718000000 to /smoke-test/moved-1718000000
[PASS] MCP move_wiki_page  (2.1s)

[smoke] Step 8: Testing MCP delete_wiki_page tool...
[smoke]   Deleted page id=123
[PASS] MCP delete_wiki_page  (1.5s)

[smoke] Step 9: Verifying embeddings removed...
[smoke]   Embeddings removed after 15s
[PASS] Embedding cleanup after delete

════════════════════════════════════════════════════════
  Wiki.js MCP Smoke Test Summary (Read-Write Mode)
  Instance: 1.2.3.4               Elapsed: 65s
════════════════════════════════════════════════════════
  ✓ Obtain admin token
  ✓ MCP create_wiki_page  (id=123, 2.3s)
  ✓ Embedding sync (index page)  (2 chunk(s) in 20s)
  ✓ MCP search_wiki finds test page  (relevance=0.91)
  ✓ MCP get_wiki_page returns correct content
  ✓ MCP update_wiki_page  (1.8s)
  ✓ MCP move_wiki_page  (2.1s)
  ✓ MCP delete_wiki_page  (1.5s)
  ✓ Embedding cleanup after delete
────────────────────────────────────────────────────────
  OVERALL: PASS
════════════════════════════════════════════════════════
```

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `Auth failed: Invalid credentials` | Wrong email/password | Check `WIKI_ADMIN_EMAIL` / `WIKI_ADMIN_PASSWORD` |
| `GraphQL: unknown` on page create | Wiki.js not fully started | Wait ~60s after deploy and retry |
| Embedding sync times out after 360s | MCP sync pipeline not running | Check `podman logs wikijs-mcp`; verify AWS credentials for Bedrock |
| `search_wiki` returns empty | Bedrock embedding failed | Check `podman logs wikijs-mcp` for Bedrock errors |
| SSH connection refused | Wrong IP or firewall | Verify instance IP and OCI security list allows port 22 |

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_WRITE_OPERATIONS` | `false` | Enable write operations tests |
| `WIKI_ADMIN_TOKEN` | — | Pre-obtained JWT (skips login step) |
| `WIKI_ADMIN_EMAIL` | `admin@wiki.local` | Admin email for login |
| `WIKI_ADMIN_PASSWORD` | `ChangeMe123!` | Admin password for login |
| `SSH_KEY` | `~/.ssh/oci_agent_coder` | Path to SSH private key |
| `SSH_USER` | `opc` | SSH username on OCI instance |
| `WIKI_PORT` | `3000` | Wiki.js HTTP port |
| `MCP_PORT` | `3001` | MCP server HTTP port |
