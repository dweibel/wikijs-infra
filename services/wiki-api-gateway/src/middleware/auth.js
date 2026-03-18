import crypto from 'node:crypto';

/**
 * Write endpoints that require 'rw' access tier.
 * Matched against req.method + req.path.
 */
const WRITE_PATTERNS = [
  { method: 'POST', pattern: /^\/api\/pages$/ },
  { method: 'PUT', pattern: /^\/api\/pages\/\d+$/ },
  { method: 'DELETE', pattern: /^\/api\/pages\/\d+$/ },
  { method: 'POST', pattern: /^\/api\/pages\/\d+\/move$/ },
];

/**
 * Constant-time comparison of two strings.
 * Returns false immediately if lengths differ (unavoidable with timingSafeEqual),
 * but this only leaks length, not content.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Checks whether the request targets a write endpoint.
 * Uses req.originalUrl so patterns match regardless of Express mount point.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isWriteEndpoint(req) {
  return WRITE_PATTERNS.some(
    ({ method, pattern }) => req.method === method && pattern.test(req.originalUrl),
  );
}

/**
 * Creates Express middleware that validates API keys and enforces access tiers.
 *
 * @param {Object} opts
 * @param {string|null} opts.apiKeyRo - Read-only API key (or null if not configured)
 * @param {string|null} opts.apiKeyRw - Read-write API key (or null if not configured)
 * @returns {Function} Express middleware (req, res, next)
 *
 * Sets req.accessTier to 'ro' or 'rw' on success.
 * Responds 401 for missing/invalid key, 403 for RO key on write endpoint.
 */
export function createAuthMiddleware({ apiKeyRo, apiKeyRw }) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.slice(7); // strip "Bearer "

    // Check against rw key first (higher privilege)
    if (apiKeyRw && safeEqual(token, apiKeyRw)) {
      req.accessTier = 'rw';
      return next();
    }

    // Check against ro key
    if (apiKeyRo && safeEqual(token, apiKeyRo)) {
      req.accessTier = 'ro';

      if (isWriteEndpoint(req)) {
        return res.status(403).json({
          error: 'Forbidden: read-only key cannot access write endpoints',
        });
      }

      return next();
    }

    // No key matched
    return res.status(401).json({ error: 'Unauthorized' });
  };
}
