// Text chunking module
// Splits wiki page content into ~512 token chunks for embedding

const MAX_CHUNK_SIZE = 2048; // ~512 tokens

// Separators tried in order from coarsest to finest
const SEPARATORS = ['\n\n', '\n', ' '];

/**
 * Splits text into chunks of approximately 512 tokens (~2048 characters).
 * Tries to split at natural boundaries: paragraph breaks, newlines, then spaces.
 * Preserves all content — joining all chunks equals the original text.
 *
 * @param {string} text - The text to chunk
 * @returns {string[]} Array of non-empty string chunks
 */
export function chunkText(text) {
  if (!text || text.trim() === '') {
    return [];
  }

  if (text.length <= MAX_CHUNK_SIZE) {
    return [text];
  }

  return splitText(text, 0);
}

/**
 * Splits text using the separator at the given priority index.
 * Falls back to the next separator if no good split point is found.
 * Falls back to hard split if no separator works.
 */
function splitText(text, separatorIndex) {
  if (text.length <= MAX_CHUNK_SIZE) {
    return text.length > 0 ? [text] : [];
  }

  if (separatorIndex >= SEPARATORS.length) {
    return hardSplit(text);
  }

  const sep = SEPARATORS[separatorIndex];

  // Search only within MAX_CHUNK_SIZE to guarantee left <= MAX_CHUNK_SIZE
  const window = text.slice(0, MAX_CHUNK_SIZE);
  const splitPos = window.lastIndexOf(sep);

  if (splitPos <= 0) {
    // No good split point with this separator — try next
    return splitText(text, separatorIndex + 1);
  }

  const cutAt = splitPos + sep.length;
  // cutAt <= MAX_CHUNK_SIZE because splitPos < MAX_CHUNK_SIZE
  const left = text.slice(0, cutAt);
  const right = text.slice(cutAt);

  const leftChunks = [left]; // left.length <= MAX_CHUNK_SIZE guaranteed
  const rightChunks = right.length === 0 ? [] : splitText(right, 0);

  return [...leftChunks, ...rightChunks];
}

/**
 * Hard splits text into MAX_CHUNK_SIZE pieces when no natural boundary exists.
 */
function hardSplit(text) {
  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    chunks.push(text.slice(offset, offset + MAX_CHUNK_SIZE));
    offset += MAX_CHUNK_SIZE;
  }
  return chunks;
}
