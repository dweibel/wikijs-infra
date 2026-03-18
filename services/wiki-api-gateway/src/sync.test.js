/**
 * Unit tests for the embedding sync pipeline (sync.js).
 *
 * Mocks all external dependencies (wiki-client, embeddings, db, chunker) so
 * no real network or database calls are made. Tests verify the sync logic:
 * detecting new/updated/deleted pages and processing them correctly.
 *
 * Validates: Requirements 4.1, 4.3, 4.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  searchSimilar: vi.fn(),
}));

vi.mock('./chunker.js', () => ({
  chunkText: vi.fn(),
}));

// Import mocked modules and the module under test after vi.mock() calls
import { listPages, getPageContent } from './wiki-client.js';
import { generateEmbeddings } from './embeddings.js';
import { upsertEmbeddings, deletePageEmbeddings } from './db.js';
import { chunkText } from './chunker.js';
import { syncPages, startSync, stopSync } from './sync.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = 'http://wiki.local';

/**
 * Build a mock dbClient whose query() returns the given rows.
 * Used to simulate the DB state query that returns existing page records.
 */
function makeDbClient(existingRows = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows: existingRows }),
  };
}

/**
 * Build a wiki page list entry (as returned by listPages).
 */
function wikiPage(id, updatedAt = '2024-01-01T00:00:00Z') {
  return { id, path: `/page/${id}`, title: `Page ${id}`, updatedAt };
}

/**
 * Build a full page content object (as returned by getPageContent).
 */
function wikiPageContent(id, updatedAt = '2024-01-01T00:00:00Z') {
  return {
    id,
    path: `/page/${id}`,
    title: `Page ${id}`,
    content: `Content for page ${id}`,
    updatedAt,
  };
}

// ─── syncPages: new page ──────────────────────────────────────────────────────

describe('syncPages — new page detected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches content, chunks, generates embeddings, and upserts for a new page', async () => {
    // Wiki has one page; DB has no existing records
    listPages.mockResolvedValue([wikiPage(1)]);
    const dbClient = makeDbClient([]); // no existing pages in DB

    const content = wikiPageContent(1);
    getPageContent.mockResolvedValue(content);
    chunkText.mockReturnValue(['chunk A', 'chunk B']);
    generateEmbeddings.mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);
    upsertEmbeddings.mockResolvedValue();

    await syncPages(dbClient, BASE_URL);

    expect(getPageContent).toHaveBeenCalledWith(BASE_URL, 1, null);
    expect(chunkText).toHaveBeenCalledWith(content.content);
    expect(generateEmbeddings).toHaveBeenCalledWith(['chunk A', 'chunk B']);
    expect(upsertEmbeddings).toHaveBeenCalledWith(
      dbClient,
      1,
      content.path,
      content.title,
      [
        { text: 'chunk A', embedding: [0.1, 0.2] },
        { text: 'chunk B', embedding: [0.3, 0.4] },
      ]
    );
  });
});

// ─── syncPages: updated page ──────────────────────────────────────────────────

describe('syncPages — updated page detected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-processes page when wiki updatedAt is newer than stored updated_at', async () => {
    const oldTimestamp = '2024-01-01T00:00:00Z';
    const newTimestamp = '2024-06-01T12:00:00Z';

    // Wiki reports a newer timestamp
    listPages.mockResolvedValue([wikiPage(5, newTimestamp)]);

    // DB has the page but with an older timestamp
    const dbClient = makeDbClient([{ page_id: 5, updated_at: new Date(oldTimestamp) }]);

    const content = wikiPageContent(5, newTimestamp);
    getPageContent.mockResolvedValue(content);
    chunkText.mockReturnValue(['updated chunk']);
    generateEmbeddings.mockResolvedValue([[0.9, 0.8]]);
    upsertEmbeddings.mockResolvedValue();

    await syncPages(dbClient, BASE_URL);

    expect(getPageContent).toHaveBeenCalledWith(BASE_URL, 5, null);
    expect(upsertEmbeddings).toHaveBeenCalledTimes(1);
  });
});

// ─── syncPages: unchanged page ────────────────────────────────────────────────

describe('syncPages — unchanged page skipped', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips processing when wiki updatedAt matches stored updated_at', async () => {
    const timestamp = '2024-03-15T10:00:00Z';

    listPages.mockResolvedValue([wikiPage(3, timestamp)]);

    // DB has the page with the same timestamp
    const dbClient = makeDbClient([{ page_id: 3, updated_at: new Date(timestamp) }]);

    await syncPages(dbClient, BASE_URL);

    expect(getPageContent).not.toHaveBeenCalled();
    expect(chunkText).not.toHaveBeenCalled();
    expect(generateEmbeddings).not.toHaveBeenCalled();
    expect(upsertEmbeddings).not.toHaveBeenCalled();
  });
});

// ─── syncPages: deleted page ──────────────────────────────────────────────────

describe('syncPages — deleted page cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls deletePageEmbeddings for pages in DB but not in wiki list', async () => {
    // Wiki has no pages (or a different page)
    listPages.mockResolvedValue([wikiPage(10)]);

    // DB has page 10 (current) and page 99 (deleted)
    const dbClient = makeDbClient([
      { page_id: 10, updated_at: new Date('2024-01-01T00:00:00Z') },
      { page_id: 99, updated_at: new Date('2024-01-01T00:00:00Z') },
    ]);

    // Page 10 is unchanged so no content fetch needed
    // Page 99 is deleted

    deletePageEmbeddings.mockResolvedValue();

    // Page 10 has same timestamp as wiki — no update needed
    listPages.mockResolvedValue([wikiPage(10, '2024-01-01T00:00:00Z')]);

    await syncPages(dbClient, BASE_URL);

    expect(deletePageEmbeddings).toHaveBeenCalledWith(dbClient, 99);
    expect(deletePageEmbeddings).toHaveBeenCalledTimes(1);
  });

  it('does not call deletePageEmbeddings when no pages are deleted', async () => {
    listPages.mockResolvedValue([wikiPage(1)]);
    const dbClient = makeDbClient([{ page_id: 1, updated_at: new Date('2024-01-01T00:00:00Z') }]);

    await syncPages(dbClient, BASE_URL);

    expect(deletePageEmbeddings).not.toHaveBeenCalled();
  });
});

// ─── syncPages: multiple pages ────────────────────────────────────────────────

describe('syncPages — multiple pages in one cycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes all new pages and skips unchanged ones in a single sync', async () => {
    const ts = '2024-01-01T00:00:00Z';
    const tsNew = '2024-09-01T00:00:00Z';

    // Wiki has 3 pages: page 1 (new), page 2 (updated), page 3 (unchanged)
    listPages.mockResolvedValue([
      wikiPage(1, ts),      // new — not in DB
      wikiPage(2, tsNew),   // updated — DB has older timestamp
      wikiPage(3, ts),      // unchanged — same timestamp in DB
    ]);

    const dbClient = makeDbClient([
      { page_id: 2, updated_at: new Date('2024-01-01T00:00:00Z') }, // older
      { page_id: 3, updated_at: new Date(ts) },                      // same
    ]);

    getPageContent.mockImplementation((url, id) => Promise.resolve(wikiPageContent(id, tsNew)));
    chunkText.mockReturnValue(['chunk']);
    generateEmbeddings.mockResolvedValue([[0.5]]);
    upsertEmbeddings.mockResolvedValue();

    await syncPages(dbClient, BASE_URL);

    // Pages 1 and 2 should be processed; page 3 should be skipped
    expect(getPageContent).toHaveBeenCalledTimes(2);
    expect(upsertEmbeddings).toHaveBeenCalledTimes(2);

    const processedIds = getPageContent.mock.calls.map(([, id]) => id);
    expect(processedIds).toContain(1);
    expect(processedIds).toContain(2);
    expect(processedIds).not.toContain(3);
  });
});

// ─── startSync / stopSync ─────────────────────────────────────────────────────

describe('startSync — interval behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default: wiki returns empty list, DB has no rows
    listPages.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls syncPages immediately on start', async () => {
    const dbClient = makeDbClient([]);
    const stop = startSync(dbClient, BASE_URL, 1000);

    // Flush the immediate call (only pending timers, not ones created during execution)
    await vi.runOnlyPendingTimersAsync();

    expect(listPages).toHaveBeenCalledTimes(1);

    stop();
  });

  it('calls syncPages multiple times on the configured interval', async () => {
    const dbClient = makeDbClient([]);
    const intervalMs = 500;
    const stop = startSync(dbClient, BASE_URL, intervalMs);

    // Advance time to trigger multiple intervals
    await vi.advanceTimersByTimeAsync(intervalMs * 3);

    // Should have fired at least 3 times (initial + 2 intervals, or 3 intervals)
    expect(listPages.mock.calls.length).toBeGreaterThanOrEqual(3);

    stop();
  });

  it('stop function prevents further syncPages calls', async () => {
    const dbClient = makeDbClient([]);
    const intervalMs = 500;
    const stop = startSync(dbClient, BASE_URL, intervalMs);

    // Let it fire once
    await vi.advanceTimersByTimeAsync(intervalMs);
    const callsBeforeStop = listPages.mock.calls.length;

    // Stop the sync
    stop();

    // Advance time further — no new calls should happen
    await vi.advanceTimersByTimeAsync(intervalMs * 5);
    expect(listPages.mock.calls.length).toBe(callsBeforeStop);
  });
});

describe('stopSync — convenience wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    listPages.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops the sync when passed the stop function from startSync', async () => {
    const dbClient = makeDbClient([]);
    const stop = startSync(dbClient, BASE_URL, 500);

    await vi.advanceTimersByTimeAsync(500);
    const callsBefore = listPages.mock.calls.length;

    stopSync(stop);

    await vi.advanceTimersByTimeAsync(2000);
    expect(listPages.mock.calls.length).toBe(callsBefore);
  });
});

// ─── syncPages: write operations scenarios ───────────────────────────────────

describe('syncPages — write operations integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects pages created via write tools', async () => {
    // Simulate a page created via create_wiki_page tool
    // Wiki now has this page, but DB doesn't yet
    const newPageId = 42;
    listPages.mockResolvedValue([wikiPage(newPageId, '2024-09-01T10:00:00Z')]);
    const dbClient = makeDbClient([]); // DB has no pages yet

    const content = wikiPageContent(newPageId, '2024-09-01T10:00:00Z');
    getPageContent.mockResolvedValue(content);
    chunkText.mockReturnValue(['new content chunk']);
    generateEmbeddings.mockResolvedValue([[0.1, 0.2]]);
    upsertEmbeddings.mockResolvedValue();

    await syncPages(dbClient, BASE_URL);

    // Verify the new page was processed
    expect(getPageContent).toHaveBeenCalledWith(BASE_URL, newPageId, null);
    expect(upsertEmbeddings).toHaveBeenCalledWith(
      dbClient,
      newPageId,
      content.path,
      content.title,
      [{ text: 'new content chunk', embedding: [0.1, 0.2] }]
    );
  });

  it('regenerates embeddings for pages updated via write tools', async () => {
    // Simulate a page updated via update_wiki_page tool
    const pageId = 15;
    const oldTimestamp = '2024-01-01T00:00:00Z';
    const newTimestamp = '2024-09-01T15:30:00Z';

    // Wiki has the updated page with new timestamp
    listPages.mockResolvedValue([wikiPage(pageId, newTimestamp)]);

    // DB has the page with old timestamp
    const dbClient = makeDbClient([{ page_id: pageId, updated_at: new Date(oldTimestamp) }]);

    const updatedContent = wikiPageContent(pageId, newTimestamp);
    updatedContent.content = 'Updated content from write tool';
    getPageContent.mockResolvedValue(updatedContent);
    chunkText.mockReturnValue(['updated chunk']);
    generateEmbeddings.mockResolvedValue([[0.9, 0.8]]);
    upsertEmbeddings.mockResolvedValue();

    await syncPages(dbClient, BASE_URL);

    // Verify embeddings were regenerated
    expect(getPageContent).toHaveBeenCalledWith(BASE_URL, pageId, null);
    expect(chunkText).toHaveBeenCalledWith('Updated content from write tool');
    expect(upsertEmbeddings).toHaveBeenCalledTimes(1);
  });

  it('removes embeddings for pages deleted via write tools', async () => {
    // Simulate a page deleted via delete_wiki_page tool
    const deletedPageId = 99;

    // Wiki no longer has this page
    listPages.mockResolvedValue([wikiPage(1), wikiPage(2)]);

    // DB still has embeddings for the deleted page
    const dbClient = makeDbClient([
      { page_id: 1, updated_at: new Date('2024-01-01T00:00:00Z') },
      { page_id: 2, updated_at: new Date('2024-01-01T00:00:00Z') },
      { page_id: deletedPageId, updated_at: new Date('2024-01-01T00:00:00Z') },
    ]);

    deletePageEmbeddings.mockResolvedValue();

    await syncPages(dbClient, BASE_URL);

    // Verify embeddings were deleted
    expect(deletePageEmbeddings).toHaveBeenCalledWith(dbClient, deletedPageId);
    expect(deletePageEmbeddings).toHaveBeenCalledTimes(1);
  });

  it('handles mixed write operations in single sync cycle', async () => {
    // Simulate multiple write operations:
    // - Page 100 created
    // - Page 200 updated
    // - Page 300 deleted
    // - Page 400 unchanged

    const ts = '2024-01-01T00:00:00Z';
    const newTs = '2024-09-01T12:00:00Z';

    listPages.mockResolvedValue([
      wikiPage(100, newTs),  // new
      wikiPage(200, newTs),  // updated
      wikiPage(400, ts),     // unchanged
      // 300 is missing (deleted)
    ]);

    const dbClient = makeDbClient([
      { page_id: 200, updated_at: new Date(ts) },  // old timestamp
      { page_id: 300, updated_at: new Date(ts) },  // will be deleted
      { page_id: 400, updated_at: new Date(ts) },  // unchanged
    ]);

    getPageContent.mockImplementation((url, id) => 
      Promise.resolve(wikiPageContent(id, newTs))
    );
    chunkText.mockReturnValue(['chunk']);
    generateEmbeddings.mockResolvedValue([[0.5]]);
    upsertEmbeddings.mockResolvedValue();
    deletePageEmbeddings.mockResolvedValue();

    await syncPages(dbClient, BASE_URL);

    // Verify: pages 100 and 200 processed, page 300 deleted, page 400 skipped
    expect(getPageContent).toHaveBeenCalledTimes(2);
    const processedIds = getPageContent.mock.calls.map(([, id]) => id);
    expect(processedIds).toContain(100);
    expect(processedIds).toContain(200);
    expect(processedIds).not.toContain(400);

    expect(deletePageEmbeddings).toHaveBeenCalledWith(dbClient, 300);
    expect(deletePageEmbeddings).toHaveBeenCalledTimes(1);
  });
});
