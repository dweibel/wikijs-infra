# Wiki.js Infrastructure

Deployment and management of Wiki.js with an integrated REST API gateway providing semantic vector search and page CRUD operations. The gateway is the sole entry point — Wiki.js and PostgreSQL are pod-internal only. Includes a Go CLI tool for shell-based access.

## Ecosystem Context

See `foundry-core/docs/ECOSYSTEM.md` for the full system architecture and component relationships.

## Key Facts

- **Languages:** JavaScript (API gateway), Go (CLI tool)
- **Port:** 3001 (gateway only; Wiki.js and PostgreSQL are pod-internal)
- **Auth:** Two-tier API keys (read-only / read-write)
- **Embeddings:** OpenRouter `text-embedding-3-small` with background sync
- **Storage:** PostgreSQL + pgvector
- **Deploy target:** OCI ARM64 Podman pod via `scripts/deploy-wikijs.sh`
- **Test:** `scripts/smoke-test-wikijs.sh`

## Services

- `services/wiki-api-gateway/` — REST API (Express, Node.js 20+)
- `services/wiki-cli/` — Go static binary for shell access
- `services/wiki-mcp-server/` — MCP server integration

## Documentation

- [docs/API.md](docs/API.md) — REST endpoints and schemas
- [docs/CLI.md](docs/CLI.md) — `wiki-cli` command reference
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deployment and troubleshooting
- [docs/TESTING.md](docs/TESTING.md) — test strategy
- [docs/CLIENT_CONFIG.md](docs/CLIENT_CONFIG.md) — client connection setup
- [docs/MIGRATION.md](docs/MIGRATION.md) — migration from agent-infra
- [docs/WIKI-API.md](docs/WIKI-API.md) — underlying Wiki.js GraphQL API
