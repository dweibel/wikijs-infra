// Feature: wiki-rest-api-gateway, Property 9: Content-Type header invariant
// Validates: Requirements 1.3, 15.3
//
// Feature: wiki-rest-api-gateway, Property 10: Error response structure
// Validates: Requirements 15.1

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';
import { createApp } from './server.js';

// Mock tools.js
vi.mock('./tools.js', () => ({
  getWikiPage: vi.fn(),
  createWikiPage: vi.fn(),
  updateWikiPage: vi.fn(),
  deleteWikiPage: vi.fn(),
  moveWikiPage: vi.fn(),
  searchWiki: vi.fn(),
}));

// Mock wiki-client.js
vi.mock('./wiki-client.js', () => ({
  listPages: vi.fn(),
}));

import {
  getWikiPage,
  createWikiPage,
  updateWikiPage,
  deleteWikiPage,
  moveWikiPage,
  searchWiki,
} from './tools.js';
import { listPages } from './wiki-client.js';

const API_KEY_RW = 'test-rw-key-server';
const config = {
  wikiBaseUrl: 'http://localhost:3000',
  wikiAdminToken: 'test-token',
  apiKeyRo: null,
  apiKeyRw: API_KEY_RW,
};

function buildApp() {
  return createApp({ dbClient: {}, config });
}

/** Set up mocks so that all endpoints return valid success responses. */
function setupSuccessMocks() {
  listPages.mockResolvedValue([
    { id: 1, path: '/home', title: 'Home', updatedAt: '2026-01-01T00:00:00Z' },
  ]);
  getWikiPage.mockResolvedValue({
    page_id: 1,
    title: 'Home',
    path: '/home',
    content: '# Home',
    updated_at: '2026-01-01T00:00:00Z',
  });
  searchWiki.mockResolvedValue([
    {
      page_id: 1,
      page_title: 'Home',
      page_path: '/home',
      chunk_text: 'chunk',
      relevance_score: 0.9,
    },
  ]);
  createWikiPage.mockResolvedValue({
    page_id: 2,
    path: '/new',
    title: 'New',
    success: true,
    message: 'OK',
  });
  updateWikiPage.mockResolvedValue({
    page_id: 1,
    updated_at: '2026-01-01T00:00:00Z',
    success: true,
    message: 'OK',
  });
  deleteWikiPage.mockResolvedValue({
    page_id: 1,
    success: true,
    message: 'OK',
  });
  moveWikiPage.mockResolvedValue({
    page_id: 1,
    old_path: '/old',
    new_path: '/new',
    success: true,
    message: 'OK',
  });
}


// ---------------------------------------------------------------------------
// Endpoint definitions used by both Property 9 and Property 10
// ---------------------------------------------------------------------------

/**
 * Success-path endpoints: each returns a valid response when mocks are set up.
 */
const SUCCESS_ENDPOINTS = [
  { method: 'get', path: '/health', auth: false, body: null },
  { method: 'get', path: '/api/pages', auth: true, body: null },
  { method: 'get', path: '/api/pages/1', auth: true, body: null },
  { method: 'get', path: '/api/pages/by-path?path=test', auth: true, body: null },
  { method: 'post', path: '/api/search', auth: true, body: { query: 'test' } },
  {
    method: 'post',
    path: '/api/pages',
    auth: true,
    body: { title: 'T', path: '/p', content: 'C' },
  },
  { method: 'put', path: '/api/pages/1', auth: true, body: { content: 'updated' } },
  { method: 'delete', path: '/api/pages/1', auth: true, body: null },
  {
    method: 'post',
    path: '/api/pages/1/move',
    auth: true,
    body: { destination_path: '/dest' },
  },
];

/**
 * Error-inducing scenarios: each triggers an HTTP >= 400 response.
 */
const ERROR_SCENARIOS = [
  // 401 — missing auth on protected endpoints
  { method: 'get', path: '/api/pages', auth: false, body: null, label: 'GET /api/pages no auth' },
  { method: 'get', path: '/api/pages/1', auth: false, body: null, label: 'GET /api/pages/1 no auth' },
  { method: 'get', path: '/api/pages/by-path?path=x', auth: false, body: null, label: 'GET by-path no auth' },
  { method: 'post', path: '/api/search', auth: false, body: { query: 'q' }, label: 'POST /api/search no auth' },
  { method: 'post', path: '/api/pages', auth: false, body: { title: 'T', path: '/p', content: 'C' }, label: 'POST /api/pages no auth' },
  { method: 'put', path: '/api/pages/1', auth: false, body: { content: 'x' }, label: 'PUT /api/pages/1 no auth' },
  { method: 'delete', path: '/api/pages/1', auth: false, body: null, label: 'DELETE /api/pages/1 no auth' },
  { method: 'post', path: '/api/pages/1/move', auth: false, body: { destination_path: '/d' }, label: 'POST move no auth' },
  // 400 — invalid ID
  { method: 'get', path: '/api/pages/abc', auth: true, body: null, label: 'GET invalid id' },
  { method: 'put', path: '/api/pages/abc', auth: true, body: { content: 'x' }, label: 'PUT invalid id' },
  { method: 'delete', path: '/api/pages/abc', auth: true, body: null, label: 'DELETE invalid id' },
  { method: 'post', path: '/api/pages/abc/move', auth: true, body: { destination_path: '/d' }, label: 'POST move invalid id' },
  // 400 — missing required fields
  { method: 'post', path: '/api/pages', auth: true, body: {}, label: 'POST /api/pages empty body' },
  { method: 'post', path: '/api/search', auth: true, body: {}, label: 'POST /api/search empty body' },
  { method: 'get', path: '/api/pages/by-path', auth: true, body: null, label: 'GET by-path no param' },
  { method: 'post', path: '/api/pages/1/move', auth: true, body: {}, label: 'POST move no dest' },
];

const successEndpointArb = fc.constantFrom(...SUCCESS_ENDPOINTS);
const errorScenarioArb = fc.constantFrom(...ERROR_SCENARIOS);

/** Helper: send a request for a given endpoint descriptor. */
function sendRequest(app, ep) {
  let req = request(app)[ep.method](ep.path);
  if (ep.auth) {
    req = req.set('Authorization', `Bearer ${API_KEY_RW}`);
  }
  if (ep.body) {
    req = req.send(ep.body);
  }
  return req;
}

// ---------------------------------------------------------------------------
// Property 9: Content-Type header invariant
// ---------------------------------------------------------------------------

describe('Property 9: Content-Type header invariant', { tags: ['property'] }, () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    setupSuccessMocks();
  });

  /**
   * **Validates: Requirements 1.3, 15.3**
   *
   * For any response from any gateway endpoint (success or error),
   * the Content-Type response header shall be application/json.
   */
  it(
    'all success responses have Content-Type application/json',
    () =>
      fc.assert(
        fc.asyncProperty(successEndpointArb, async (ep) => {
          setupSuccessMocks();
          const res = await sendRequest(app, ep);
          expect(res.headers['content-type']).toContain('application/json');
        }),
        { numRuns: 100 },
      ),
  );

  it(
    'all error responses have Content-Type application/json',
    () =>
      fc.assert(
        fc.asyncProperty(errorScenarioArb, async (ep) => {
          const res = await sendRequest(app, ep);
          expect(res.status).toBeGreaterThanOrEqual(400);
          expect(res.headers['content-type']).toContain('application/json');
        }),
        { numRuns: 100 },
      ),
  );
});

// ---------------------------------------------------------------------------
// Property 10: Error response structure
// ---------------------------------------------------------------------------

describe('Property 10: Error response structure', { tags: ['property'] }, () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    setupSuccessMocks();
  });

  /**
   * **Validates: Requirements 15.1**
   *
   * For any error response (HTTP status >= 400) from any gateway endpoint,
   * the response body shall be a valid JSON object containing at minimum
   * an error string field.
   */
  it(
    'all error responses contain a JSON body with an error string field',
    () =>
      fc.assert(
        fc.asyncProperty(errorScenarioArb, async (ep) => {
          const res = await sendRequest(app, ep);
          expect(res.status).toBeGreaterThanOrEqual(400);
          expect(res.body).toBeDefined();
          expect(typeof res.body).toBe('object');
          expect(res.body).toHaveProperty('error');
          expect(typeof res.body.error).toBe('string');
          expect(res.body.error.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      ),
  );
});

// ---------------------------------------------------------------------------
// Property 11: Unhandled exception safety
// ---------------------------------------------------------------------------

describe('Property 11: Unhandled exception safety', { tags: ['property'] }, () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Endpoints that call tools.js / wiki-client.js functions.
   * Each entry includes the mock to sabotage and a valid request shape.
   */
  const THROWING_ENDPOINTS = [
    { method: 'get', path: '/api/pages', mock: listPages, body: null, label: 'GET /api/pages' },
    { method: 'get', path: '/api/pages/1', mock: getWikiPage, body: null, label: 'GET /api/pages/1' },
    { method: 'get', path: '/api/pages/by-path?path=test', mock: getWikiPage, body: null, label: 'GET /api/pages/by-path' },
    { method: 'post', path: '/api/search', mock: searchWiki, body: { query: 'test' }, label: 'POST /api/search' },
    {
      method: 'post',
      path: '/api/pages',
      mock: createWikiPage,
      body: { title: 'T', path: '/p', content: 'C' },
      label: 'POST /api/pages',
    },
    { method: 'put', path: '/api/pages/1', mock: updateWikiPage, body: { content: 'x' }, label: 'PUT /api/pages/1' },
    { method: 'delete', path: '/api/pages/1', mock: deleteWikiPage, body: null, label: 'DELETE /api/pages/1' },
    {
      method: 'post',
      path: '/api/pages/1/move',
      mock: moveWikiPage,
      body: { destination_path: '/dest' },
      label: 'POST /api/pages/1/move',
    },
  ];

  const throwingEndpointArb = fc.constantFrom(...THROWING_ENDPOINTS);

  /**
   * Arbitrary that generates error messages guaranteed NOT to be a substring
   * of the generic 500 response body, so the "no leak" assertion is meaningful.
   */
  const GENERIC_BODY = '{"error":"Internal server error"}';
  const safeErrorMsgArb = fc
    .stringMatching(/^[A-Z][A-Za-z0-9_]{4,50}$/)
    .filter((s) => !GENERIC_BODY.includes(s));

  /**
   * **Validates: Requirements 15.2**
   *
   * For any route handler that throws an unhandled exception, the gateway
   * shall respond with HTTP 500 and a JSON body {"error": "Internal server error"}
   * without leaking stack traces or internal details.
   */
  it(
    'unhandled exceptions return 500 with generic error and no leaked details',
    () =>
      fc.assert(
        fc.asyncProperty(
          throwingEndpointArb,
          safeErrorMsgArb,
          async (ep, errorMsg) => {
            // Reset all mocks and set up defaults so non-target mocks succeed
            vi.clearAllMocks();
            setupSuccessMocks();

            // Override the specific mock to throw an unhandled exception
            ep.mock.mockRejectedValue(new Error(errorMsg));

            let req = request(app)[ep.method](ep.path);
            req = req.set('Authorization', `Bearer ${API_KEY_RW}`);
            if (ep.body) {
              req = req.send(ep.body);
            }

            const res = await req;

            // Must be 500
            expect(res.status).toBe(500);

            // Must have exactly the generic error message
            expect(res.body).toEqual({ error: 'Internal server error' });

            // Response body as string must NOT contain the thrown error message
            const bodyStr = JSON.stringify(res.body);
            expect(bodyStr).not.toContain(errorMsg);

            // Must not contain stack trace indicators
            expect(bodyStr).not.toContain('at ');
            expect(bodyStr).not.toContain('Error:');
            expect(bodyStr).not.toContain('stack');
          },
        ),
        { numRuns: 100 },
      ),
  );
});

// ---------------------------------------------------------------------------
// Property 12: Upstream failure on search returns 502
// ---------------------------------------------------------------------------

describe('Property 12: Upstream failure on search returns 502', { tags: ['property'] }, () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const upstreamErrorPrefixArb = fc.constantFrom(
    'Search failed: ',
    'Failed to generate embedding: ',
  );

  /**
   * **Validates: Requirements 4.4**
   *
   * For any POST /api/search request where the embedding generation or
   * database query fails, the gateway shall respond with HTTP 502 and a
   * JSON body containing an error field.
   */
  it(
    'upstream failures on search return 502 with error field',
    () =>
      fc.assert(
        fc.asyncProperty(
          upstreamErrorPrefixArb,
          fc.string({ minLength: 1, maxLength: 200 }),
          async (prefix, suffix) => {
            vi.clearAllMocks();

            const errorMessage = `${prefix}${suffix}`;
            searchWiki.mockResolvedValue({ error: errorMessage });

            const res = await request(app)
              .post('/api/search')
              .set('Authorization', `Bearer ${API_KEY_RW}`)
              .send({ query: 'test query' });

            // Must be 502
            expect(res.status).toBe(502);

            // Must have an error field that is a non-empty string
            expect(res.body).toBeDefined();
            expect(typeof res.body.error).toBe('string');
            expect(res.body.error.length).toBeGreaterThan(0);

            // The error field should contain the upstream error message
            expect(res.body.error).toBe(errorMessage);
          },
        ),
        { numRuns: 100 },
      ),
  );
});
