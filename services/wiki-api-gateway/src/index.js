import pg from 'pg';
import { loadConfig } from './config.js';
import { initSchema } from './db.js';
import { startSync } from './sync.js';
import { createApp } from './server.js';

const { Client } = pg;

// Load and validate configuration
let config;
try {
  config = loadConfig();
} catch (err) {
  console.error('[Gateway] Configuration error:', err.message);
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

await dbClient.connect();
await initSchema(dbClient);

// Start embedding sync pipeline
startSync(dbClient, config.wikiBaseUrl, config.syncIntervalMs, config.wikiAdminToken);

// Create and start Express app
const app = createApp({ dbClient, config });

app.listen(config.gatewayPort, () => {
  console.info(`[Gateway] Wiki REST API Gateway listening on port ${config.gatewayPort}`);
});
