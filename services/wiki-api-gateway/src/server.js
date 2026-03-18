import express from 'express';
import healthRouter from './routes/health.js';
import { createPagesRouter } from './routes/pages.js';
import { createSearchRouter } from './routes/search.js';
import { createAuthMiddleware } from './middleware/auth.js';

/**
 * Creates a configured Express app.
 *
 * @param {Object} deps - Injected dependencies
 * @param {import('pg').Client} deps.dbClient - Connected PostgreSQL client
 * @param {Object} deps.config - Loaded configuration object
 * @returns {import('express').Application}
 */
export function createApp({ dbClient, config }) {
  const app = express();

  // JSON body parsing
  app.use(express.json());

  // Health check — no auth required
  app.use(healthRouter);

  // Auth middleware on all /api routes
  app.use('/api', createAuthMiddleware({
    apiKeyRo: config.apiKeyRo,
    apiKeyRw: config.apiKeyRw,
  }));

  // Route handlers
  app.use('/api/pages', createPagesRouter({ config, dbClient }));
  app.use('/api/search', createSearchRouter({ config, dbClient }));

  // Global error handler — catch unhandled exceptions, return 500
  // Must have 4 parameters for Express to recognize it as error middleware
  app.use((err, req, res, _next) => {
    console.error('[Gateway] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
