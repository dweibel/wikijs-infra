/**
 * DB integration tests against real PostgreSQL + pgvector
 *
 * Validates: Property 1 (persistence), Property 3 (storage integrity),
 *            Property 4 (deletion cleanup), Property 5 (search ordering)
 *
 * Requires: podman or docker with pgvector/pgvector:pg16 (linux/arm64)
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import pg from 'pg';
import { initSchema, upsertEmbeddings, deletePageEmbeddings, searchSimilar } from '../db.js';

const { Client } = pg;

// 1024-dimensional unit vectors for deterministic similarity tests
function makeVector(dominantDim, size = 1024) {
  const v = new Array(size).fill(0);
  v[dominantDim % size] = 1.0;
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
}, 60000);

afterAll(async () => {
  await client?.end();
  await container?.stop();
});

describe('initSchema', () => {
  it('creates wiki_embeddings table', async () => {
    const res = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'wiki_embeddings'`
    );
    expect(res.rows).toHaveLength(1);
  });

  it('is idempotent — calling initSchema twice does not throw', async () => {
    await expect(initSchema(client)).resolves.not.toThrow();
  });
});

describe('upsertEmbeddings', () => {
  it('inserts rows that appear in the DB with correct fields', async () => {
    const chunks = [
      { text: 'Hello world', embedding: makeVector(0) },
      { text: 'Second chunk', embedding: makeVector(1) },
    ];

    await upsertEmbeddings(client, 100, '/test/page', 'Test Page', chunks);

    const res = await client.query(
      'SELECT * FROM wiki_embeddings WHERE page_id = $1 ORDER BY chunk_index',
      [100]
    );

    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].page_id).toBe(100);
    expect(res.rows[0].page_path).toBe('/test/page');
    expect(res.rows[0].page_title).toBe('Test Page');
    expect(res.rows[0].chunk_index).toBe(0);
    expect(res.rows[0].chunk_text).toBe('Hello world');
    expect(res.rows[1].chunk_index).toBe(1);
    expect(res.rows[1].chunk_text).toBe('Second chunk');
  });

  it('upsert idempotency: upserting same page_id/chunk_index updates rather than duplicates', async () => {
    const original = [{ text: 'Original text', embedding: makeVector(2) }];
    await upsertEmbeddings(client, 200, '/idempotent', 'Idempotent Page', original);

    const updated = [{ text: 'Updated text', embedding: makeVector(3) }];
    await upsertEmbeddings(client, 200, '/idempotent', 'Idempotent Page', updated);

    const res = await client.query(
      'SELECT * FROM wiki_embeddings WHERE page_id = $1',
      [200]
    );

    // Must be exactly one row — no duplicate
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].chunk_text).toBe('Updated text');
  });
});

describe('deletePageEmbeddings', () => {
  it('removes all rows for the given page_id', async () => {
    const chunks = [
      { text: 'To be deleted A', embedding: makeVector(4) },
      { text: 'To be deleted B', embedding: makeVector(5) },
    ];
    await upsertEmbeddings(client, 300, '/delete-me', 'Delete Me', chunks);

    // Confirm rows exist
    const before = await client.query(
      'SELECT COUNT(*) FROM wiki_embeddings WHERE page_id = $1',
      [300]
    );
    expect(Number(before.rows[0].count)).toBe(2);

    await deletePageEmbeddings(client, 300);

    const after = await client.query(
      'SELECT COUNT(*) FROM wiki_embeddings WHERE page_id = $1',
      [300]
    );
    expect(Number(after.rows[0].count)).toBe(0);
  });

  it('does not affect rows for other page_ids', async () => {
    const chunks = [{ text: 'Keep me', embedding: makeVector(6) }];
    await upsertEmbeddings(client, 400, '/keep', 'Keep Page', chunks);
    await upsertEmbeddings(client, 401, '/also-keep', 'Also Keep', chunks);

    await deletePageEmbeddings(client, 400);

    const res = await client.query(
      'SELECT COUNT(*) FROM wiki_embeddings WHERE page_id = $1',
      [401]
    );
    expect(Number(res.rows[0].count)).toBe(1);
  });
});

describe('searchSimilar', () => {
  beforeAll(async () => {
    // Seed three pages with orthogonal unit vectors
    await upsertEmbeddings(client, 500, '/search/a', 'Search A', [
      { text: 'Chunk about topic A', embedding: makeVector(10) },
    ]);
    await upsertEmbeddings(client, 501, '/search/b', 'Search B', [
      { text: 'Chunk about topic B', embedding: makeVector(11) },
    ]);
    await upsertEmbeddings(client, 502, '/search/c', 'Search C', [
      { text: 'Chunk about topic C', embedding: makeVector(12) },
    ]);
  });

  it('returns results ordered by descending relevance score', async () => {
    // Query vector identical to page 500's vector → page 500 should rank first
    const queryVec = makeVector(10);
    const results = await searchSimilar(client, queryVec, 3);

    expect(results.length).toBeGreaterThan(0);

    // Scores must be in descending order
    for (let i = 1; i < results.length; i++) {
      expect(Number(results[i - 1].relevance_score)).toBeGreaterThanOrEqual(
        Number(results[i].relevance_score)
      );
    }

    // The most similar result should be page 500
    expect(results[0].page_id).toBe(500);
  });

  it('respects top_k limit', async () => {
    const results = await searchSimilar(client, makeVector(10), 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns all required fields', async () => {
    const results = await searchSimilar(client, makeVector(10), 1);
    expect(results[0]).toMatchObject({
      page_id: expect.any(Number),
      page_title: expect.any(String),
      page_path: expect.any(String),
      chunk_text: expect.any(String),
      relevance_score: expect.anything(),
    });
  });
});
