// Feature: wiki-rest-api-gateway, Property 13: Optional fields forwarded on create
// Validates: Requirements 5.4

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import request from 'supertest';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createPagesRouter } from './pages.js';
import { createWikiPage } from '../tools.js';

// Mock tools.js — capture createWikiPage arguments
vi.mock('../tools.js', () => ({
  getWikiPage: vi.fn(),
  createWikiPage: vi.fn(),
  updateWikiPage: vi.fn(),
  deleteWikiPage: vi.fn(),
  moveWikiPage: vi.fn(),
  searchWiki: vi.fn(),
}));

// Mock wiki-client.js to avoid import errors
vi.mock('../wiki-client.js', () => ({
  listPages: vi.fn(),
}));

const API_KEY = 'test-rw-key-prop13';
const config = { wikiBaseUrl: 'http://localhost:3000', wikiAdminToken: 'test-token' };

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', createAuthMiddleware({ apiKeyRo: null, apiKeyRw: API_KEY }));
  app.use('/api/pages', createPagesRouter({ config, dbClient: {} }));
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

/**
 * Generator for POST /api/pages bodies with required fields always present
 * and optional fields randomly included or omitted.
 */
const createBodyArb = fc.record({
  title: fc.string({ minLength: 1, maxLength: 50 }),
  path: fc.string({ minLength: 1, maxLength: 50 }),
  content: fc.string({ minLength: 1, maxLength: 200 }),
  description: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
  tags: fc.option(fc.array(fc.string({ maxLength: 20 }), { maxLength: 5 }), { nil: undefined }),
  isPublished: fc.option(fc.boolean(), { nil: undefined }),
  isPrivate: fc.option(fc.boolean(), { nil: undefined }),
  locale: fc.option(fc.string({ minLength: 1, maxLength: 5 }), { nil: undefined }),
});

describe('Property 13: Optional fields forwarded on create', () => {
  const app = createTestApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // **Validates: Requirements 5.4**
  it(
    'optional fields included in POST /api/pages are forwarded to createWikiPage',
    () =>
      fc.assert(
        fc.asyncProperty(createBodyArb, async (body) => {
          // Reset mock before each iteration
          createWikiPage.mockReset();
          createWikiPage.mockResolvedValueOnce({
            page_id: 1,
            path: body.path,
            title: body.title,
            success: true,
            message: 'Page created successfully',
          });

          // Strip undefined keys so they are truly absent from the JSON payload
          const payload = JSON.parse(JSON.stringify(body));

          const res = await request(app)
            .post('/api/pages')
            .set('Authorization', `Bearer ${API_KEY}`)
            .send(payload);

          expect(res.status).toBe(201);

          // Verify createWikiPage was called exactly once
          expect(createWikiPage).toHaveBeenCalledOnce();

          // Get the pageData argument (3rd argument) passed to createWikiPage
          const forwardedBody = createWikiPage.mock.calls[0][2];

          // For each optional field present in the request payload,
          // verify it was forwarded to createWikiPage
          const optionalFields = ['description', 'tags', 'isPublished', 'isPrivate', 'locale'];
          for (const field of optionalFields) {
            if (field in payload) {
              expect(forwardedBody).toHaveProperty(field);
              expect(forwardedBody[field]).toEqual(payload[field]);
            }
          }

          // Also verify required fields were forwarded
          expect(forwardedBody.title).toBe(payload.title);
          expect(forwardedBody.path).toBe(payload.path);
          expect(forwardedBody.content).toBe(payload.content);
        }),
        { numRuns: 100 },
      ),
  );
});
