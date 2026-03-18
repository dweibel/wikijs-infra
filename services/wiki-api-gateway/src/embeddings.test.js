/**
 * Unit tests for the OpenRouter embedding client.
 *
 * Feature: wiki-mcp-access-control
 * Task: 3.1 - OpenRouter Embeddings Client
 *
 * Design decisions:
 * - generateEmbedding('') → calls OpenRouter and returns a 1536-dim embedding.
 *   Empty strings are valid inputs; the model handles them.
 * - generateEmbedding when API throws → re-throws with descriptive message
 * - generateEmbeddings([]) → returns [] immediately without calling API
 * - generateEmbeddings when one call fails → throws, propagating the error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateEmbedding, generateEmbeddings } from './embeddings.js';

describe('generateEmbedding (OpenRouter)', () => {
  let originalEnv;
  let mockFetch;
  
  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
    process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.EMBEDDING_MODEL = 'openai/text-embedding-3-small';
    
    // Mock global fetch
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });
  
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });
  
  it('returns a 1536-dimensional float array for valid text', async () => {
    const mockEmbedding = Array.from({ length: 1536 }, (_, i) => i / 1536);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: mockEmbedding }]
      })
    });
    
    const result = await generateEmbedding('Hello, wiki!');
    
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1536);
    result.forEach((v) => expect(typeof v).toBe('number'));
  });
  
  it('calls OpenRouter API with correct parameters', async () => {
    const mockEmbedding = Array(1536).fill(0.1);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: mockEmbedding }]
      })
    });
    
    await generateEmbedding('test text');
    
    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer sk-or-test-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          model: 'openai/text-embedding-3-small',
          input: 'test text',
        }),
      })
    );
  });
  
  it('still calls OpenRouter and returns an embedding for empty string', async () => {
    const mockEmbedding = Array(1536).fill(0.0);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: mockEmbedding }]
      })
    });
    
    const result = await generateEmbedding('');
    
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1536);
  });
  
  it('throws error when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    
    await expect(generateEmbedding('test')).rejects.toThrow(/OPENROUTER_API_KEY.*required/i);
  });
  
  it('throws error when API returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({
        error: { message: 'Invalid API key' }
      })
    });
    
    await expect(generateEmbedding('test')).rejects.toThrow(/Invalid API key/i);
  });
  
  it('throws error when API returns wrong embedding dimensions', async () => {
    const wrongDimensions = Array(1024).fill(0.1);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: wrongDimensions }]
      })
    });
    
    await expect(generateEmbedding('test')).rejects.toThrow(/Unexpected embedding dimensions.*1024.*expected 1536/i);
  });
  
  it('propagates a descriptive error when API throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    
    await expect(generateEmbedding('some text')).rejects.toThrow(
      /failed to generate embedding/i
    );
  });
  
  it('includes the original error message in the thrown error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection timeout'));
    
    await expect(generateEmbedding('some text')).rejects.toThrow(
      /Connection timeout/i
    );
  });
  
  it('respects custom OPENROUTER_BASE_URL', async () => {
    process.env.OPENROUTER_BASE_URL = 'https://custom.api.com/v1';
    const mockEmbedding = Array(1536).fill(0.1);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: mockEmbedding }]
      })
    });
    
    await generateEmbedding('test');
    
    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom.api.com/v1/embeddings',
      expect.anything()
    );
  });
  
  it('respects custom EMBEDDING_MODEL', async () => {
    process.env.EMBEDDING_MODEL = 'custom/model';
    const mockEmbedding = Array(1536).fill(0.1);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: mockEmbedding }]
      })
    });
    
    await generateEmbedding('test');
    
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('custom/model');
  });
});

describe('generateEmbeddings (OpenRouter)', () => {
  let originalEnv;
  let mockFetch;
  
  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });
  
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });
  
  it('returns an array of embeddings, one per input text', async () => {
    const texts = ['first chunk', 'second chunk', 'third chunk'];
    texts.forEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: Array(1536).fill(0.1) }]
        })
      });
    });
    
    const results = await generateEmbeddings(texts);
    
    expect(results).toHaveLength(3);
    results.forEach((embedding) => {
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding).toHaveLength(1536);
    });
  });
  
  it('returns empty array for empty input without calling API', async () => {
    const results = await generateEmbeddings([]);
    
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  
  it('preserves order — each result corresponds to its input text', async () => {
    const vectors = [
      Array(1536).fill(0.1),
      Array(1536).fill(0.2),
    ];
    vectors.forEach((v) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: v }]
        })
      });
    });
    
    const results = await generateEmbeddings(['text A', 'text B']);
    
    expect(results[0]).toEqual(vectors[0]);
    expect(results[1]).toEqual(vectors[1]);
  });
  
  it('throws when one of the API calls fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: Array(1536).fill(0.1) }]
      })
    });
    mockFetch.mockRejectedValueOnce(new Error('ServiceUnavailableException'));
    
    await expect(generateEmbeddings(['ok text', 'bad text'])).rejects.toThrow();
  });
});
