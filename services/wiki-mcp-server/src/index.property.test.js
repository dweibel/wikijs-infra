/**
 * Property-based tests for MCP server configuration and tool registration.
 * 
 * Uses fast-check library to verify universal properties hold across
 * all valid configuration combinations.
 * 
 * Feature: wiki-mcp-access-control
 * Task: 2.1 - Environment Variable Configuration
 * Validates: Property 5 - Write Tools Conditional Registration
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
   * Property 5: Write Tools Conditional Registration
   * 
   * For any configuration where ENABLE_WRITE_OPERATIONS is set, the system
   * should correctly determine whether write operations are enabled based on
   * the exact string value "true" (case-sensitive).
   * 
   * **Validates: Requirements FR-2.1, FR-2.2**
   */
  it('property: write operations only enabled for exact string "true"', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('true'),
          fc.constant('false'),
          fc.constant('True'),
          fc.constant('TRUE'),
          fc.constant('1'),
          fc.constant('0'),
          fc.constant('yes'),
          fc.constant('no'),
          fc.constant(''),
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => s !== 'true')
        ),
        (enableWriteOpsValue) => {
          // Set up environment
          process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
          process.env.ENABLE_WRITE_OPERATIONS = enableWriteOpsValue;
          
          if (enableWriteOpsValue === 'true') {
            process.env.WIKI_ADMIN_TOKEN = 'test-token';
          } else {
            delete process.env.WIKI_ADMIN_TOKEN;
          }
          
          const config = loadConfig();
          
          // Property: Only exact string "true" enables write operations
          if (enableWriteOpsValue === 'true') {
            expect(config.enableWriteOps).toBe(true);
          } else {
            expect(config.enableWriteOps).toBe(false);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
  
  /**
   * Property: WIKI_ADMIN_TOKEN validation is consistent
   * 
   * For any configuration, if write operations are enabled, WIKI_ADMIN_TOKEN
   * must be present and non-empty. If write operations are disabled,
   * WIKI_ADMIN_TOKEN is optional.
   * 
   * **Validates: Requirements FR-2.2**
   */
  it('property: WIKI_ADMIN_TOKEN required only when write ops enabled', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        (enableWriteOps, adminToken) => {
          const config = {
            openrouterApiKey: 'sk-or-test-key',
            enableWriteOps,
            wikiAdminToken: adminToken,
            pgPort: 5432,
            syncIntervalMs: 300000,
          };
          
          if (enableWriteOps && !adminToken) {
            // Should throw error
            expect(() => validateConfig(config)).toThrow(/WIKI_ADMIN_TOKEN required/);
          } else {
            // Should not throw error
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
   * For any configuration, OPENROUTER_API_KEY must always be present and
   * non-empty, regardless of write operations setting.
   * 
   * **Validates: Requirements FR-2.3**
   */
  it('property: OPENROUTER_API_KEY always required', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        (enableWriteOps, apiKey) => {
          const config = {
            openrouterApiKey: apiKey,
            enableWriteOps,
            wikiAdminToken: enableWriteOps ? 'test-token' : undefined,
            pgPort: 5432,
            syncIntervalMs: 300000,
          };
          
          if (!apiKey) {
            // Should throw error
            expect(() => validateConfig(config)).toThrow(/OPENROUTER_API_KEY is required/);
          } else {
            // Should not throw error
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
   * 
   * **Validates: Configuration validation correctness**
   */
  it('property: port validation accepts valid range only', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 70000 }),
        (port) => {
          const config = {
            openrouterApiKey: 'sk-or-test-key',
            enableWriteOps: false,
            pgPort: port,
            syncIntervalMs: 300000,
          };
          
          if (port >= 1 && port <= 65535) {
            // Should not throw error
            expect(() => validateConfig(config)).not.toThrow();
          } else {
            // Should throw error
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
   * 
   * **Validates: Configuration validation correctness**
   */
  it('property: sync interval validation accepts >= 1000ms only', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000000 }),
        (intervalMs) => {
          const config = {
            openrouterApiKey: 'sk-or-test-key',
            enableWriteOps: false,
            pgPort: 5432,
            syncIntervalMs: intervalMs,
          };
          
          if (intervalMs >= 1000) {
            // Should not throw error
            expect(() => validateConfig(config)).not.toThrow();
          } else {
            // Should throw error
            expect(() => validateConfig(config)).toThrow(/Invalid SYNC_INTERVAL_MS/);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
  
  /**
   * Property: Default values are consistent
   * 
   * When optional environment variables are not set, the system should
   * always use the same default values.
   * 
   * **Validates: Configuration consistency**
   */
  it('property: default values are consistent across invocations', () => {
    fc.assert(
      fc.property(
        fc.constant(undefined),
        () => {
          // Clear optional environment variables
          process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
          delete process.env.ENABLE_WRITE_OPERATIONS;
          delete process.env.WIKI_BASE_URL;
          delete process.env.EMBEDDING_MODEL;
          delete process.env.OPENROUTER_BASE_URL;
          delete process.env.SYNC_INTERVAL_MS;
          
          const config1 = loadConfig();
          const config2 = loadConfig();
          
          // Defaults should be identical across invocations
          expect(config1.enableWriteOps).toBe(config2.enableWriteOps);
          expect(config1.wikiBaseUrl).toBe(config2.wikiBaseUrl);
          expect(config1.embeddingModel).toBe(config2.embeddingModel);
          expect(config1.openrouterBaseUrl).toBe(config2.openrouterBaseUrl);
          expect(config1.syncIntervalMs).toBe(config2.syncIntervalMs);
          
          // Verify expected defaults
          expect(config1.enableWriteOps).toBe(false);
          expect(config1.wikiBaseUrl).toBe('http://localhost:3000');
          expect(config1.embeddingModel).toBe('openai/text-embedding-3-small');
          expect(config1.openrouterBaseUrl).toBe('https://openrouter.ai/api/v1');
          expect(config1.syncIntervalMs).toBe(300000);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
