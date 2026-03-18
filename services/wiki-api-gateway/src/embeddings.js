/**
 * OpenRouter embeddings client for Wiki MCP Server.
 * 
 * Replaces AWS Bedrock with OpenRouter API for embedding generation.
 * Uses text-embedding-3-small model (1536 dimensions) by default.
 * 
 * Feature: wiki-mcp-access-control
 * Task: 3.1 - OpenRouter Embeddings Client
 */

/**
 * Generate an embedding vector for a single text string using OpenRouter API.
 * Returns a 1536-dimensional float array (for text-embedding-3-small).
 *
 * @param {string} text - The input text to embed
 * @returns {Promise<number[]>} 1536-dimensional embedding vector
 * @throws {Error} If API key is missing or API call fails
 */
export async function generateEmbedding(text) {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small';
  
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY environment variable is required');
  }

  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || response.statusText;
      throw new Error(`OpenRouter API error (${response.status}): ${errorMessage}`);
    }

    const json = await response.json();
    const embedding = json.data[0].embedding;
    
    // Verify dimensions (should be 1536 for text-embedding-3-small)
    if (!Array.isArray(embedding) || embedding.length !== 1536) {
      throw new Error(`Unexpected embedding dimensions: ${embedding?.length || 0}, expected 1536`);
    }
    
    return embedding;
  } catch (err) {
    if (err.message.includes('OPENROUTER_API_KEY')) {
      throw err;
    }
    throw new Error(`Failed to generate embedding: ${err.message}`);
  }
}

/**
 * Generate embeddings for a batch of texts. Returns an array of embeddings
 * in the same order as the input. Returns [] immediately for empty input.
 *
 * @param {string[]} texts - Array of input texts
 * @returns {Promise<number[][]>} Array of 1536-dimensional embedding vectors
 */
export async function generateEmbeddings(texts) {
  if (texts.length === 0) return [];
  return Promise.all(texts.map((text) => generateEmbedding(text)));
}


