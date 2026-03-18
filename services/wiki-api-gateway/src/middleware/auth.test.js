import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthMiddleware } from './auth.js';

const RO_KEY = 'test-ro-key-abc123';
const RW_KEY = 'test-rw-key-xyz789';

/** Helper to build a minimal Express-like req/res/next triple. */
function mockReqRes({ method = 'GET', path = '/api/pages', authorization } = {}) {
  const req = {
    method,
    path,
    originalUrl: path,
    headers: {},
  };
  if (authorization !== undefined) {
    req.headers.authorization = authorization;
  }

  const res = {
    _status: null,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };

  let nextCalled = false;
  const next = () => { nextCalled = true; };

  return { req, res, next, wasNextCalled: () => nextCalled };
}

describe('createAuthMiddleware', () => {
  let middleware;

  beforeEach(() => {
    middleware = createAuthMiddleware({ apiKeyRo: RO_KEY, apiKeyRw: RW_KEY });
  });

  // --- 401 Unauthorized cases ---

  it('returns 401 when Authorization header is missing', () => {
    const { req, res, next, wasNextCalled } = mockReqRes();
    middleware(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Unauthorized' });
    expect(wasNextCalled()).toBe(false);
  });

  it('returns 401 when Authorization header has no Bearer prefix', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      authorization: `Token ${RO_KEY}`,
    });
    middleware(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Unauthorized' });
    expect(wasNextCalled()).toBe(false);
  });

  it('returns 401 when bearer token does not match any key', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      authorization: 'Bearer wrong-key-entirely',
    });
    middleware(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Unauthorized' });
    expect(wasNextCalled()).toBe(false);
  });

  it('returns 401 for empty bearer token', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      authorization: 'Bearer ',
    });
    middleware(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Unauthorized' });
    expect(wasNextCalled()).toBe(false);
  });

  // --- RO key on read endpoints ---

  it('allows RO key on GET /api/pages and sets accessTier to ro', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'GET',
      path: '/api/pages',
      authorization: `Bearer ${RO_KEY}`,
    });
    middleware(req, res, next);

    expect(wasNextCalled()).toBe(true);
    expect(req.accessTier).toBe('ro');
  });

  it('allows RO key on GET /api/pages/:id', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'GET',
      path: '/api/pages/42',
      authorization: `Bearer ${RO_KEY}`,
    });
    middleware(req, res, next);

    expect(wasNextCalled()).toBe(true);
    expect(req.accessTier).toBe('ro');
  });

  it('allows RO key on GET /api/pages/by-path', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'GET',
      path: '/api/pages/by-path',
      authorization: `Bearer ${RO_KEY}`,
    });
    middleware(req, res, next);

    expect(wasNextCalled()).toBe(true);
    expect(req.accessTier).toBe('ro');
  });

  it('allows RO key on POST /api/search', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'POST',
      path: '/api/search',
      authorization: `Bearer ${RO_KEY}`,
    });
    middleware(req, res, next);

    expect(wasNextCalled()).toBe(true);
    expect(req.accessTier).toBe('ro');
  });

  // --- 403 Forbidden: RO key on write endpoints ---

  it('returns 403 for RO key on POST /api/pages', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'POST',
      path: '/api/pages',
      authorization: `Bearer ${RO_KEY}`,
    });
    middleware(req, res, next);

    expect(res._status).toBe(403);
    expect(res._body).toEqual({
      error: 'Forbidden: read-only key cannot access write endpoints',
    });
    expect(wasNextCalled()).toBe(false);
  });

  it('returns 403 for RO key on PUT /api/pages/:id', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'PUT',
      path: '/api/pages/99',
      authorization: `Bearer ${RO_KEY}`,
    });
    middleware(req, res, next);

    expect(res._status).toBe(403);
    expect(res._body).toEqual({
      error: 'Forbidden: read-only key cannot access write endpoints',
    });
    expect(wasNextCalled()).toBe(false);
  });

  it('returns 403 for RO key on DELETE /api/pages/:id', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'DELETE',
      path: '/api/pages/5',
      authorization: `Bearer ${RO_KEY}`,
    });
    middleware(req, res, next);

    expect(res._status).toBe(403);
    expect(res._body).toEqual({
      error: 'Forbidden: read-only key cannot access write endpoints',
    });
    expect(wasNextCalled()).toBe(false);
  });

  it('returns 403 for RO key on POST /api/pages/:id/move', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'POST',
      path: '/api/pages/7/move',
      authorization: `Bearer ${RO_KEY}`,
    });
    middleware(req, res, next);

    expect(res._status).toBe(403);
    expect(res._body).toEqual({
      error: 'Forbidden: read-only key cannot access write endpoints',
    });
    expect(wasNextCalled()).toBe(false);
  });

  // --- RW key on all endpoints ---

  it('allows RW key on read endpoints and sets accessTier to rw', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'GET',
      path: '/api/pages',
      authorization: `Bearer ${RW_KEY}`,
    });
    middleware(req, res, next);

    expect(wasNextCalled()).toBe(true);
    expect(req.accessTier).toBe('rw');
  });

  it('allows RW key on POST /api/pages', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'POST',
      path: '/api/pages',
      authorization: `Bearer ${RW_KEY}`,
    });
    middleware(req, res, next);

    expect(wasNextCalled()).toBe(true);
    expect(req.accessTier).toBe('rw');
  });

  it('allows RW key on PUT /api/pages/:id', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'PUT',
      path: '/api/pages/42',
      authorization: `Bearer ${RW_KEY}`,
    });
    middleware(req, res, next);

    expect(wasNextCalled()).toBe(true);
    expect(req.accessTier).toBe('rw');
  });

  it('allows RW key on DELETE /api/pages/:id', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'DELETE',
      path: '/api/pages/42',
      authorization: `Bearer ${RW_KEY}`,
    });
    middleware(req, res, next);

    expect(wasNextCalled()).toBe(true);
    expect(req.accessTier).toBe('rw');
  });

  it('allows RW key on POST /api/pages/:id/move', () => {
    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'POST',
      path: '/api/pages/42/move',
      authorization: `Bearer ${RW_KEY}`,
    });
    middleware(req, res, next);

    expect(wasNextCalled()).toBe(true);
    expect(req.accessTier).toBe('rw');
  });

  // --- Edge cases: only one key configured ---

  it('works when only apiKeyRo is configured', () => {
    const mw = createAuthMiddleware({ apiKeyRo: RO_KEY, apiKeyRw: null });

    const { req, res, next, wasNextCalled } = mockReqRes({
      authorization: `Bearer ${RO_KEY}`,
    });
    mw(req, res, next);

    expect(wasNextCalled()).toBe(true);
    expect(req.accessTier).toBe('ro');
  });

  it('returns 401 for RW key when only apiKeyRo is configured', () => {
    const mw = createAuthMiddleware({ apiKeyRo: RO_KEY, apiKeyRw: null });

    const { req, res, next, wasNextCalled } = mockReqRes({
      authorization: `Bearer ${RW_KEY}`,
    });
    mw(req, res, next);

    expect(res._status).toBe(401);
    expect(wasNextCalled()).toBe(false);
  });

  it('works when only apiKeyRw is configured', () => {
    const mw = createAuthMiddleware({ apiKeyRo: null, apiKeyRw: RW_KEY });

    const { req, res, next, wasNextCalled } = mockReqRes({
      method: 'POST',
      path: '/api/pages',
      authorization: `Bearer ${RW_KEY}`,
    });
    mw(req, res, next);

    expect(wasNextCalled()).toBe(true);
    expect(req.accessTier).toBe('rw');
  });

  it('returns 401 for RO key when only apiKeyRw is configured', () => {
    const mw = createAuthMiddleware({ apiKeyRo: null, apiKeyRw: RW_KEY });

    const { req, res, next, wasNextCalled } = mockReqRes({
      authorization: `Bearer ${RO_KEY}`,
    });
    mw(req, res, next);

    expect(res._status).toBe(401);
    expect(wasNextCalled()).toBe(false);
  });
});
