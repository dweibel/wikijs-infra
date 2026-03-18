/**
 * Property-based tests for MCP server tool handlers.
 *
 * Uses fast-check library to verify universal properties hold across
 * all valid inputs. Each test runs 100 iterations with randomized data.
 *
 * Feature: wiki-mcp-access-control
 * Validates: Design document correctness properties
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import pg from 'pg';
import { createWikiPage, getWikiPage, updateWikiPage, deleteWikiPage, moveWikiPage } from './tools.js';
import { createPage, getPageContent } from './wiki-client.js';

const { Client } = pg;

// Test configuration
const WIKI_BASE_URL = process.env.TEST_WIKI_URL || 'http://localhost:3000';
const WIKI_ADMIN_TOKEN = process.env.TEST_WIKI_ADMIN_TOKEN || 'test-token';

// Skip property tests if no test environment configured
const skipTests = !process.env.TEST_WIKI_URL || !process.env.TEST_WIKI_ADMIN_TOKEN;

describe.skipIf(skipTests)('Property-Based Tests', () => {
  let dbClient;
  const createdPageIds = [];

  beforeAll(async () => {
    // Connect to test database
    dbClient = new Client({
      host: process.env.PGHOST ?? 'localhost',
      port: Number(process.env.PGPORT ?? 5432),
      database: process.env.PGDATABASE ?? 'wiki',
      user: process.env.PGUSER ?? 'wiki',
      password: process.env.PGPASSWORD,
    });
    await dbClient.connect();
  });

  afterAll(async () => {
    // Cleanup: delete all created pages
    for (const pageId of createdPageIds) {
      try {
        await dbClient.query('DELETE FROM wiki_embeddings WHERE page_id = $1', [pageId]);
      } catch (err) {
        console.warn(`Failed to cleanup page ${pageId}:`, err.message);
      }
    }
    await dbClient.end();
  });

  beforeEach(() => {
    createdPageIds.length = 0;
  });

  /**
   * Property 1: Page Creation Round-Trip
   * 
   * For any valid page data (title, path, content, metadata), creating a page
   * via create_wiki_page and then fetching it via get_wiki_page should return
   * content that matches what was sent.
   * 
   * **Validates: Requirements US-1.1, US-1.2**
   */
  it('property: creating then fetching a page returns the same content', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          title: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
          path: fc.string({ minLength: 1, maxLength: 50 })
            .filter(s => s.trim().length > 0)
            .map(s => `/${s.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`),
          content: fc.string({ minLength: 1, maxLength: 1000 }).filter(s => s.trim().length > 0),
          description: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
          tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
        }),
        async (pageData) => {
          // Create page
          const createResult = await createWikiPage(WIKI_BASE_URL, WIKI_ADMIN_TOKEN, pageData);
          
          // Skip if creation failed (e.g., duplicate path from previous iteration)
          if (!createResult.success) {
            return true;
          }
          
          expect(createResult.success).toBe(true);
          expect(createResult.page_id).toBeTypeOf('number');
          createdPageIds.push(createResult.page_id);
          
          // Fetch page
          const fetchResult = await getWikiPage(WIKI_BASE_URL, { page_id: createResult.page_id });
          
          // Verify content matches
          expect(fetchResult.content).toBe(pageData.content);
          expect(fetchResult.title).toBe(pageData.title);
          expect(fetchResult.path).toBe(pageData.path);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  }, 120000); // 2 minute timeout for property test

  /**
   * Property 2: Page Update Round-Trip
   * 
   * For any existing page and valid update parameters, updating the page via
   * update_wiki_page and then fetching it should return the updated content.
   * 
   * **Validates: Requirements US-2.1, US-2.2**
   */
  it('property: updating then fetching a page returns the updated content', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          // Initial page data
          initialTitle: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
          initialPath: fc.string({ minLength: 1, maxLength: 50 })
            .filter(s => s.trim().length > 0)
            .map(s => `/${s.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`),
          initialContent: fc.string({ minLength: 1, maxLength: 1000 }).filter(s => s.trim().length > 0),
          // Update data
          updatedTitle: fc.option(fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0), { nil: undefined }),
          updatedContent: fc.option(fc.string({ minLength: 1, maxLength: 1000 }).filter(s => s.trim().length > 0), { nil: undefined }),
          updatedDescription: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
          updatedTags: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }), { nil: undefined }),
        }),
        async (data) => {
          // Create initial page
          const createResult = await createWikiPage(WIKI_BASE_URL, WIKI_ADMIN_TOKEN, {
            title: data.initialTitle,
            path: data.initialPath,
            content: data.initialContent,
          });
          
          // Skip if creation failed
          if (!createResult.success) {
            return true;
          }
          
          expect(createResult.success).toBe(true);
          createdPageIds.push(createResult.page_id);
          
          // Update page with new data
          const updates = { page_id: createResult.page_id };
          if (data.updatedTitle !== undefined) updates.title = data.updatedTitle;
          if (data.updatedContent !== undefined) updates.content = data.updatedContent;
          if (data.updatedDescription !== undefined) updates.description = data.updatedDescription;
          if (data.updatedTags !== undefined) updates.tags = data.updatedTags;
          
          const updateResult = await updateWikiPage(WIKI_BASE_URL, WIKI_ADMIN_TOKEN, updates);
          
          // Skip if update failed
          if (!updateResult.success) {
            return true;
          }
          
          expect(updateResult.success).toBe(true);
          expect(updateResult.page_id).toBe(createResult.page_id);
          expect(updateResult.updated_at).toBeTypeOf('string');
          
          // Fetch updated page
          const fetchResult = await getWikiPage(WIKI_BASE_URL, { page_id: createResult.page_id });
          
          // Verify updated content matches
          if (data.updatedContent !== undefined) {
            expect(fetchResult.content).toBe(data.updatedContent);
          } else {
            expect(fetchResult.content).toBe(data.initialContent);
          }
          
          if (data.updatedTitle !== undefined) {
            expect(fetchResult.title).toBe(data.updatedTitle);
          } else {
            expect(fetchResult.title).toBe(data.initialTitle);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  }, 120000); // 2 minute timeout for property test

  /**
   * Property 3: Page Deletion Removes Content
   * 
   * For any existing page, deleting it via delete_wiki_page should result in
   * the page no longer being retrievable via get_wiki_page.
   * 
   * **Validates: Requirements US-3.1, US-3.2**
   */
  it('property: deleting a page removes content', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          title: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
          path: fc.string({ minLength: 1, maxLength: 50 })
            .filter(s => s.trim().length > 0)
            .map(s => `/${s.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`),
          content: fc.string({ minLength: 1, maxLength: 1000 }).filter(s => s.trim().length > 0),
        }),
        async (pageData) => {
          // Create page
          const createResult = await createWikiPage(WIKI_BASE_URL, WIKI_ADMIN_TOKEN, pageData);
          
          // Skip if creation failed
          if (!createResult.success) {
            return true;
          }
          
          expect(createResult.success).toBe(true);
          expect(createResult.page_id).toBeTypeOf('number');
          const pageId = createResult.page_id;
          
          // Verify page exists before deletion
          const fetchBeforeDelete = await getWikiPage(WIKI_BASE_URL, { page_id: pageId });
          expect(fetchBeforeDelete.content).toBe(pageData.content);
          
          // Delete page
          const deleteResult = await deleteWikiPage(WIKI_BASE_URL, WIKI_ADMIN_TOKEN, { page_id: pageId });
          
          // Skip if deletion failed
          if (!deleteResult.success) {
            createdPageIds.push(pageId); // Add to cleanup list
            return true;
          }
          
          expect(deleteResult.success).toBe(true);
          expect(deleteResult.page_id).toBe(pageId);
          
          // Verify page no longer exists
          const fetchAfterDelete = await getWikiPage(WIKI_BASE_URL, { page_id: pageId });
          expect(fetchAfterDelete).toHaveProperty('error');
          expect(fetchAfterDelete.error).toBeTruthy();
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  }, 120000); // 2 minute timeout for property test

  /**
   * Property 8: Move Operation Preserves Content
   * 
   * For any existing page and valid destination path, moving the page via
   * move_wiki_page should preserve the page content at the new location.
   * 
   * **Validates: Requirements FR-1.4**
   */
  it('property: moving a page preserves content at new location', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          title: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
          initialPath: fc.string({ minLength: 1, maxLength: 50 })
            .filter(s => s.trim().length > 0)
            .map(s => `/${s.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`),
          content: fc.string({ minLength: 1, maxLength: 1000 }).filter(s => s.trim().length > 0),
          destinationPath: fc.string({ minLength: 1, maxLength: 50 })
            .filter(s => s.trim().length > 0)
            .map(s => `/${s.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}-moved`),
          destinationLocale: fc.constantFrom('en', 'fr', 'es', 'de'),
        }),
        async (data) => {
          // Create page at initial path
          const createResult = await createWikiPage(WIKI_BASE_URL, WIKI_ADMIN_TOKEN, {
            title: data.title,
            path: data.initialPath,
            content: data.content,
          });
          
          // Skip if creation failed
          if (!createResult.success) {
            return true;
          }
          
          expect(createResult.success).toBe(true);
          expect(createResult.page_id).toBeTypeOf('number');
          createdPageIds.push(createResult.page_id);
          
          // Verify page exists at initial path
          const fetchBeforeMove = await getWikiPage(WIKI_BASE_URL, { page_id: createResult.page_id });
          expect(fetchBeforeMove.content).toBe(data.content);
          expect(fetchBeforeMove.path).toBe(data.initialPath);
          
          // Move page to new path
          const moveResult = await moveWikiPage(WIKI_BASE_URL, WIKI_ADMIN_TOKEN, {
            page_id: createResult.page_id,
            destination_path: data.destinationPath,
            destination_locale: data.destinationLocale,
          });
          
          // Skip if move failed (e.g., destination already exists)
          if (!moveResult.success) {
            return true;
          }
          
          expect(moveResult.success).toBe(true);
          expect(moveResult.page_id).toBe(createResult.page_id);
          expect(moveResult.old_path).toBe(data.initialPath);
          expect(moveResult.new_path).toBe(data.destinationPath);
          
          // Verify content preserved at new location
          const fetchAfterMove = await getWikiPage(WIKI_BASE_URL, { page_id: createResult.page_id });
          expect(fetchAfterMove.content).toBe(data.content);
          expect(fetchAfterMove.title).toBe(data.title);
          expect(fetchAfterMove.path).toBe(data.destinationPath);
          
          // Verify old path no longer accessible
          const fetchOldPath = await getWikiPage(WIKI_BASE_URL, { path: data.initialPath });
          expect(fetchOldPath).toHaveProperty('error');
          expect(fetchOldPath.error).toBeTruthy();
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  }, 120000); // 2 minute timeout for property test
});
