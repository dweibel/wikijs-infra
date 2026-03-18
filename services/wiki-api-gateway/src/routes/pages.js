import { Router } from 'express';
import { getWikiPage, createWikiPage, updateWikiPage, deleteWikiPage, moveWikiPage } from '../tools.js';
import { listPages } from '../wiki-client.js';

/**
 * Validates that a string represents a positive integer.
 * @param {string} value
 * @returns {boolean}
 */
function isPositiveIntId(value) {
  return /^\d+$/.test(value) && parseInt(value, 10) > 0;
}

/**
 * Creates an Express Router for /api/pages endpoints.
 *
 * @param {Object} deps
 * @param {Object} deps.config - Loaded configuration object
 * @param {import('pg').Client} deps.dbClient - Connected PostgreSQL client
 * @returns {import('express').Router}
 */
export function createPagesRouter({ config, dbClient }) {
  const router = Router();

  // GET /by-path — MUST be registered BEFORE /:id to avoid route collision
  router.get('/by-path', async (req, res, next) => {
    try {
      const { path } = req.query;
      if (!path || typeof path !== 'string' || path.trim() === '') {
        return res.status(400).json({ error: 'Missing required query parameter: path' });
      }

      const result = await getWikiPage(config.wikiBaseUrl, { path });

      if (result.error) {
        if (result.error.toLowerCase().includes('not found')) {
          return res.status(404).json({ error: result.error });
        }
        return res.status(500).json({ error: result.error });
      }

      return res.json({
        id: result.page_id,
        title: result.title,
        path: result.path,
        content: result.content,
        updatedAt: result.updated_at,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /:id — get page by ID
  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!isPositiveIntId(id)) {
        return res.status(400).json({ error: 'Invalid page ID: must be a positive integer' });
      }

      const result = await getWikiPage(config.wikiBaseUrl, { page_id: parseInt(id, 10) });

      if (result.error) {
        if (result.error.toLowerCase().includes('not found')) {
          return res.status(404).json({ error: result.error });
        }
        return res.status(500).json({ error: result.error });
      }

      return res.json({
        id: result.page_id,
        title: result.title,
        path: result.path,
        content: result.content,
        updatedAt: result.updated_at,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET / — list all pages
  router.get('/', async (_req, res, next) => {
    try {
      const pages = await listPages(config.wikiBaseUrl);
      return res.json(pages);
    } catch (err) {
      next(err);
    }
  });

  // POST / — create page
  router.post('/', async (req, res, next) => {
    try {
      const { title, path, content } = req.body;
      const missing = [];
      if (!title) missing.push('title');
      if (!path) missing.push('path');
      if (!content) missing.push('content');
      if (missing.length > 0) {
        return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
      }

      const result = await createWikiPage(config.wikiBaseUrl, config.wikiAdminToken, req.body);

      if (result.success === false) {
        if (result.error_code === 2001) {
          return res.status(409).json({ error: result.message });
        }
        return res.status(500).json({ error: result.message });
      }

      return res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // PUT /:id — update page
  router.put('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!isPositiveIntId(id)) {
        return res.status(400).json({ error: 'Invalid page ID: must be a positive integer' });
      }

      const result = await updateWikiPage(config.wikiBaseUrl, config.wikiAdminToken, {
        page_id: parseInt(id, 10),
        ...req.body,
      });

      if (result.success === false) {
        if (result.error_code === 2002) {
          return res.status(404).json({ error: result.message });
        }
        return res.status(500).json({ error: result.message });
      }

      return res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /:id — delete page
  router.delete('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!isPositiveIntId(id)) {
        return res.status(400).json({ error: 'Invalid page ID: must be a positive integer' });
      }

      const result = await deleteWikiPage(config.wikiBaseUrl, config.wikiAdminToken, {
        page_id: parseInt(id, 10),
      });

      if (result.success === false) {
        if (result.error_code === 2002) {
          return res.status(404).json({ error: result.message });
        }
        return res.status(500).json({ error: result.message });
      }

      return res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /:id/move — move page
  router.post('/:id/move', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!isPositiveIntId(id)) {
        return res.status(400).json({ error: 'Invalid page ID: must be a positive integer' });
      }

      const { destination_path, destination_locale } = req.body;
      if (!destination_path) {
        return res.status(400).json({ error: 'Missing required field: destination_path' });
      }

      const result = await moveWikiPage(config.wikiBaseUrl, config.wikiAdminToken, {
        page_id: parseInt(id, 10),
        destination_path,
        destination_locale: destination_locale || 'en',
      });

      if (result.success === false) {
        if (result.error_code === 2002) {
          return res.status(404).json({ error: result.message });
        }
        return res.status(500).json({ error: result.message });
      }

      return res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
