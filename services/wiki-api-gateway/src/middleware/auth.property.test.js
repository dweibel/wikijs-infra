// Feature: wiki-rest-api-gateway, Property 7: Authentication enforcement
// Validates: Requirements 9.1, 9.2

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import request from 'supertest';
import { createAuthMiddleware } from './auth.js';

const API_KEY_RO = 'test-ro-key-prop7-abc123';
const API_KEY_RW = 'test-rw-key-prop7-xyz789';

/**
 * Protected endpoints — every endpoint except GET /health.
 * Each entry has a method and path suitable for supertest.
 */
const PROTECTED_ENDPOINTS = [
  { method: 'get', path: '/api/pages' },
  { method: 'get', path: '/api/pages/1' },
  { method: 'get', path: '/api/pages/by-path' },
  { method: 'post', path: '/api/search' },
  { method: 'post', path: '/api/pages' },
  { method: 'put', path: '/api/pages/1' },
  { method: 'delete', path: '/api/pages/1' },
  { method: 'post', path: '/api/pages/1/move' },
];

/**
 * Build a minimal Express app with auth middleware on /api/*
 * and a catch-all that returns 200 for any authenticated request.
 * Health endpoint is mounted without auth.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());

  // Health — no auth
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Auth middleware on all /api routes
  app.use('/api', createAuthMiddleware({ apiKeyRo: API_KEY_RO, apiKeyRw: API_KEY_RW }));

  // Catch-all for authenticated requests
  app.all('/api/*', (_req, res) => res.status(200).json({ ok: true }));

  return app;
}

/**
 * Generator for random tokens that do NOT match either valid API key.
 * Filters out the two valid keys so every generated value is guaranteed invalid.
 */
const invalidTokenArb = fc.string({ minLength: 0, maxLength: 200 }).filter(
  (s) => s !== API_KEY_RO && s !== API_KEY_RW,
);

/** Pick a random protected endpoint. */
const endpointArb = fc.constantFrom(...PROTECTED_ENDPOINTS);

describe('Property 7: Authentication enforcement', () => {
  const app = createTestApp();

  it(
    'returns 401 with {"error":"Unauthorized"} when Authorization header is missing, for any protected endpoint',
    () =>
      fc.assert(
        fc.asyncProperty(endpointArb, async (endpoint) => {
          const res = await request(app)[endpoint.method](endpoint.path);

          expect(res.status).toBe(401);
          expect(res.body).toEqual({ error: 'Unauthorized' });
        }),
        { numRuns: 100 },
      ),
  );

  it(
    'returns 401 with {"error":"Unauthorized"} when Bearer token is invalid, for any protected endpoint',
    () =>
      fc.assert(
        fc.asyncProperty(endpointArb, invalidTokenArb, async (endpoint, token) => {
          const res = await request(app)
            [endpoint.method](endpoint.path)
            .set('Authorization', `Bearer ${token}`);

          expect(res.status).toBe(401);
          expect(res.body).toEqual({ error: 'Unauthorized' });
        }),
        { numRuns: 100 },
      ),
  );

  it(
    'returns 401 when Authorization header uses a non-Bearer scheme, for any protected endpoint',
    () =>
      fc.assert(
        fc.asyncProperty(
          endpointArb,
          fc.constantFrom('Basic', 'Token', 'Digest', 'ApiKey'),
          invalidTokenArb,
          async (endpoint, scheme, token) => {
            const res = await request(app)
              [endpoint.method](endpoint.path)
              .set('Authorization', `${scheme} ${token}`);

            expect(res.status).toBe(401);
            expect(res.body).toEqual({ error: 'Unauthorized' });
          },
        ),
        { numRuns: 100 },
      ),
  );

  it('GET /health does NOT require authentication (control check)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

// Feature: wiki-rest-api-gateway, Property 8: Access tier enforcement
// Validates: Requirements 10.1, 10.2, 10.3

/**
 * Read endpoints — accessible by both RO and RW keys.
 */
const READ_ENDPOINTS = [
  { method: 'get', path: '/api/pages' },
  { method: 'get', path: '/api/pages/1' },
  { method: 'get', path: '/api/pages/by-path' },
  { method: 'post', path: '/api/search' },
];

/**
 * Write endpoints — accessible only by RW keys.
 */
const WRITE_ENDPOINTS = [
  { method: 'post', path: '/api/pages' },
  { method: 'put', path: '/api/pages/1' },
  { method: 'delete', path: '/api/pages/1' },
  { method: 'post', path: '/api/pages/1/move' },
];

const readEndpointArb = fc.constantFrom(...READ_ENDPOINTS);
const writeEndpointArb = fc.constantFrom(...WRITE_ENDPOINTS);
const allEndpointArb = fc.constantFrom(...READ_ENDPOINTS, ...WRITE_ENDPOINTS);

describe('Property 8: Access tier enforcement', () => {
  const app = createTestApp();

  it(
    'RO key is permitted on any read endpoint (200)',
    () =>
      fc.assert(
        fc.asyncProperty(readEndpointArb, async (endpoint) => {
          const res = await request(app)
            [endpoint.method](endpoint.path)
            .set('Authorization', `Bearer ${API_KEY_RO}`);

          expect(res.status).toBe(200);
        }),
        { numRuns: 100 },
      ),
  );

  it(
    'RO key is rejected with 403 on any write endpoint',
    () =>
      fc.assert(
        fc.asyncProperty(writeEndpointArb, async (endpoint) => {
          const res = await request(app)
            [endpoint.method](endpoint.path)
            .set('Authorization', `Bearer ${API_KEY_RO}`);

          expect(res.status).toBe(403);
          expect(res.body).toEqual({
            error: 'Forbidden: read-only key cannot access write endpoints',
          });
        }),
        { numRuns: 100 },
      ),
  );

  it(
    'RW key is permitted on all endpoints (read and write)',
    () =>
      fc.assert(
        fc.asyncProperty(allEndpointArb, async (endpoint) => {
          const res = await request(app)
            [endpoint.method](endpoint.path)
            .set('Authorization', `Bearer ${API_KEY_RW}`);

          expect(res.status).toBe(200);
        }),
        { numRuns: 100 },
      ),
  );
});
