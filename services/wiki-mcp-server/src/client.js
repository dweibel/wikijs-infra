import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import pg from 'pg';
import { z } from 'zod';
import { searchWiki, getWikiPage } from './tools.js';
import { loadConfig } from './config.js';

const { Client } = pg;

// Load and validate configuration
let config;
try {
  config = loadConfig();
} catch (err) {
  console.error('[CLIENT ERROR] Failed to load config:', err.message);
  process.exit(1);
}

// Database connection
const dbClient = new Client({
  host: config.pgHost,
  port: config.pgPort,
  database: config.pgDatabase,
  user: config.pgUser,
  password: config.pgPassword,
});

const wikiBaseUrl = config.wikiBaseUrl;

// Connect to DB (no schema init needed - server handles that)
try {
  await dbClient.connect();
} catch (err) {
  console.error('[CLIENT ERROR] Failed to connect to database:', err.message);
  process.exit(1);
}

// Create MCP server (client mode - no sync pipeline)
const server = new McpServer({
  name: 'wiki-mcp-client',
  version: '1.0.0',
});

// Register search_wiki tool
server.tool(
  'search_wiki',
  {
    query: z.string().describe('Natural language search query'),
    top_k: z.number().int().min(1).max(20).default(5).describe('Number of results to return'),
  },
  async ({ query, top_k }) => {
    const result = await searchWiki(dbClient, wikiBaseUrl, { query, top_k });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

// Register get_wiki_page tool
server.tool(
  'get_wiki_page',
  {
    page_id: z.number().int().optional().describe('Wiki page ID'),
    path: z.string().optional().describe('Wiki page path (e.g. /home)'),
  },
  async ({ page_id, path }) => {
    const result = await getWikiPage(wikiBaseUrl, { page_id, path });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

// Start stdio transport (silent mode for MCP protocol)
const transport = new StdioServerTransport();
await server.connect(transport);
