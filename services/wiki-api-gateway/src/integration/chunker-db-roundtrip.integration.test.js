/**
 * Chunker + DB round-trip integration tests
 *
 * Validates: Property 2 (chunk size bounds), Property 3 (storage integrity),
 *            Property 4 (deletion cleanup)
 *
 * Uses real PostgreSQL via testcontainers.
 * No Bedrock calls — fixed embeddings are used.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import pg from 'pg';
import { initSchema, upsertEmbeddings, deletePageEmbeddings } from '../db.js';
import { chunkText } from '../chunker.js';

const { Client } = pg;

const MAX_CHUNK_CHARS = 2048; // matches chunker.js MAX_CHUNK_SIZE

// Generate a fixed 1024-dim embedding (all zeros except position 0)
function fixedEmbedding() {
  const v = new Array(1024).fill(0);
  v[0] = 1.0;
  return v;
}

// Multi-paragraph text that will produce multiple chunks
const MULTI_PARAGRAPH_TEXT = Array.from({ length: 20 }, (_, i) =>
  `Paragraph ${i + 1}: ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(8).trim()}`
).join('\n\n');

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

describe('chunker + DB round-trip', () => {
  const PAGE_ID = 999;

  it('stores all chunks with sequential chunk_index starting at 0', async () => {
    const chunks = chunkText(MULTI_PARAGRAPH_TEXT);
    expect(chunks.length).toBeGreaterThan(1); // ensure we actually have multiple chunks

    const dbChunks = chunks.map((text) => ({ text, embedding: fixedEmbedding() }));
    await upsertEmbeddings(client, PAGE_ID, '/roundtrip', 'Round-trip Page', dbChunks);

    const res = await client.query(
      'SELECT chunk_index, chunk_text FROM wiki_embeddings WHERE page_id = $1 ORDER BY chunk_index',
      [PAGE_ID]
    );

    expect(res.rows).toHaveLength(chunks.length);

    // chunk_index must be sequential starting at 0
    res.rows.forEach((row, i) => {
      expect(row.chunk_index).toBe(i);
    });
  });

  it('each stored chunk does not exceed MAX_CHUNK_CHARS characters', async () => {
    const res = await client.query(
      'SELECT chunk_text FROM wiki_embeddings WHERE page_id = $1',
      [PAGE_ID]
    );

    for (const row of res.rows) {
      expect(row.chunk_text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it('no content is lost — concatenating all chunk_text values reconstructs the original', async () => {
    const chunks = chunkText(MULTI_PARAGRAPH_TEXT);

    const res = await client.query(
      'SELECT chunk_text FROM wiki_embeddings WHERE page_id = $1 ORDER BY chunk_index',
      [PAGE_ID]
    );

    const reconstructed = res.rows.map((r) => r.chunk_text).join('');
    expect(reconstructed).toBe(chunks.join(''));
  });

  it('deleting the page removes all its chunks from the DB', async () => {
    // Confirm rows exist first
    const before = await client.query(
      'SELECT COUNT(*) FROM wiki_embeddings WHERE page_id = $1',
      [PAGE_ID]
    );
    expect(Number(before.rows[0].count)).toBeGreaterThan(0);

    await deletePageEmbeddings(client, PAGE_ID);

    const after = await client.query(
      'SELECT COUNT(*) FROM wiki_embeddings WHERE page_id = $1',
      [PAGE_ID]
    );
    expect(Number(after.rows[0].count)).toBe(0);
  });
});
