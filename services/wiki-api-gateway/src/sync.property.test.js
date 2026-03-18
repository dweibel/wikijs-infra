/**
 * Property-based tests for the embedding sync pipeline (sync.js).
 *
 * Tests Property 6: Embedding Sync Processes Changes
 * - Pages created via write tools are detected and processed
 * - Pages updated via write tools trigger embedding regeneration
 * - Pages deleted via write tools have embeddings removed
 *
 * Tests Property 13: Embedding generation for all pages
 * - For any Wiki.js page in the database, the sync pipeline generates and stores an embedding
 *
 * Uses fast-check to generate random page operations and verify
 * the sync pipeline handles them correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('./wiki-client.js', () => ({
  listPages: vi.fn(),
  getPageContent: vi.fn(),
}));

vi.mock('./embeddings.js', () => ({
  generateEmbeddings: vi.fn(),
}));

vi.mock('./db.js', () => ({
  upsertEmbeddings: vi.fn(),
  deletePageEmbeddings: vi.fn(),
}));

vi.mock('./chunker.js', () => ({
  chunkText: vi.fn(),
}));

import { listPages, getPageContent } from './wiki-client.js';
import { generateEmbeddings } from './embeddings.js';
import { upsertEmbeddings, deletePageEmbeddings } from './db.js';
import { chunkText } from './chunker.js';
import { syncPages } from './sync.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = 'http://wiki.local';

function makeDbClient(existingRows = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows: existingRows }),
  };
}

function wikiPage(id, updatedAt) {
  return { id, path: `/page/${id}`, title: `Page ${id}`, updatedAt };
}

function wikiPageContent(id, updatedAt) {
  return {
    id,
    path: `/page/${id}`,
    title: `Page ${id}`,
    content: `Content for page ${id}`,
    updatedAt,
  };
}

// ─── Property 6: Embedding Sync Processes Changes ────────────────────────────

describe('Property 6: Embedding Sync Processes Changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mocks
    getPageContent.mockImplementation((url, id) =>
      Promise.resolve(wikiPageContent(id, new Date().toISOString()))
    );
    chunkText.mockReturnValue(['chunk']);
    generateEmbeddings.mockResolvedValue([[0.5]]);
    upsertEmbeddings.mockResolvedValue();
    deletePageEmbeddings.mockResolvedValue();
  });

  it('property: new pages are always processed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 10 }),
        async (pageIds) => {
          vi.clearAllMocks();
          
          // All pages are new (not in DB)
          const timestamp = new Date().toISOString();
          listPages.mockResolvedValue(pageIds.map(id => wikiPage(id, timestamp)));
          const dbClient = makeDbClient([]);

          getPageContent.mockImplementation((url, id) =>
            Promise.resolve(wikiPageContent(id, timestamp))
          );
          chunkText.mockReturnValue(['chunk']);
          generateEmbeddings.mockResolvedValue([[0.5]]);
          upsertEmbeddings.mockResolvedValue();

          await syncPages(dbClient, BASE_URL);

          // All pages should be processed
          expect(getPageContent).toHaveBeenCalledTimes(pageIds.length);
          expect(upsertEmbeddings).toHaveBeenCalledTimes(pageIds.length);
          
          // Verify each page was processed
          const processedIds = getPageContent.mock.calls.map(([, id]) => id);
          for (const pageId of pageIds) {
            expect(processedIds).toContain(pageId);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('property: updated pages are always reprocessed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 10 }),
        async (pageIds) => {
          vi.clearAllMocks();
          
          const oldTimestamp = '2024-01-01T00:00:00Z';
          const newTimestamp = '2024-09-01T12:00:00Z';

          // All pages exist in DB with old timestamp
          listPages.mockResolvedValue(pageIds.map(id => wikiPage(id, newTimestamp)));
          const dbClient = makeDbClient(
            pageIds.map(id => ({ page_id: id, updated_at: new Date(oldTimestamp) }))
          );

          getPageContent.mockImplementation((url, id) =>
            Promise.resolve(wikiPageContent(id, newTimestamp))
          );
          chunkText.mockReturnValue(['updated chunk']);
          generateEmbeddings.mockResolvedValue([[0.9]]);
          upsertEmbeddings.mockResolvedValue();

          await syncPages(dbClient, BASE_URL);

          // All pages should be reprocessed
          expect(getPageContent).toHaveBeenCalledTimes(pageIds.length);
          expect(upsertEmbeddings).toHaveBeenCalledTimes(pageIds.length);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('property: deleted pages always have embeddings removed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 10 }),
        async (deletedPageIds) => {
          vi.clearAllMocks();
          
          const timestamp = '2024-01-01T00:00:00Z';

          // Wiki has no pages (all deleted)
          listPages.mockResolvedValue([]);
          
          // DB has embeddings for deleted pages
          const dbClient = makeDbClient(
            deletedPageIds.map(id => ({ page_id: id, updated_at: new Date(timestamp) }))
          );

          deletePageEmbeddings.mockResolvedValue();

          await syncPages(dbClient, BASE_URL);

          // All deleted pages should have embeddings removed
          expect(deletePageEmbeddings).toHaveBeenCalledTimes(deletedPageIds.length);
          
          // Verify each page was deleted
          const deletedIds = deletePageEmbeddings.mock.calls.map(([, id]) => id);
          for (const pageId of deletedPageIds) {
            expect(deletedIds).toContain(pageId);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('property: unchanged pages are never reprocessed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 10 }),
        async (pageIds) => {
          vi.clearAllMocks();
          
          const timestamp = '2024-01-01T00:00:00Z';

          // All pages have same timestamp in wiki and DB
          listPages.mockResolvedValue(pageIds.map(id => wikiPage(id, timestamp)));
          const dbClient = makeDbClient(
            pageIds.map(id => ({ page_id: id, updated_at: new Date(timestamp) }))
          );

          await syncPages(dbClient, BASE_URL);

          // No pages should be processed
          expect(getPageContent).not.toHaveBeenCalled();
          expect(upsertEmbeddings).not.toHaveBeenCalled();
          expect(deletePageEmbeddings).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('property: sync handles mixed operations correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          newPages: fc.uniqueArray(fc.integer({ min: 1, max: 50 }), { maxLength: 5 }),
          updatedPages: fc.uniqueArray(fc.integer({ min: 51, max: 100 }), { maxLength: 5 }),
          unchangedPages: fc.uniqueArray(fc.integer({ min: 101, max: 150 }), { maxLength: 5 }),
          deletedPages: fc.uniqueArray(fc.integer({ min: 151, max: 200 }), { maxLength: 5 }),
        }),
        async ({ newPages, updatedPages, unchangedPages, deletedPages }) => {
          vi.clearAllMocks();
          
          const oldTimestamp = '2024-01-01T00:00:00Z';
          const newTimestamp = '2024-09-01T12:00:00Z';

          // Build wiki page list (excludes deleted pages)
          const wikiPages = [
            ...newPages.map(id => wikiPage(id, newTimestamp)),
            ...updatedPages.map(id => wikiPage(id, newTimestamp)),
            ...unchangedPages.map(id => wikiPage(id, oldTimestamp)),
          ];
          listPages.mockResolvedValue(wikiPages);

          // Build DB state
          const dbRows = [
            ...updatedPages.map(id => ({ page_id: id, updated_at: new Date(oldTimestamp) })),
            ...unchangedPages.map(id => ({ page_id: id, updated_at: new Date(oldTimestamp) })),
            ...deletedPages.map(id => ({ page_id: id, updated_at: new Date(oldTimestamp) })),
          ];
          const dbClient = makeDbClient(dbRows);

          getPageContent.mockImplementation((url, id) =>
            Promise.resolve(wikiPageContent(id, newTimestamp))
          );
          chunkText.mockReturnValue(['chunk']);
          generateEmbeddings.mockResolvedValue([[0.5]]);
          upsertEmbeddings.mockResolvedValue();
          deletePageEmbeddings.mockResolvedValue();

          await syncPages(dbClient, BASE_URL);

          // Verify new and updated pages processed
          const expectedProcessed = newPages.length + updatedPages.length;
          expect(getPageContent).toHaveBeenCalledTimes(expectedProcessed);
          expect(upsertEmbeddings).toHaveBeenCalledTimes(expectedProcessed);

          // Verify deleted pages cleaned up
          expect(deletePageEmbeddings).toHaveBeenCalledTimes(deletedPages.length);

          // Verify unchanged pages not processed
          const processedIds = getPageContent.mock.calls.map(([, id]) => id);
          for (const pageId of unchangedPages) {
            expect(processedIds).not.toContain(pageId);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('property: sync is idempotent for unchanged state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 10 }),
        async (pageIds) => {
          vi.clearAllMocks();
          
          const timestamp = '2024-01-01T00:00:00Z';

          listPages.mockResolvedValue(pageIds.map(id => wikiPage(id, timestamp)));
          const dbClient = makeDbClient(
            pageIds.map(id => ({ page_id: id, updated_at: new Date(timestamp) }))
          );

          // Run sync twice
          await syncPages(dbClient, BASE_URL);
          const firstCallCount = getPageContent.mock.calls.length;
          
          vi.clearAllMocks();
          await syncPages(dbClient, BASE_URL);
          const secondCallCount = getPageContent.mock.calls.length;

          // Both runs should process same number of pages (zero)
          expect(firstCallCount).toBe(0);
          expect(secondCallCount).toBe(0);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ─── Property 13: Embedding generation for all pages ─────────────────────────

// Feature: wikijs-infra-repository, Property 13: Embedding generation for all pages
// **Validates: Requirements 7.1, 7.3**

describe('Property 13: Embedding generation for all pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mocks
    getPageContent.mockImplementation((url, id) =>
      Promise.resolve(wikiPageContent(id, new Date().toISOString()))
    );
    chunkText.mockReturnValue(['chunk']);
    generateEmbeddings.mockResolvedValue([[0.5]]);
    upsertEmbeddings.mockResolvedValue();
    deletePageEmbeddings.mockResolvedValue();
  });

  it('property: for any Wiki.js page, sync generates and stores an embedding', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          pageId: fc.integer({ min: 1, max: 10000 }),
          title: fc.string({ minLength: 1, maxLength: 100 }),
          path: fc.string({ minLength: 1, maxLength: 200 }),
          content: fc.string({ minLength: 1, maxLength: 5000 }),
          timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }),
        }),
        async ({ pageId, title, path, content, timestamp }) => {
          vi.clearAllMocks();
          
          const timestampStr = timestamp.toISOString();
          
          // Mock Wiki.js page list
          listPages.mockResolvedValue([
            { id: pageId, path, title, updatedAt: timestampStr }
          ]);
          
          // Mock page content retrieval
          getPageContent.mockResolvedValue({
            id: pageId,
            path,
            title,
            content,
            updatedAt: timestampStr,
          });
          
          // Mock chunking (at least one chunk)
          const chunks = content.length > 1000 ? ['chunk1', 'chunk2'] : ['chunk1'];
          chunkText.mockReturnValue(chunks);
          
          // Mock embedding generation (1536 dimensions for OpenAI text-embedding-3-small)
          const mockEmbeddings = chunks.map(() => 
            Array(1536).fill(0).map(() => Math.random())
          );
          generateEmbeddings.mockResolvedValue(mockEmbeddings);
          
          // Mock database (page doesn't exist yet)
          const dbClient = makeDbClient([]);
          upsertEmbeddings.mockResolvedValue();
          
          // Run sync
          await syncPages(dbClient, BASE_URL);
          
          // Verify embedding generation was called
          expect(generateEmbeddings).toHaveBeenCalledTimes(1);
          expect(generateEmbeddings).toHaveBeenCalledWith(chunks);
          
          // Verify embeddings were stored in database
          expect(upsertEmbeddings).toHaveBeenCalledTimes(1);
          expect(upsertEmbeddings).toHaveBeenCalledWith(
            dbClient,
            pageId,
            path,
            title,
            expect.arrayContaining([
              expect.objectContaining({
                text: expect.any(String),
                embedding: expect.any(Array),
              })
            ])
          );
          
          // Verify the embedding has correct structure
          const upsertCall = upsertEmbeddings.mock.calls[0];
          const storedChunks = upsertCall[4];
          
          expect(storedChunks).toHaveLength(chunks.length);
          for (let i = 0; i < storedChunks.length; i++) {
            expect(storedChunks[i]).toHaveProperty('text');
            expect(storedChunks[i]).toHaveProperty('embedding');
            expect(storedChunks[i].embedding).toHaveLength(1536);
            expect(storedChunks[i].embedding.every(v => typeof v === 'number')).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('property: embeddings are stored with correct page metadata', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          pageId: fc.integer({ min: 1, max: 10000 }),
          title: fc.string({ minLength: 1, maxLength: 100 }),
          path: fc.string({ minLength: 1, maxLength: 200 }),
          content: fc.string({ minLength: 1, maxLength: 5000 }),
        }),
        async ({ pageId, title, path, content }) => {
          vi.clearAllMocks();
          
          const timestamp = new Date().toISOString();
          
          listPages.mockResolvedValue([
            { id: pageId, path, title, updatedAt: timestamp }
          ]);
          
          getPageContent.mockResolvedValue({
            id: pageId,
            path,
            title,
            content,
            updatedAt: timestamp,
          });
          
          chunkText.mockReturnValue(['chunk']);
          generateEmbeddings.mockResolvedValue([[0.5]]);
          
          const dbClient = makeDbClient([]);
          upsertEmbeddings.mockResolvedValue();
          
          await syncPages(dbClient, BASE_URL);
          
          // Verify metadata is passed correctly
          expect(upsertEmbeddings).toHaveBeenCalledWith(
            dbClient,
            pageId,
            path,
            title,
            expect.any(Array)
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it('property: embedding vectors are non-null and have correct dimensions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            pageId: fc.integer({ min: 1, max: 10000 }),
            content: fc.string({ minLength: 1, maxLength: 5000 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (pages) => {
          vi.clearAllMocks();
          
          const timestamp = new Date().toISOString();
          
          // Mock multiple pages
          listPages.mockResolvedValue(
            pages.map(p => ({
              id: p.pageId,
              path: `/page/${p.pageId}`,
              title: `Page ${p.pageId}`,
              updatedAt: timestamp,
            }))
          );
          
          getPageContent.mockImplementation((url, id) => {
            const page = pages.find(p => p.pageId === id);
            return Promise.resolve({
              id,
              path: `/page/${id}`,
              title: `Page ${id}`,
              content: page.content,
              updatedAt: timestamp,
            });
          });
          
          chunkText.mockReturnValue(['chunk']);
          
          // Generate proper 1536-dimensional embeddings
          generateEmbeddings.mockImplementation((chunks) =>
            Promise.resolve(chunks.map(() => Array(1536).fill(0).map(() => Math.random())))
          );
          
          const dbClient = makeDbClient([]);
          upsertEmbeddings.mockResolvedValue();
          
          await syncPages(dbClient, BASE_URL);
          
          // Verify all pages got embeddings
          expect(upsertEmbeddings).toHaveBeenCalledTimes(pages.length);
          
          // Verify each embedding has correct dimensions
          for (const call of upsertEmbeddings.mock.calls) {
            const chunks = call[4];
            for (const chunk of chunks) {
              expect(chunk.embedding).toBeDefined();
              expect(chunk.embedding).not.toBeNull();
              expect(chunk.embedding).toHaveLength(1536);
              expect(chunk.embedding.every(v => typeof v === 'number' && !isNaN(v))).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('property: sync handles pages with varying content lengths', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            pageId: fc.integer({ min: 1, max: 10000 }),
            contentLength: fc.integer({ min: 0, max: 10000 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (pages) => {
          vi.clearAllMocks();
          
          const timestamp = new Date().toISOString();
          
          listPages.mockResolvedValue(
            pages.map(p => ({
              id: p.pageId,
              path: `/page/${p.pageId}`,
              title: `Page ${p.pageId}`,
              updatedAt: timestamp,
            }))
          );
          
          getPageContent.mockImplementation((url, id) => {
            const page = pages.find(p => p.pageId === id);
            return Promise.resolve({
              id,
              path: `/page/${id}`,
              title: `Page ${id}`,
              content: 'x'.repeat(page.contentLength),
              updatedAt: timestamp,
            });
          });
          
          chunkText.mockImplementation((content) => {
            // Simulate chunking behavior
            if (content.length === 0) return [''];
            if (content.length <= 1000) return [content];
            const numChunks = Math.ceil(content.length / 1000);
            return Array(numChunks).fill('chunk');
          });
          
          generateEmbeddings.mockImplementation((chunks) =>
            Promise.resolve(chunks.map(() => Array(1536).fill(0).map(() => Math.random())))
          );
          
          const dbClient = makeDbClient([]);
          upsertEmbeddings.mockResolvedValue();
          
          await syncPages(dbClient, BASE_URL);
          
          // All pages should be processed regardless of content length
          expect(upsertEmbeddings).toHaveBeenCalledTimes(pages.length);
          
          // Verify embeddings were generated for all chunks
          for (const call of upsertEmbeddings.mock.calls) {
            const chunks = call[4];
            expect(chunks.length).toBeGreaterThan(0);
            for (const chunk of chunks) {
              expect(chunk.embedding).toHaveLength(1536);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
