# wiki-cli — Command Reference

## Overview

`wiki-cli` is a Go CLI tool that provides shell-based access to the Wiki REST API Gateway. It wraps all gateway endpoints as simple commands with JSON output, making it usable by AI agents (like Goose), shell scripts, and humans.

The tool was created as a workaround for a [Goose v1.28.0 segfault](https://github.com/block/goose/issues) in the stdio MCP transport on ARM64. Instead of using the MCP protocol, Goose invokes `wiki-cli` as a shell command via its Developer extension.

## Installation

The CLI is a single static binary with zero runtime dependencies. It's pre-installed in the Goose container at `/usr/local/bin/wiki-cli`.

To build from source:

```bash
cd services/wiki-cli
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o wiki-cli ./
```

Or use the Makefile:

```bash
cd services/wiki-cli
make
```

## Configuration

The CLI reads configuration from environment variables. These are the same variables used by the former MCP server.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WIKI_GATEWAY_URL` | No | `http://localhost:3001` | Gateway base URL |
| `WIKI_GATEWAY_API_KEY` | Yes | — | Bearer token for gateway authentication |
| `ENABLE_WRITE_OPS` | No | `false` | Enable write commands (create, update, delete, move) |

Inside the Goose container, these are already set via the `start.sh` script.

## Commands

### search

Search wiki pages using semantic similarity.

```
wiki-cli search <query> [--top <n>]
```

| Argument/Flag | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `<query>` | string | Yes | — | Search query text |
| `--top` | integer | No | 5 | Number of results (1–20) |

Examples:

```bash
wiki-cli search "kubernetes deployment"
wiki-cli search "authentication setup" --top 10
```

### get

Get the full content of a wiki page by ID or path.

```
wiki-cli get --id <page_id>
wiki-cli get --path <page_path>
```

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--id` | integer | One of id/path | Page numeric ID |
| `--path` | string | One of id/path | Page path (e.g. "devops/kubernetes") |

If both `--id` and `--path` are provided, `--id` takes precedence.

Examples:

```bash
wiki-cli get --id 42
wiki-cli get --path "devops/kubernetes"
```

### list

List all wiki pages, ordered by most recently updated.

```
wiki-cli list
```

No flags required.

Example:

```bash
wiki-cli list
```

### create

Create a new wiki page. Requires `ENABLE_WRITE_OPS=true`.

```
wiki-cli create --title <title> --path <path> --content <content> [--description <desc>] [--tags <tag1,tag2>]
```

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--title` | string | Yes | Page title |
| `--path` | string | Yes | Page path (e.g. "devops/new-page") |
| `--content` | string | Yes | Page content in markdown |
| `--description` | string | No | Short page description |
| `--tags` | comma-separated strings | No | Page tags |

Example:

```bash
wiki-cli create --title "Getting Started" --path "guides/getting-started" --content "# Welcome"
wiki-cli create --title "K8s Guide" --path "devops/k8s" --content "# Kubernetes" --tags "devops,kubernetes"
```

### update

Update an existing wiki page. Only provided fields are changed. Requires `ENABLE_WRITE_OPS=true`.

```
wiki-cli update --id <page_id> [--title <title>] [--content <content>] [--description <desc>] [--tags <tag1,tag2>]
```

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--id` | integer | Yes | Page ID to update |
| `--title` | string | No | New page title |
| `--content` | string | No | New page content |
| `--description` | string | No | New page description |
| `--tags` | comma-separated strings | No | New page tags |

Example:

```bash
wiki-cli update --id 42 --content "# Updated content"
wiki-cli update --id 42 --title "New Title" --tags "updated,reviewed"
```

### delete

Delete a wiki page by ID. Requires `ENABLE_WRITE_OPS=true`.

```
wiki-cli delete --id <page_id>
```

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--id` | integer | Yes | Page ID to delete |

Example:

```bash
wiki-cli delete --id 42
```

### move

Move a wiki page to a new path. Requires `ENABLE_WRITE_OPS=true`.

```
wiki-cli move --id <page_id> --destination <new_path> [--locale <locale>]
```

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--id` | integer | Yes | — | Page ID to move |
| `--destination` | string | Yes | — | New page path |
| `--locale` | string | No | `en` | Destination locale |

Example:

```bash
wiki-cli move --id 42 --destination "guides/beginner/getting-started"
```

### help

Display help information.

```
wiki-cli help              # Top-level help
wiki-cli help <command>    # Per-command help
wiki-cli <command> --help  # Same as help <command>
wiki-cli <command> -h      # Same as help <command>
```

## Output Format

All successful responses are JSON written to stdout. The CLI passes through the gateway's JSON response as-is.

```bash
# Example: search output
wiki-cli search "kubernetes" | jq '.[0]'
{
  "page_id": 42,
  "page_title": "Kubernetes Setup",
  "page_path": "/devops/kubernetes",
  "chunk_text": "To set up Kubernetes...",
  "relevance_score": 0.87
}
```

Errors are written to stderr. User input errors are plain text with a help hint:

```
Error: missing required flag --id
Run 'wiki-cli help delete' for usage details
```

Gateway errors are JSON on stderr:

```json
{"error": "Gateway returned 404", "details": "HTTP 404"}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (missing args, config error, gateway error, write ops disabled) |

## Integration with Goose

Goose invokes `wiki-cli` via its Developer extension (shell commands). The CLI is available at `/usr/local/bin/wiki-cli` inside the Goose container.

Example Goose interactions:

```
Goose> Search the wiki for kubernetes deployment guides
→ wiki-cli search "kubernetes deployment guides"

Goose> Show me the content of page 42
→ wiki-cli get --id 42

Goose> Create a new page about CI/CD pipelines
→ wiki-cli create --title "CI/CD Pipelines" --path "devops/cicd" --content "# CI/CD..."
```

To configure Goose to use the CLI, remove the `wiki` stdio extension from `config.yaml` (the one that causes the segfault) and let Goose discover `wiki-cli` as a shell tool.

## Troubleshooting

### "WIKI_GATEWAY_API_KEY environment variable is required"

The API key is not set. Verify it's passed to the container:

```bash
podman exec goose-web env | grep WIKI_GATEWAY_API_KEY
```

### "Write operations are disabled"

Set `ENABLE_WRITE_OPS=true` in the container environment. This is already configured in `start.sh` but verify:

```bash
podman exec goose-web env | grep ENABLE_WRITE_OPS
```

### "Gateway request failed: connection refused"

The Wiki REST API Gateway is not reachable. Check:

```bash
# From inside the Goose container
podman exec goose-web curl -sf http://host.containers.internal:3001/health

# From the host
curl -sf http://localhost:3001/health
```

### Command not found

The binary is not installed or not in PATH:

```bash
podman exec goose-web which wiki-cli
# Expected: /usr/local/bin/wiki-cli
```
