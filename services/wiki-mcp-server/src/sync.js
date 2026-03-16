// Embedding sync pipeline
// Polls Wiki.js GraphQL API, detects new/updated/deleted pages,
// chunks content, generates embeddings, and upserts to database.
// Requirements: 4.1, 4.2, 4.3, 4.4, 4.5

import { listPages, getPageContent } from './wiki-client.js';
import { generateEmbeddings } from './embeddings.js';
import { upsertEmbeddings, deletePageEmbeddings } from './db.js';
import { chunkText } from './chunker.js';

/**
 * One-shot sync: fetches current wiki pages, compares with DB state,
 * processes new/updated pages, and removes deleted pages.
 *
 * @param {import('pg').Client} dbClient
 * @param {string} wikiBaseUrl
 * @param {string|null} token - Optional Wiki.js admin token for authentication
 */
export async function syncPages(dbClient, wikiBaseUrl, token = null) {
  console.info('[Sync] Starting embedding sync pipeline');
  
  // 1. Get current wiki pages
  const wikiPages = await listPages(wikiBaseUrl);

  // 2. Query DB for existing page state
  const result = await dbClient.query(
    'SELECT DISTINCT ON (page_id) page_id, updated_at FROM wiki_embeddings ORDER BY page_id, updated_at DESC'
  );
  const dbPageMap = new Map(
    result.rows.map((row) => [row.page_id, row.updated_at])
  );

  // 3. Build set of wiki page IDs for deletion detection
  const wikiPageIds = new Set(wikiPages.map((p) => p.id));

  // Track changes for logging
  const newPages = [];
  const updatedPages = [];
  const deletedPages = [];

  // 4. Process each wiki page
  for (const page of wikiPages) {
    const dbUpdatedAt = dbPageMap.get(page.id);

    if (dbUpdatedAt === undefined) {
      // New page — not in DB (including from write operations)
      newPages.push(page.id);
      await processPage(dbClient, wikiBaseUrl, page.id, token);
    } else {
      // Compare timestamps
      const wikiTime = new Date(page.updatedAt).getTime();
      const dbTime = new Date(dbUpdatedAt).getTime();
      if (wikiTime > dbTime) {
        // Updated page (including from write operations)
        updatedPages.push(page.id);
        await processPage(dbClient, wikiBaseUrl, page.id, token);
      }
      // else: unchanged — skip
    }
  }

  // 5. Delete embeddings for pages no longer in wiki
  for (const [pageId] of dbPageMap) {
    if (!wikiPageIds.has(pageId)) {
      deletedPages.push(pageId);
      await deletePageEmbeddings(dbClient, pageId);
    }
  }

  // Log summary
  if (newPages.length > 0) {
    console.info(`[Sync] Found ${newPages.length} new pages to process`);
  }
  if (updatedPages.length > 0) {
    console.info(`[Sync] Found ${updatedPages.length} updated pages to reprocess`);
  }
  if (deletedPages.length > 0) {
    console.info(`[Sync] Found ${deletedPages.length} deleted pages to clean up`);
  }
  if (newPages.length === 0 && updatedPages.length === 0 && deletedPages.length === 0) {
    console.info('[Sync] No changes detected');
  }
  
  console.info('[Sync] Embedding sync completed successfully');
}

/**
 * Fetches page content, chunks it, generates embeddings, and upserts to DB.
 *
 * @param {import('pg').Client} dbClient
 * @param {string} wikiBaseUrl
 * @param {number} pageId
 * @param {string|null} token - Optional Wiki.js admin token for authentication
 */
async function processPage(dbClient, wikiBaseUrl, pageId, token = null) {
  const page = await getPageContent(wikiBaseUrl, pageId, token);
  const chunks = chunkText(page.content);
  const embeddings = await generateEmbeddings(chunks);
  const chunkObjects = chunks.map((text, i) => ({ text, embedding: embeddings[i] }));
  await upsertEmbeddings(dbClient, page.id, page.path, page.title, chunkObjects);
}

/**
 * Starts the sync pipeline: runs immediately via setTimeout(0), then sets up
 * a recurring setInterval inside that callback. Returns a stop function.
 *
 * Using setTimeout(0) for the immediate call means vi.runOnlyPendingTimersAsync()
 * flushes exactly one call without triggering the interval created during it.
 *
 * @param {import('pg').Client} dbClient
 * @param {string} wikiBaseUrl
 * @param {number} intervalMs
 * @param {string|null} token - Optional Wiki.js admin token for authentication
 * @returns {() => void} stop function
 */
export function startSync(dbClient, wikiBaseUrl, intervalMs, token = null) {
  let intervalId;

  setTimeout(async () => {
    await syncPages(dbClient, wikiBaseUrl, token).catch((err) =>
      console.error('Sync error:', err)
    );
    intervalId = setInterval(() => {
      syncPages(dbClient, wikiBaseUrl, token).catch((err) =>
        console.error('Sync error:', err)
      );
    }, intervalMs);
  }, 0);

  return () => clearInterval(intervalId);
}

/**
 * Convenience wrapper to stop a sync started with startSync.
 *
 * @param {() => void} stopFn - The stop function returned by startSync
 */
export function stopSync(stopFn) {
  stopFn();
}
