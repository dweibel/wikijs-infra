/**
 * Property-based test for sync pipeline error resilience.
 *
 * Feature: wiki-rest-api-gateway, Property 14: Sync pipeline error resilience
 * **Validates: Requirements 12.4**
 *
 * For any error thrown during a sync cycle, the gateway process shall remain
 * running and the next scheduled sync cycle shall execute normally.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { startSync } from './sync.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('./wiki-client.js', () => ({
  listPages: vi.fn(),
  getPageContent: vi.fn(),
}));

vi.mock('./embeddings.js', () => ({
  generateEmbeddings: vi.fn(),
}));

vi.mock('./db.js', () => ({
  upsertEmbeddings: vi.fn(),
  deletePageEmbeddings: vi.fn(),
}));

vi.mock('./chunker.js', () => ({
  chunkText: vi.fn(),
}));

import { listPages } from './wiki-client.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = 'http://wiki.local';

function makeDbClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  };
}

// ─── Property 14: Sync pipeline error resilience ─────────────────────────────

describe('Property 14: Sync pipeline error resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('property: for any error thrown during a sync cycle, the process remains running and the next sync executes normally', async () => {
    // Feature: wiki-rest-api-gateway, Property 14: Sync pipeline error resilience
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.string({ minLength: 1, maxLength: 200 }),
          fc.constant('ECONNREFUSED'),
          fc.constant('ETIMEDOUT'),
          fc.constant('Network error'),
          fc.constant('GraphQL error'),
          fc.constant(null),
          fc.constant(undefined),
          fc.integer()
        ),
        async (errorValue) => {
          vi.clearAllMocks();

          const dbClient = makeDbClient();
          const intervalMs = 5000;

          // First call: listPages throws an error
          // Second call: listPages succeeds
          let callCount = 0;
          listPages.mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              throw typeof errorValue === 'string'
                ? new Error(errorValue)
                : new Error(String(errorValue));
            }
            return Promise.resolve([]);
          });

          // Start the sync pipeline
          const stop = startSync(dbClient, BASE_URL, intervalMs);

          // The stop function should exist (process didn't crash)
          expect(typeof stop).toBe('function');

          // Flush the immediate setTimeout(0) call — this triggers the first sync
          // which will throw an error, caught by .catch()
          await vi.runOnlyPendingTimersAsync();

          // First call should have happened and failed
          expect(listPages).toHaveBeenCalledTimes(1);

          // Advance timers to trigger the next interval-based sync cycle
          await vi.advanceTimersByTimeAsync(intervalMs);

          // Second call should have happened and succeeded
          expect(listPages).toHaveBeenCalledTimes(2);

          // Clean up
          stop();
        }
      ),
      { numRuns: 100 }
    );
  });
});
