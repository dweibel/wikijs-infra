import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import pg from 'pg';
import { z } from 'zod';
import { initSchema } from './db.js';
import { searchWiki, getWikiPage, createWikiPage, updateWikiPage, deleteWikiPage, moveWikiPage } from './tools.js';
import { startSync } from './sync.js';
import { loadConfig } from './config.js';

const { Client } = pg;

// Load and validate configuration
let config;
try {
  config = loadConfig();
} catch (err) {
  console.error('[MCP] Configuration error:', err.message);
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
const intervalMs = config.syncIntervalMs;
const enableWriteOps = config.enableWriteOps;
const wikiAdminToken = config.wikiAdminToken;

// Connect to DB and initialise schema
await dbClient.connect();
await initSchema(dbClient);

// Start embedding sync pipeline
startSync(dbClient, wikiBaseUrl, intervalMs, wikiAdminToken);

// Create MCP server
const server = new McpServer({
  name: 'wiki-mcp-server',
  version: '1.0.0',
});

// Register search_wiki tool (always available)
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

// Register get_wiki_page tool (always available)
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

// Conditionally register write operation tools
if (enableWriteOps) {
  console.info('[MCP] Write operations enabled - registering create_wiki_page tool');
  
  server.tool(
    'create_wiki_page',
    {
      title: z.string().describe('Page title'),
      path: z.string().describe('Page path (e.g., /guides/setup)'),
      content: z.string().describe('Markdown content'),
      description: z.string().optional().describe('Page description'),
      tags: z.array(z.string()).optional().describe('Page tags'),
      isPublished: z.boolean().optional().default(true).describe('Publish immediately'),
      isPrivate: z.boolean().optional().default(false).describe('Make page private'),
      locale: z.string().optional().default('en').describe('Page locale'),
    },
    async ({ title, path, content, description, tags, isPublished, isPrivate, locale }) => {
      const result = await createWikiPage(wikiBaseUrl, wikiAdminToken, {
        title,
        path,
        content,
        description,
        tags,
        isPublished,
        isPrivate,
        locale,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  console.info('[MCP] Write operations enabled - registering update_wiki_page tool');
  
  server.tool(
    'update_wiki_page',
    {
      page_id: z.number().int().describe('Page ID to update'),
      content: z.string().optional().describe('Updated markdown content'),
      title: z.string().optional().describe('Updated title'),
      description: z.string().optional().describe('Updated description'),
      tags: z.array(z.string()).optional().describe('Updated tags'),
      isPublished: z.boolean().optional().describe('Update publish status'),
      isPrivate: z.boolean().optional().describe('Update private status'),
    },
    async ({ page_id, content, title, description, tags, isPublished, isPrivate }) => {
      const result = await updateWikiPage(wikiBaseUrl, wikiAdminToken, {
        page_id,
        content,
        title,
        description,
        tags,
        isPublished,
        isPrivate,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  console.info('[MCP] Write operations enabled - registering delete_wiki_page tool');
  
  server.tool(
    'delete_wiki_page',
    {
      page_id: z.number().int().describe('Page ID to delete'),
    },
    async ({ page_id }) => {
      const result = await deleteWikiPage(wikiBaseUrl, wikiAdminToken, { page_id });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  console.info('[MCP] Write operations enabled - registering move_wiki_page tool');
  
  server.tool(
    'move_wiki_page',
    {
      page_id: z.number().int().describe('Page ID to move'),
      destination_path: z.string().describe('New page path (e.g., /guides/new-location)'),
      destination_locale: z.string().optional().default('en').describe('Destination locale'),
    },
    async ({ page_id, destination_path, destination_locale }) => {
      const result = await moveWikiPage(wikiBaseUrl, wikiAdminToken, {
        page_id,
        destination_path,
        destination_locale,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
} else {
  console.info('[MCP] Write operations disabled - only read tools available');
}

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
