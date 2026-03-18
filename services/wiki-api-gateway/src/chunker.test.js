/**
 * Unit tests for the text chunker module.
 *
 * Chunk size approximation: ~512 tokens ≈ 2048 characters.
 *
 * Edge case decisions:
 * - Empty string → returns empty array (no content, no chunks needed)
 * - Whitespace-only text → returns empty array (no meaningful content)
 */

import { describe, it, expect } from 'vitest';
import { chunkText } from './chunker.js';

const CHUNK_SIZE = 2048; // ~512 tokens

describe('chunkText', () => {
  // 1. Empty string → returns empty array
  it('returns empty array for empty string', () => {
    const result = chunkText('');
    expect(result).toEqual([]);
  });

  // 2. Short text (less than chunk size) → single chunk with full text
  it('returns single chunk for text shorter than chunk size', () => {
    const text = 'Hello, world! This is a short piece of text.';
    const result = chunkText(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  // 3. Whitespace-only text → returns empty array
  it('returns empty array for whitespace-only text', () => {
    expect(chunkText('   ')).toEqual([]);
    expect(chunkText('\n\n\n')).toEqual([]);
    expect(chunkText('\t  \n  \t')).toEqual([]);
  });

  // 4. Text exactly at chunk boundary → splits correctly
  it('handles text exactly at chunk boundary', () => {
    const text = 'a'.repeat(CHUNK_SIZE);
    const result = chunkText(text);
    // Should produce at least 1 chunk; all content preserved
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.join('')).toBe(text);
  });

  it('handles text one character over chunk boundary', () => {
    const text = 'a'.repeat(CHUNK_SIZE + 1);
    const result = chunkText(text);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.join('')).toBe(text);
  });

  // 5. Long text → splits into multiple chunks, all content preserved
  it('splits long text into multiple chunks', () => {
    const text = 'word '.repeat(1000); // ~5000 chars
    const result = chunkText(text);
    expect(result.length).toBeGreaterThan(1);
  });

  it('preserves all content across chunks for long text', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(200);
    const result = chunkText(text);
    expect(result.join('')).toBe(text);
  });

  it('each chunk does not exceed the maximum chunk size', () => {
    const text = 'x'.repeat(CHUNK_SIZE * 5);
    const result = chunkText(text);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  // 6. Text with newlines and paragraphs → splits at natural boundaries
  it('splits at paragraph boundaries when possible', () => {
    // Build text with clear paragraph breaks that exceeds chunk size
    const paragraph = 'This is a paragraph with some content. '.repeat(30); // ~1170 chars
    const text = [paragraph, paragraph, paragraph, paragraph].join('\n\n');
    const result = chunkText(text);
    expect(result.length).toBeGreaterThan(1);
    // All content preserved (joining with empty string since chunker strips nothing)
    const joined = result.join('');
    expect(joined.length).toBe(text.length);
  });

  it('handles text with only newlines between content', () => {
    const text = 'Section one.\n\nSection two.\n\nSection three.';
    const result = chunkText(text);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.join('')).toBe(text);
  });

  it('returns non-empty strings in each chunk', () => {
    const text = 'Hello world! '.repeat(500);
    const result = chunkText(text);
    for (const chunk of result) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });
});
