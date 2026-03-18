// Database module
// Handles upsertEmbeddings, deletePageEmbeddings, searchSimilar, initSchema

/**
 * Creates the pgvector extension and wiki_embeddings table if they don't exist.
 * @param {import('pg').Client} client
 */
export async function initSchema(client) {
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');

  await client.query(`
    CREATE TABLE IF NOT EXISTS wiki_embeddings (
      id SERIAL PRIMARY KEY,
      page_id INTEGER NOT NULL,
      page_path TEXT NOT NULL,
      page_title TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      embedding vector(1024),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(page_id, chunk_index)
    )
  `);
}

/**
 * Upserts embedding records for a page's chunks.
 * @param {import('pg').Client} client
 * @param {number} pageId
 * @param {string} pagePath
 * @param {string} pageTitle
 * @param {Array<{text: string, embedding: number[]}>} chunks
 */
export async function upsertEmbeddings(client, pageId, pagePath, pageTitle, chunks) {
  for (let i = 0; i < chunks.length; i++) {
    const { text, embedding } = chunks[i];
    await client.query(
      `INSERT INTO wiki_embeddings (page_id, page_path, page_title, chunk_index, chunk_text, embedding, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (page_id, chunk_index) DO UPDATE SET
         page_path = EXCLUDED.page_path,
         page_title = EXCLUDED.page_title,
         chunk_text = EXCLUDED.chunk_text,
         embedding = EXCLUDED.embedding,
         updated_at = NOW()`,
      [pageId, pagePath, pageTitle, i, text, JSON.stringify(embedding)]
    );
  }
}

/**
 * Deletes all embedding records for a given page_id.
 * @param {import('pg').Client} client
 * @param {number} pageId
 */
export async function deletePageEmbeddings(client, pageId) {
  await client.query(
    'DELETE FROM wiki_embeddings WHERE page_id = $1',
    [pageId]
  );
}

/**
 * Performs cosine similarity search against stored embeddings.
 * @param {import('pg').Client} client
 * @param {number[]} queryEmbedding
 * @param {number} topK
 * @returns {Promise<Array<{page_id, page_title, page_path, chunk_text, relevance_score}>>}
 */
export async function searchSimilar(client, queryEmbedding, topK) {
  const result = await client.query(
    `SELECT page_id, page_title, page_path, chunk_text,
            1 - (embedding <=> $1::vector) AS relevance_score
     FROM wiki_embeddings
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(queryEmbedding), topK]
  );

  return result.rows.map((row) => ({
    page_id: row.page_id,
    page_title: row.page_title,
    page_path: row.page_path,
    chunk_text: row.chunk_text,
    relevance_score: row.relevance_score,
  }));
}
