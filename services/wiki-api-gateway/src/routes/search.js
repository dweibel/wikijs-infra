import { Router } from 'express';
import { searchWiki } from '../tools.js';

/**
 * Creates an Express Router for /api/search endpoint.
 *
 * @param {Object} deps
 * @param {Object} deps.config - Loaded configuration object
 * @param {import('pg').Client} deps.dbClient - Connected PostgreSQL client
 * @returns {import('express').Router}
 */
export function createSearchRouter({ config, dbClient }) {
  const router = Router();

  // POST / — semantic search (mounted at /api/search by server.js)
  router.post('/', async (req, res, next) => {
    try {
      const { query } = req.body;
      if (!query || typeof query !== 'string' || query.trim() === '') {
        return res.status(400).json({ error: 'Missing required field: query must be a non-empty string' });
      }

      let top_k = req.body.top_k != null ? Number(req.body.top_k) : 5;
      if (!Number.isFinite(top_k)) top_k = 5;
      top_k = Math.max(1, Math.min(20, Math.round(top_k)));

      const result = await searchWiki(dbClient, config.wikiBaseUrl, { query, top_k });

      if (result.error) {
        if (result.error.includes('Search failed') || result.error.includes('Failed to generate embedding')) {
          return res.status(502).json({ error: result.error });
        }
        return res.status(500).json({ error: result.error });
      }

      return res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
