/**
 * Property-based tests for Wiki REST API Gateway configuration.
 * 
 * Uses fast-check library to verify universal properties hold across
 * all valid configuration combinations.
 * 
 * Feature: wiki-rest-api-gateway
 * Task: 1.2 - Extend config.js with new environment variables
 * Validates: Requirements 9.3, 9.4, 13.1, 13.2, 13.3, 13.4, 13.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { loadConfig, validateConfig } from './config.js';

describe('Configuration Property-Based Tests', () => {
  let originalEnv;
  
  beforeEach(() => {
    originalEnv = { ...process.env };
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * Property: At least one API key must be configured
   * 
   * For any configuration, at least one of API_KEY_RO or API_KEY_RW must be set.
   * If neither is set, startup must be refused.
   * 
   * **Validates: Requirements 9.4, 13.3**
   */
  it('property: at least one API key must be configured', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
        fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
        (apiKeyRo, apiKeyRw) => {
          const config = {
            apiKeyRo,
            apiKeyRw,
            wikiAdminToken: apiKeyRw ? 'test-token' : undefined,
            openrouterApiKey: 'sk-or-test-key',
            gatewayPort: 3001,
            pgPort: 5432,
            syncIntervalMs: 300000,
          };

          if (!apiKeyRo && !apiKeyRw) {
            expect(() => validateConfig(config)).toThrow(/At least one of API_KEY_RO or API_KEY_RW must be configured/);
          } else {
            expect(() => validateConfig(config)).not.toThrow();
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: WIKI_ADMIN_TOKEN required when API_KEY_RW is configured
   * 
   * **Validates: Requirements 13.4**
   */
  it('property: WIKI_ADMIN_TOKEN required only when API_KEY_RW is configured', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
        fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        (apiKeyRw, adminToken) => {
          const config = {
            apiKeyRo: 'test-ro-key',
            apiKeyRw,
            wikiAdminToken: adminToken,
            openrouterApiKey: 'sk-or-test-key',
            gatewayPort: 3001,
            pgPort: 5432,
            syncIntervalMs: 300000,
          };

          if (apiKeyRw && !adminToken) {
            expect(() => validateConfig(config)).toThrow(/WIKI_ADMIN_TOKEN required/);
          } else {
            expect(() => validateConfig(config)).not.toThrow();
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: OPENROUTER_API_KEY always required
   * 
   * **Validates: Requirements 13.2**
   */
  it('property: OPENROUTER_API_KEY always required', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        (apiKey) => {
          const config = {
            apiKeyRo: 'test-ro-key',
            apiKeyRw: null,
            openrouterApiKey: apiKey,
            gatewayPort: 3001,
            pgPort: 5432,
            syncIntervalMs: 300000,
          };

          if (!apiKey) {
            expect(() => validateConfig(config)).toThrow(/OPENROUTER_API_KEY is required/);
          } else {
            expect(() => validateConfig(config)).not.toThrow();
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Port validation is consistent
   * 
   * For any port number, validation should accept values in range [1, 65535]
   * and reject all others.
   */
  it('property: port validation accepts valid range only', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 70000 }),
        (port) => {
          const config = {
            apiKeyRo: 'test-ro-key',
            apiKeyRw: null,
            openrouterApiKey: 'sk-or-test-key',
            gatewayPort: 3001,
            pgPort: port,
            syncIntervalMs: 300000,
          };

          if (port >= 1 && port <= 65535) {
            expect(() => validateConfig(config)).not.toThrow();
          } else {
            expect(() => validateConfig(config)).toThrow(/Invalid PGPORT/);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Sync interval validation is consistent
   * 
   * For any sync interval, validation should accept values >= 1000ms
   * and reject all others.
   */
  it('property: sync interval validation accepts >= 1000ms only', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000000 }),
        (intervalMs) => {
          const config = {
            apiKeyRo: 'test-ro-key',
            apiKeyRw: null,
            openrouterApiKey: 'sk-or-test-key',
            gatewayPort: 3001,
            pgPort: 5432,
            syncIntervalMs: intervalMs,
          };

          if (intervalMs >= 1000) {
            expect(() => validateConfig(config)).not.toThrow();
          } else {
            expect(() => validateConfig(config)).toThrow(/Invalid SYNC_INTERVAL_MS/);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Default values are consistent across invocations
   * 
   * **Validates: Requirements 13.5**
   */
  it('property: default values are consistent across invocations', () => {
    fc.assert(
      fc.property(
        fc.constant(undefined),
        () => {
          process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
          process.env.API_KEY_RO = 'test-ro-key';
          delete process.env.API_KEY_RW;
          delete process.env.WIKI_BASE_URL;
          delete process.env.EMBEDDING_MODEL;
          delete process.env.OPENROUTER_BASE_URL;
          delete process.env.SYNC_INTERVAL_MS;
          delete process.env.GATEWAY_PORT;

          const config1 = loadConfig();
          const config2 = loadConfig();

          expect(config1.wikiBaseUrl).toBe(config2.wikiBaseUrl);
          expect(config1.embeddingModel).toBe(config2.embeddingModel);
          expect(config1.openrouterBaseUrl).toBe(config2.openrouterBaseUrl);
          expect(config1.syncIntervalMs).toBe(config2.syncIntervalMs);
          expect(config1.gatewayPort).toBe(config2.gatewayPort);

          // Verify expected defaults
          expect(config1.wikiBaseUrl).toBe('http://localhost:3000');
          expect(config1.embeddingModel).toBe('openai/text-embedding-3-small');
          expect(config1.openrouterBaseUrl).toBe('https://openrouter.ai/api/v1');
          expect(config1.syncIntervalMs).toBe(300000);
          expect(config1.gatewayPort).toBe(3001);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
