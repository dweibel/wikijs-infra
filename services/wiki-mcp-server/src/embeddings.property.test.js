/**
 * Property-based tests for OpenRouter embeddings client.
 * 
 * Uses fast-check library to verify universal properties hold across
 * all valid inputs.
 * 
 * Feature: wiki-mcp-access-control
 * Task: 3.1 - OpenRouter Embeddings Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { generateEmbedding, generateEmbeddings } from './embeddings.js';

describe('Embedding Property Tests', () => {
  let originalEnv;
  let mockFetch;
  
  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
    process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.EMBEDDING_MODEL = 'openai/text-embedding-3-small';
    
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });
  
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });
  
  /**
   * Property: All embeddings have exactly 1536 dimensions
   * 
   * For any valid text input, the generated embedding must always
   * have exactly 1536 dimensions (for text-embedding-3-small model).
   * 
   * **Validates: Requirements FR-2.3**
   */
  it('property: all embeddings have 1536 dimensions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 1000 }),
        async (text) => {
          // Mock successful API response
          const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
          mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              data: [{ embedding: mockEmbedding }]
            })
          });
          
          const embedding = await generateEmbedding(text);
          
          expect(embedding).toHaveLength(1536);
          expect(embedding.every(n => typeof n === 'number')).toBe(true);
          expect(embedding.every(n => !isNaN(n))).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 50 } // Reduced runs since we're mocking
    );
  });
  
  /**
   * Property: Batch embeddings preserve order
   * 
   * For any array of texts, generateEmbeddings must return embeddings
   * in the same order as the input texts.
   * 
   * **Validates: Correctness of batch processing**
   */
  it('property: batch embeddings preserve input order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 1, maxLength: 10 }),
        async (texts) => {
          // Mock responses with unique embeddings for each text
          texts.forEach((_, index) => {
            const mockEmbedding = Array(1536).fill(index / 10);
            mockFetch.mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                data: [{ embedding: mockEmbedding }]
              })
            });
          });
          
          const embeddings = await generateEmbeddings(texts);
          
          expect(embeddings).toHaveLength(texts.length);
          
          // Verify each embedding corresponds to its input by checking the unique value
          embeddings.forEach((embedding, index) => {
            expect(embedding[0]).toBeCloseTo(index / 10, 5);
          });
          
          return true;
        }
      ),
      { numRuns: 50 }
    );
  });
  
  /**
   * Property: Empty input returns empty output
   * 
   * For an empty array input, generateEmbeddings must return an empty
   * array without making any API calls.
   * 
   * **Validates: Efficiency and correctness**
   */
  it('property: empty input returns empty output without API calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant([]),
        async (emptyArray) => {
          mockFetch.mockClear();
          
          const result = await generateEmbeddings(emptyArray);
          
          expect(result).toEqual([]);
          expect(mockFetch).not.toHaveBeenCalled();
          
          return true;
        }
      ),
      { numRuns: 10 }
    );
  });
  
  /**
   * Property: API errors are propagated with context
   * 
   * For any API error, the error must be re-thrown with descriptive
   * context that helps debugging.
   * 
   * **Validates: Error handling requirements**
   */
  it('property: API errors include descriptive context', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.oneof(
          fc.constant({ status: 401, message: 'Invalid API key' }),
          fc.constant({ status: 429, message: 'Rate limit exceeded' }),
          fc.constant({ status: 500, message: 'Internal server error' })
        ),
        async (text, errorInfo) => {
          mockFetch.mockResolvedValueOnce({
            ok: false,
            status: errorInfo.status,
            statusText: errorInfo.message,
            json: async () => ({
              error: { message: errorInfo.message }
            })
          });
          
          try {
            await generateEmbedding(text);
            // Should not reach here
            expect(true).toBe(false);
          } catch (err) {
            // Error should include context
            expect(err.message).toMatch(/failed to generate embedding|OpenRouter API error/i);
            expect(err.message).toContain(errorInfo.message);
          }
          
          return true;
        }
      ),
      { numRuns: 30 }
    );
  });
  
  /**
   * Property: Dimension validation is consistent
   * 
   * For any embedding with wrong dimensions, the function must throw
   * an error indicating the dimension mismatch.
   * 
   * **Validates: Data validation requirements**
   */
  it('property: wrong dimensions always rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 3000 }).filter(n => n !== 1536),
        async (text, wrongDimension) => {
          const wrongEmbedding = Array(wrongDimension).fill(0.1);
          mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              data: [{ embedding: wrongEmbedding }]
            })
          });
          
          try {
            await generateEmbedding(text);
            // Should not reach here
            expect(true).toBe(false);
          } catch (err) {
            expect(err.message).toMatch(/unexpected embedding dimensions/i);
            expect(err.message).toContain(String(wrongDimension));
            expect(err.message).toContain('1536');
          }
          
          return true;
        }
      ),
      { numRuns: 30 }
    );
  });
});
