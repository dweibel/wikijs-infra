// Feature: wiki-rest-api-gateway, Property 5: Invalid :id parameter returns 400
// Validates: Requirements 2.2, 6.2, 7.2, 8.2

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import request from 'supertest';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createPagesRouter } from './pages.js';
import { createSearchRouter } from './search.js';

// Mock tools.js — validation should reject before reaching these
vi.mock('../tools.js', () => ({
  getWikiPage: vi.fn(() => { throw new Error('should not be called'); }),
  createWikiPage: vi.fn(() => { throw new Error('should not be called'); }),
  updateWikiPage: vi.fn(() => { throw new Error('should not be called'); }),
  deleteWikiPage: vi.fn(() => { throw new Error('should not be called'); }),
  moveWikiPage: vi.fn(() => { throw new Error('should not be called'); }),
  searchWiki: vi.fn(() => { throw new Error('should not be called'); }),
}));

// Mock wiki-client.js
vi.mock('../wiki-client.js', () => ({
  listPages: vi.fn(() => { throw new Error('should not be called'); }),
}));

const API_KEY = 'test-rw-key-prop5';
const config = { wikiBaseUrl: 'http://localhost:3000', wikiAdminToken: 'test-token' };

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', createAuthMiddleware({ apiKeyRo: null, apiKeyRw: API_KEY }));
  app.use('/api/pages', createPagesRouter({ config, dbClient: {} }));
  app.use('/api/search', createSearchRouter({ config, dbClient: {} }));
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

/**
 * Generator for strings that are NOT valid positive integers.
 * Covers: non-numeric strings, zero, negative numbers, decimals, empty-ish, etc.
 */
const invalidIdArb = fc.oneof(
  // Random strings that aren't all-digit or parse to < 1
  fc.string({ minLength: 1, maxLength: 50 }).filter(
    (s) => !/^\d+$/.test(s) || parseInt(s, 10) < 1,
  ),
  // Specific edge cases
  fc.constantFrom('0', '-1', '-100', '1.5', '3.14', 'abc', 'null', 'undefined', 'NaN', 'Infinity', ' ', '1e2', '0x1A', '00'),
);

/**
 * Endpoints that accept an :id path parameter.
 * Each entry includes method, path template, and optional body for the request.
 */
const ID_ENDPOINTS = [
  { method: 'get', pathTemplate: (id) => `/api/pages/${id}`, body: null },
  { method: 'put', pathTemplate: (id) => `/api/pages/${id}`, body: { content: 'test' } },
  { method: 'delete', pathTemplate: (id) => `/api/pages/${id}`, body: null },
  { method: 'post', pathTemplate: (id) => `/api/pages/${id}/move`, body: { destination_path: '/test' } },
];

const endpointArb = fc.constantFrom(...ID_ENDPOINTS);

describe('Property 5: Invalid :id parameter returns 400', () => {
  const app = createTestApp();

  it(
    'any endpoint with :id returns 400 with error field for any invalid ID',
    () =>
      fc.assert(
        fc.asyncProperty(endpointArb, invalidIdArb, async (endpoint, invalidId) => {
          // URL-encode the invalid ID to ensure it reaches the route as a single path segment
          const path = endpoint.pathTemplate(encodeURIComponent(invalidId));
          let req = request(app)[endpoint.method](path)
            .set('Authorization', `Bearer ${API_KEY}`);

          if (endpoint.body) {
            req = req.send(endpoint.body);
          }

          const res = await req;

          expect(res.status).toBe(400);
          expect(res.body).toHaveProperty('error');
          expect(typeof res.body.error).toBe('string');
        }),
        { numRuns: 100 },
      ),
  );
});


// Feature: wiki-rest-api-gateway, Property 6: Missing required fields returns 400
// Validates: Requirements 3.2, 4.3, 5.2, 8.2

/**
 * Generator for POST /api/pages bodies with at least one required field missing or empty.
 * Required fields: title, path, content.
 */
const partialCreateBodyArb = fc
  .record({
    title: fc.option(fc.oneof(fc.string({ minLength: 1 }), fc.constant('')), { nil: undefined }),
    path: fc.option(fc.oneof(fc.string({ minLength: 1 }), fc.constant('')), { nil: undefined }),
    content: fc.option(fc.oneof(fc.string({ minLength: 1 }), fc.constant('')), { nil: undefined }),
  })
  .filter((body) => {
    // At least one required field must be missing (undefined) or falsy (empty string)
    return !body.title || !body.path || !body.content;
  });

/**
 * Generator for POST /api/search bodies with missing or empty query.
 */
const missingQueryBodyArb = fc.oneof(
  // No query field at all
  fc.constant({}),
  // query is empty string
  fc.constant({ query: '' }),
  // query is whitespace-only
  fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 10 }).map((ws) => ({
    query: ws,
  })),
  // query is a non-string type
  fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)).map((v) => ({ query: v })),
);

describe('Property 6: Missing required fields returns 400', () => {
  const app = createTestApp();

  // **Validates: Requirements 5.2**
  it(
    'POST /api/pages with missing required fields returns 400 with error field',
    () =>
      fc.assert(
        fc.asyncProperty(partialCreateBodyArb, async (body) => {
          // Strip undefined keys so they are truly absent from the JSON payload
          const payload = JSON.parse(JSON.stringify(body));

          const res = await request(app)
            .post('/api/pages')
            .set('Authorization', `Bearer ${API_KEY}`)
            .send(payload);

          expect(res.status).toBe(400);
          expect(res.body).toHaveProperty('error');
          expect(typeof res.body.error).toBe('string');
        }),
        { numRuns: 100 },
      ),
  );

  // **Validates: Requirements 4.3**
  it(
    'POST /api/search with missing or empty query returns 400 with error field',
    () =>
      fc.assert(
        fc.asyncProperty(missingQueryBodyArb, async (body) => {
          const res = await request(app)
            .post('/api/search')
            .set('Authorization', `Bearer ${API_KEY}`)
            .send(body);

          expect(res.status).toBe(400);
          expect(res.body).toHaveProperty('error');
          expect(typeof res.body.error).toBe('string');
        }),
        { numRuns: 100 },
      ),
  );

  // **Validates: Requirements 3.2**
  it(
    'GET /api/pages/by-path with missing or empty path query param returns 400 with error field',
    () =>
      fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            '', // empty path param
            '   ', // whitespace-only
          ),
          async (pathVal) => {
            // Test with the path param present but empty/whitespace
            const res = await request(app)
              .get('/api/pages/by-path')
              .query({ path: pathVal })
              .set('Authorization', `Bearer ${API_KEY}`);

            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
            expect(typeof res.body.error).toBe('string');
          },
        ),
        { numRuns: 100 },
      ),
  );

  // **Validates: Requirements 3.2** (missing param entirely)
  it('GET /api/pages/by-path with no path query param returns 400 with error field', async () => {
    const res = await request(app)
      .get('/api/pages/by-path')
      .set('Authorization', `Bearer ${API_KEY}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
  });

  // **Validates: Requirements 8.2**
  it(
    'POST /api/pages/:id/move with missing destination_path returns 400 with error field',
    () =>
      fc.assert(
        fc.asyncProperty(
          // Generate bodies that lack destination_path
          fc.oneof(
            fc.constant({}),
            fc.record({
              destination_locale: fc.option(fc.string(), { nil: undefined }),
            }),
          ),
          async (body) => {
            const payload = JSON.parse(JSON.stringify(body));

            const res = await request(app)
              .post('/api/pages/1/move')
              .set('Authorization', `Bearer ${API_KEY}`)
              .send(payload);

            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
            expect(typeof res.body.error).toBe('string');
          },
        ),
        { numRuns: 100 },
      ),
  );
});
