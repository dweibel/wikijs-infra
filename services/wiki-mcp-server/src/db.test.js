/**
 * Unit tests for the database module (db.js).
 *
 * Uses vi.mock() to mock the `pg` module so no real database connection is needed.
 * Tests verify that each function calls client.query() with the correct SQL and parameters.
 *
 * Validates: Requirements 4.3, 4.4, 5.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pg before importing the module under test
const mockQuery = vi.fn();

vi.mock('pg', () => {
  return {
    default: {
      Client: vi.fn().mockImplementation(() => ({
        query: mockQuery,
      })),
    },
    Client: vi.fn().mockImplementation(() => ({
      query: mockQuery,
    })),
  };
});

const { initSchema, upsertEmbeddings, deletePageEmbeddings, searchSimilar } = await import('./db.js');

// A mock pg client instance to pass directly to functions
const mockClient = { query: mockQuery };

describe('initSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('calls query to create the pgvector extension', async () => {
    await initSchema(mockClient);

    const calls = mockQuery.mock.calls.map(([sql]) => (typeof sql === 'string' ? sql : sql?.text ?? ''));
    const hasExtension = calls.some((sql) => /CREATE EXTENSION/i.test(sql));
    expect(hasExtension).toBe(true);
  });

  it('calls query to create the wiki_embeddings table', async () => {
    await initSchema(mockClient);

    const calls = mockQuery.mock.calls.map(([sql]) => (typeof sql === 'string' ? sql : sql?.text ?? ''));
    const hasTable = calls.some((sql) => /CREATE TABLE/i.test(sql) && /wiki_embeddings/i.test(sql));
    expect(hasTable).toBe(true);
  });
});

describe('upsertEmbeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('calls query once per chunk with INSERT ... ON CONFLICT DO UPDATE', async () => {
    const chunks = [
      { text: 'chunk one', embedding: Array(1024).fill(0.1) },
      { text: 'chunk two', embedding: Array(1024).fill(0.2) },
    ];

    await upsertEmbeddings(mockClient, 42, '/home', 'Home Page', chunks);

    expect(mockQuery).toHaveBeenCalledTimes(2);

    for (const call of mockQuery.mock.calls) {
      const sql = typeof call[0] === 'string' ? call[0] : call[0]?.text ?? '';
      expect(sql).toMatch(/INSERT/i);
      expect(sql).toMatch(/ON CONFLICT/i);
    }
  });

  it('passes correct page_id, page_path, page_title, chunk_index, chunk_text, and embedding', async () => {
    const embedding = Array(1024).fill(0.5);
    const chunks = [{ text: 'hello world', embedding }];

    await upsertEmbeddings(mockClient, 7, '/docs/intro', 'Introduction', chunks);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const params = mockQuery.mock.calls[0][1];

    expect(params).toContain(7);           // page_id
    expect(params).toContain('/docs/intro'); // page_path
    expect(params).toContain('Introduction'); // page_title
    expect(params).toContain(0);           // chunk_index
    expect(params).toContain('hello world'); // chunk_text
    // embedding should be present (as array or stringified)
    const embeddingParam = params.find(
      (p) => Array.isArray(p) || (typeof p === 'string' && p.includes('0.5'))
    );
    expect(embeddingParam).toBeDefined();
  });

  it('assigns sequential chunk_index values starting from 0', async () => {
    const chunks = [
      { text: 'first', embedding: Array(1024).fill(0.1) },
      { text: 'second', embedding: Array(1024).fill(0.2) },
      { text: 'third', embedding: Array(1024).fill(0.3) },
    ];

    await upsertEmbeddings(mockClient, 100, '/path', 'Title', chunks);

    // chunk_index is the 4th parameter (index 3): [page_id, page_path, page_title, chunk_index, ...]
    const indices = mockQuery.mock.calls.map((call) => call[1][3]);

    expect(indices).toEqual([0, 1, 2]);
  });

  it('does not call query when chunks array is empty', async () => {
    await upsertEmbeddings(mockClient, 99, '/empty', 'Empty Page', []);

    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('deletePageEmbeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 3 });
  });

  it('calls query with DELETE WHERE page_id = $1', async () => {
    await deletePageEmbeddings(mockClient, 55);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    const sqlText = typeof sql === 'string' ? sql : sql?.text ?? '';

    expect(sqlText).toMatch(/DELETE/i);
    expect(sqlText).toMatch(/wiki_embeddings/i);
    expect(sqlText).toMatch(/page_id/i);
    expect(params).toContain(55);
  });
});

describe('searchSimilar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls query with cosine similarity search SQL', async () => {
    const queryEmbedding = Array(1024).fill(0.1);
    mockQuery.mockResolvedValue({ rows: [] });

    await searchSimilar(mockClient, queryEmbedding, 5);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0];
    const sqlText = typeof sql === 'string' ? sql : sql?.text ?? '';

    // Should reference the embeddings table and use cosine similarity operator or function
    expect(sqlText).toMatch(/wiki_embeddings/i);
    expect(sqlText).toMatch(/<=>|cosine/i);
  });

  it('returns correctly shaped SearchResult array', async () => {
    const queryEmbedding = Array(1024).fill(0.2);
    mockQuery.mockResolvedValue({
      rows: [
        {
          page_id: 1,
          page_title: 'Home',
          page_path: '/home',
          chunk_text: 'Welcome to the wiki',
          relevance_score: 0.95,
        },
        {
          page_id: 2,
          page_title: 'About',
          page_path: '/about',
          chunk_text: 'About this wiki',
          relevance_score: 0.80,
        },
      ],
    });

    const results = await searchSimilar(mockClient, queryEmbedding, 5);

    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result).toHaveProperty('page_id');
      expect(result).toHaveProperty('page_title');
      expect(result).toHaveProperty('page_path');
      expect(result).toHaveProperty('chunk_text');
      expect(result).toHaveProperty('relevance_score');
    }
    expect(results[0].page_title).toBe('Home');
    expect(results[1].page_path).toBe('/about');
  });

  it('respects topK=3 — passes limit to query', async () => {
    const queryEmbedding = Array(1024).fill(0.3);
    // Return 3 rows to simulate DB respecting LIMIT
    mockQuery.mockResolvedValue({
      rows: [
        { page_id: 1, page_title: 'A', page_path: '/a', chunk_text: 'text a', relevance_score: 0.9 },
        { page_id: 2, page_title: 'B', page_path: '/b', chunk_text: 'text b', relevance_score: 0.8 },
        { page_id: 3, page_title: 'C', page_path: '/c', chunk_text: 'text c', relevance_score: 0.7 },
      ],
    });

    const results = await searchSimilar(mockClient, queryEmbedding, 3);

    // The topK value should be passed as a query parameter
    const params = mockQuery.mock.calls[0][1];
    expect(params).toContain(3);

    expect(results).toHaveLength(3);
  });

  it('returns empty array when DB returns no rows', async () => {
    const queryEmbedding = Array(1024).fill(0.0);
    mockQuery.mockResolvedValue({ rows: [] });

    const results = await searchSimilar(mockClient, queryEmbedding, 5);

    expect(results).toEqual([]);
  });
});
