// Feature: wiki-rest-api-gateway, Property 1: List pages response shape
// Feature: wiki-rest-api-gateway, Property 2: Get page response shape
// Feature: wiki-rest-api-gateway, Property 3: Search results shape and top_k limiting
// Feature: wiki-rest-api-gateway, Property 4: Mutation response shape
// Validates: Requirements 1.1, 2.1, 3.1, 4.1, 4.2, 5.1, 6.1, 7.1, 8.1

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import request from 'supertest';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createPagesRouter } from './pages.js';
import { createSearchRouter } from './search.js';

// Mock tools.js with controllable return values
vi.mock('../tools.js', () => ({
  getWikiPage: vi.fn(),
  createWikiPage: vi.fn(),
  updateWikiPage: vi.fn(),
  deleteWikiPage: vi.fn(),
  moveWikiPage: vi.fn(),
  searchWiki: vi.fn(),
}));

// Mock wiki-client.js with controllable return values
vi.mock('../wiki-client.js', () => ({
  listPages: vi.fn(),
}));

import { getWikiPage, createWikiPage, updateWikiPage, deleteWikiPage, moveWikiPage, searchWiki } from '../tools.js';
import { listPages } from '../wiki-client.js';

const API_KEY = 'test-rw-key-response';
const config = { wikiBaseUrl: 'http://localhost:3000', wikiAdminToken: 'test-token' };

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', createAuthMiddleware({ apiKeyRo: null, apiKeyRw: API_KEY }));
  app.use('/api/pages', createPagesRouter({ config, dbClient: {} }));
  app.use('/api/search', createSearchRouter({ config, dbClient: {} }));
  app.use((_err, _req, res, _next) => {
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});


// --- Property 1: List pages response shape ---
// **Validates: Requirements 1.1**
describe('Property 1: List pages response shape', () => {
  const app = createTestApp();

  const pageArb = fc.record({
    id: fc.nat(),
    path: fc.string(),
    title: fc.string(),
    updatedAt: fc.string(),
  });

  it(
    'GET /api/pages returns a JSON array where every element has id (number), path (string), title (string), updatedAt (string)',
    () =>
      fc.assert(
        fc.asyncProperty(fc.array(pageArb), async (pages) => {
          vi.mocked(listPages).mockResolvedValueOnce(pages);

          const res = await request(app)
            .get('/api/pages')
            .set('Authorization', `Bearer ${API_KEY}`);

          expect(res.status).toBe(200);
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBe(pages.length);

          for (const item of res.body) {
            expect(typeof item.id).toBe('number');
            expect(typeof item.path).toBe('string');
            expect(typeof item.title).toBe('string');
            expect(typeof item.updatedAt).toBe('string');
          }
        }),
        { numRuns: 100 },
      ),
  );
});

// --- Property 2: Get page response shape ---
// **Validates: Requirements 2.1, 3.1**
describe('Property 2: Get page response shape', () => {
  const app = createTestApp();

  const pageResultArb = fc.record({
    page_id: fc.nat({ min: 1 }),
    title: fc.string(),
    path: fc.string(),
    content: fc.string(),
    updated_at: fc.string(),
  });

  it(
    'GET /api/pages/:id returns a JSON object with id, title, path, content, updatedAt',
    () =>
      fc.assert(
        fc.asyncProperty(pageResultArb, async (page) => {
          vi.mocked(getWikiPage).mockResolvedValueOnce(page);

          const res = await request(app)
            .get('/api/pages/1')
            .set('Authorization', `Bearer ${API_KEY}`);

          expect(res.status).toBe(200);
          expect(typeof res.body.id).toBe('number');
          expect(res.body.id).toBe(page.page_id);
          expect(typeof res.body.title).toBe('string');
          expect(typeof res.body.path).toBe('string');
          expect(typeof res.body.content).toBe('string');
          expect(typeof res.body.updatedAt).toBe('string');
        }),
        { numRuns: 100 },
      ),
  );

  it(
    'GET /api/pages/by-path?path=test returns a JSON object with id, title, path, content, updatedAt',
    () =>
      fc.assert(
        fc.asyncProperty(pageResultArb, async (page) => {
          vi.mocked(getWikiPage).mockResolvedValueOnce(page);

          const res = await request(app)
            .get('/api/pages/by-path')
            .query({ path: 'test' })
            .set('Authorization', `Bearer ${API_KEY}`);

          expect(res.status).toBe(200);
          expect(typeof res.body.id).toBe('number');
          expect(res.body.id).toBe(page.page_id);
          expect(typeof res.body.title).toBe('string');
          expect(typeof res.body.path).toBe('string');
          expect(typeof res.body.content).toBe('string');
          expect(typeof res.body.updatedAt).toBe('string');
        }),
        { numRuns: 100 },
      ),
  );
});


// --- Property 3: Search results shape and top_k limiting ---
// **Validates: Requirements 4.1, 4.2**
describe('Property 3: Search results shape and top_k limiting', () => {
  const app = createTestApp();

  const searchResultArb = fc.record({
    page_id: fc.nat(),
    page_title: fc.string(),
    page_path: fc.string(),
    chunk_text: fc.string(),
    relevance_score: fc.double({ min: 0, max: 1, noNaN: true }),
  });

  it(
    'POST /api/search returns results with correct shape and length <= top_k',
    () =>
      fc.assert(
        fc.asyncProperty(
          fc.array(searchResultArb, { minLength: 0, maxLength: 30 }),
          fc.integer({ min: 1, max: 20 }),
          async (allResults, topK) => {
            // The mock returns results sliced to top_k, matching how the real search works
            const sliced = allResults.slice(0, topK);
            vi.mocked(searchWiki).mockResolvedValueOnce(sliced);

            const res = await request(app)
              .post('/api/search')
              .set('Authorization', `Bearer ${API_KEY}`)
              .send({ query: 'test query', top_k: topK });

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeLessThanOrEqual(topK);

            for (const item of res.body) {
              expect(typeof item.page_id).toBe('number');
              expect(typeof item.page_title).toBe('string');
              expect(typeof item.page_path).toBe('string');
              expect(typeof item.chunk_text).toBe('string');
              expect(typeof item.relevance_score).toBe('number');
            }
          },
        ),
        { numRuns: 100 },
      ),
  );
});

// --- Property 4: Mutation response shape ---
// **Validates: Requirements 5.1, 6.1, 7.1, 8.1**
describe('Property 4: Mutation response shape', () => {
  const app = createTestApp();

  // Create response shape
  it(
    'POST /api/pages (create) returns page_id, path, title, success, message',
    () =>
      fc.assert(
        fc.asyncProperty(
          fc.record({
            page_id: fc.nat({ min: 1 }),
            path: fc.string({ minLength: 1 }),
            title: fc.string({ minLength: 1 }),
            success: fc.constant(true),
            message: fc.string(),
          }),
          async (mockResult) => {
            vi.mocked(createWikiPage).mockResolvedValueOnce(mockResult);

            const res = await request(app)
              .post('/api/pages')
              .set('Authorization', `Bearer ${API_KEY}`)
              .send({ title: 'Test', path: '/test', content: 'Content' });

            expect(res.status).toBe(201);
            expect(typeof res.body.page_id).toBe('number');
            expect(typeof res.body.path).toBe('string');
            expect(typeof res.body.title).toBe('string');
            expect(res.body.success).toBe(true);
            expect(typeof res.body.message).toBe('string');
          },
        ),
        { numRuns: 100 },
      ),
  );

  // Update response shape
  it(
    'PUT /api/pages/:id (update) returns page_id, updated_at, success, message',
    () =>
      fc.assert(
        fc.asyncProperty(
          fc.record({
            page_id: fc.nat({ min: 1 }),
            updated_at: fc.string(),
            success: fc.constant(true),
            message: fc.string(),
          }),
          async (mockResult) => {
            vi.mocked(updateWikiPage).mockResolvedValueOnce(mockResult);

            const res = await request(app)
              .put('/api/pages/1')
              .set('Authorization', `Bearer ${API_KEY}`)
              .send({ content: 'Updated content' });

            expect(res.status).toBe(200);
            expect(typeof res.body.page_id).toBe('number');
            expect(typeof res.body.updated_at).toBe('string');
            expect(res.body.success).toBe(true);
            expect(typeof res.body.message).toBe('string');
          },
        ),
        { numRuns: 100 },
      ),
  );

  // Delete response shape
  it(
    'DELETE /api/pages/:id (delete) returns page_id, success, message',
    () =>
      fc.assert(
        fc.asyncProperty(
          fc.record({
            page_id: fc.nat({ min: 1 }),
            success: fc.constant(true),
            message: fc.string(),
          }),
          async (mockResult) => {
            vi.mocked(deleteWikiPage).mockResolvedValueOnce(mockResult);

            const res = await request(app)
              .delete('/api/pages/1')
              .set('Authorization', `Bearer ${API_KEY}`);

            expect(res.status).toBe(200);
            expect(typeof res.body.page_id).toBe('number');
            expect(res.body.success).toBe(true);
            expect(typeof res.body.message).toBe('string');
          },
        ),
        { numRuns: 100 },
      ),
  );

  // Move response shape
  it(
    'POST /api/pages/:id/move (move) returns page_id, old_path, new_path, success, message',
    () =>
      fc.assert(
        fc.asyncProperty(
          fc.record({
            page_id: fc.nat({ min: 1 }),
            old_path: fc.string(),
            new_path: fc.string(),
            success: fc.constant(true),
            message: fc.string(),
          }),
          async (mockResult) => {
            vi.mocked(moveWikiPage).mockResolvedValueOnce(mockResult);

            const res = await request(app)
              .post('/api/pages/1/move')
              .set('Authorization', `Bearer ${API_KEY}`)
              .send({ destination_path: '/new-path' });

            expect(res.status).toBe(200);
            expect(typeof res.body.page_id).toBe('number');
            expect(typeof res.body.old_path).toBe('string');
            expect(typeof res.body.new_path).toBe('string');
            expect(res.body.success).toBe(true);
            expect(typeof res.body.message).toBe('string');
          },
        ),
        { numRuns: 100 },
      ),
  );
});
