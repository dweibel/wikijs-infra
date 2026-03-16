# Wiki.js Infrastructure Repository

Dedicated repository for managing Wiki.js deployment with integrated vector search capabilities powered by OpenRouter embeddings.

## Overview

This repository provides automated deployment of Wiki.js with PostgreSQL (pgvector extension) and an MCP (Model Context Protocol) server that enables semantic search over wiki content. The design emphasizes ARM64 architecture for cost optimization on OCI Always Free tier, secure credential management, and comprehensive testing infrastructure.

## Features

- **Semantic Search**: Vector search over Wiki.js content using OpenRouter embeddings
- **Automated Deployment**: Podman-based deployment scripts with systemd integration
- **ARM64 Optimized**: Built for OCI Always Free tier (VM.Standard.A1.Flex)
- **MCP Server**: Model Context Protocol server for AI assistant integration
- **Secure by Default**: Environment-based configuration with secret scanning
- **Comprehensive Testing**: Unit, integration, and property-based tests

## Quick Start

1. Copy `.env.example` to `.env` and configure your credentials
2. Run `./scripts/deploy-wikijs.sh deploy` to deploy the stack
3. Access Wiki.js at `http://localhost:3000`
4. Access MCP server at `http://localhost:3001`

## Documentation

- [API Documentation](docs/API.md) - MCP server API reference
- [Deployment Guide](docs/DEPLOYMENT.md) - Deployment instructions
- [Testing Guide](docs/TESTING.md) - Testing procedures
- [Client Configuration](docs/CLIENT_CONFIG.md) - MCP client setup

## Repository Structure

```
wikijs-infra/
├── services/wiki-mcp-server/  # MCP server source code
├── scripts/                    # Deployment and management scripts
├── docs/                       # Documentation
├── .env.example               # Environment variable template
└── README.md                  # This file
```

## Requirements

- Podman or Docker
- Node.js 20+ (for local development)
- PostgreSQL 15+ with pgvector extension
- OpenRouter API key

## License

MIT
