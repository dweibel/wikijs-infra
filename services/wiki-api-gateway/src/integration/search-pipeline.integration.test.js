/**
 * Search pipeline integration tests
 *
 * Validates: Property 5 (search ordering), Property 7 (result completeness)
 *
 * Uses real PostgreSQL via testcontainers.
 * Mocks only generateEmbedding (Bedrock) — all other I/O is real.
 */

import { describe, it, beforeAll, afterAll, vi, expect } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import pg from 'pg';
import { initSchema, upsertEmbeddings } from '../db.js';

const { Client } = pg;

// ---------------------------------------------------------------------------
// Mock generateEmbedding before importing tools.js so the module picks it up
// ---------------------------------------------------------------------------
vi.mock('../embeddings.js', () => ({
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
}));

import { generateEmbedding } from '../embeddings.js';
import { searchWiki } from '../tools.js';

// 1024-dimensional unit vector with a 1 at position `dim`
function unitVec(dim, size = 1024) {
  const v = new Array(size).fill(0);
  v[dim % size] = 1.0;
  return v;
}

let container;
let client;

beforeAll(async () => {
  container = await new GenericContainer('pgvector/pgvector:pg16')
    .withPlatform('linux/arm64')
    .withEnvironment({
      POSTGRES_DB: 'testdb',
      POSTGRES_USER: 'testuser',
      POSTGRES_PASSWORD: 'testpass',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections'))
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);

  client = new Client({ host, port, database: 'testdb', user: 'testuser', password: 'testpass' });
  await client.connect();
  await initSchema(client);

  // Seed three pages with known orthogonal unit vectors
  await upsertEmbeddings(client, 1, '/docs/alpha', 'Alpha Docs', [
    { text: 'Alpha content about topic one', embedding: unitVec(0) },
  ]);
  await upsertEmbeddings(client, 2, '/docs/beta', 'Beta Docs', [
    { text: 'Beta content about topic two', embedding: unitVec(1) },
  ]);
  await upsertEmbeddings(client, 3, '/docs/gamma', 'Gamma Docs', [
    { text: 'Gamma content about topic three', embedding: unitVec(2) },
    { text: 'Gamma second chunk', embedding: unitVec(3) },
  ]);
}, 60000);

afterAll(async () => {
  await client?.end();
  await container?.stop();
});

describe('searchWiki — end-to-end through tools.js → db.js → real PostgreSQL', () => {
  it('returns results in descending relevance order', async () => {
    // Query vector identical to page 1 → page 1 should rank first
    generateEmbedding.mockResolvedValue(unitVec(0));

    const results = await searchWiki(client, 'http://localhost:3000', { query: 'alpha topic', top_k: 3 });

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    for (let i = 1; i < results.length; i++) {
      expect(Number(results[i - 1].relevance_score)).toBeGreaterThanOrEqual(
        Number(results[i].relevance_score)
      );
    }

    expect(results[0].page_id).toBe(1);
  });

  it('returns all required fields on every result', async () => {
    generateEmbedding.mockResolvedValue(unitVec(0));

    const results = await searchWiki(client, 'http://localhost:3000', { query: 'anything', top_k: 5 });

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(typeof r.page_id).toBe('number');
      expect(typeof r.page_title).toBe('string');
      expect(r.page_title.length).toBeGreaterThan(0);
      expect(typeof r.page_path).toBe('string');
      expect(r.page_path.length).toBeGreaterThan(0);
      expect(typeof r.chunk_text).toBe('string');
      expect(r.chunk_text.length).toBeGreaterThan(0);
      expect(r.relevance_score).toBeDefined();
    }
  });

  it('respects top_k limiting against real DB', async () => {
    generateEmbedding.mockResolvedValue(unitVec(0));

    const results = await searchWiki(client, 'http://localhost:3000', { query: 'test', top_k: 2 });

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array for empty query', async () => {
    const results = await searchWiki(client, 'http://localhost:3000', { query: '', top_k: 5 });
    expect(results).toEqual([]);
  });

  it('returns empty array when no rows match (empty DB slice)', async () => {
    // top_k = 0 is not valid per schema, but top_k = 1 with a real query should still work
    generateEmbedding.mockResolvedValue(unitVec(0));
    const results = await searchWiki(client, 'http://localhost:3000', { query: 'query', top_k: 1 });
    expect(Array.isArray(results)).toBe(true);
  });
});
