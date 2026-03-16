-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create wiki_embeddings table for vector search
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
);

-- Index for fast page_id lookups
CREATE INDEX IF NOT EXISTS idx_embeddings_page_id ON wiki_embeddings(page_id);

-- IVFFlat index for approximate nearest neighbor search
-- lists=100 is appropriate for up to ~1M vectors
CREATE INDEX IF NOT EXISTS idx_embeddings_vector 
    ON wiki_embeddings USING ivfflat (embedding vector_cosine_ops) 
    WITH (lists = 100);
