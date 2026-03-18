/**
 * Unit tests for MCP server tool handlers (tools.js).
 *
 * Tests are written against the exported handler functions:
 *   - searchWiki(dbClient, wikiBaseUrl, { query, top_k })
 *   - getWikiPage(wikiBaseUrl, { page_id, path })
 *   - createWikiPage(wikiBaseUrl, token, pageData)
 *
 * Both ./db.js and ./wiki-client.js are mocked so no real I/O occurs.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock ./db.js ────────────────────────────────────────────────────────────

vi.mock('./db.js', () => ({
  searchSimilar: vi.fn(),
}));

// ─── Mock ./embeddings.js ────────────────────────────────────────────────────

vi.mock('./embeddings.js', () => ({
  generateEmbedding: vi.fn(),
}));

// ─── Mock ./wiki-client.js ───────────────────────────────────────────────────

vi.mock('./wiki-client.js', () => ({
  getPageContent: vi.fn(),
  getPageByPath: vi.fn(),
  createPage: vi.fn(),
  updatePage: vi.fn(),
  deletePage: vi.fn(),
  movePage: vi.fn(),
}));

// Import mocks and module under test after vi.mock() declarations
import { searchSimilar } from './db.js';
import { generateEmbedding } from './embeddings.js';
import { getPageContent, getPageByPath, createPage, updatePage, deletePage, movePage } from './wiki-client.js';
import { searchWiki, getWikiPage, createWikiPage, updateWikiPage, deleteWikiPage, moveWikiPage } from './tools.js';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const MOCK_DB = {}; // opaque db client — tools.js passes it through to searchSimilar
const BASE_URL = 'http://wiki.local';
const MOCK_EMBEDDING = Array(1024).fill(0.1);

function makeResult(overrides = {}) {
  return {
    page_id: 1,
    page_title: 'Home',
    page_path: '/home',
    chunk_text: 'Welcome to the wiki',
    relevance_score: 0.95,
    ...overrides,
  };
}

// ─── search_wiki tests (task 8.1) ─────────────────────────────────────────────

describe('searchWiki', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateEmbedding.mockResolvedValue(MOCK_EMBEDDING);
  });

  // Test 1: Returns ranked results with all required fields
  it('returns results with all required fields (page_id, page_title, page_path, chunk_text, relevance_score)', async () => {
    const dbRows = [
      makeResult({ page_id: 1, page_title: 'Home', page_path: '/home', chunk_text: 'Welcome', relevance_score: 0.95 }),
      makeResult({ page_id: 2, page_title: 'About', page_path: '/about', chunk_text: 'About us', relevance_score: 0.80 }),
    ];
    searchSimilar.mockResolvedValue(dbRows);

    const results = await searchWiki(MOCK_DB, BASE_URL, { query: 'welcome', top_k: 5 });

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r).toHaveProperty('page_id');
      expect(r).toHaveProperty('page_title');
      expect(r).toHaveProperty('page_path');
      expect(r).toHaveProperty('chunk_text');
      expect(r).toHaveProperty('relevance_score');
    }
  });

  // Test 2: Empty query string → returns empty array, no DB call
  it('returns empty array for empty query string without calling DB', async () => {
    const results = await searchWiki(MOCK_DB, BASE_URL, { query: '', top_k: 5 });

    expect(results).toEqual([]);
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(searchSimilar).not.toHaveBeenCalled();
  });

  // Test 3: No results from DB → returns empty array
  it('returns empty array when DB returns no rows', async () => {
    searchSimilar.mockResolvedValue([]);

    const results = await searchWiki(MOCK_DB, BASE_URL, { query: 'obscure topic', top_k: 5 });

    expect(results).toEqual([]);
  });

  // Test 4: top_k=3 → passes 3 to searchSimilar
  it('passes top_k to searchSimilar', async () => {
    searchSimilar.mockResolvedValue([]);

    await searchWiki(MOCK_DB, BASE_URL, { query: 'test', top_k: 3 });

    expect(searchSimilar).toHaveBeenCalledWith(MOCK_DB, MOCK_EMBEDDING, 3);
  });

  // Test 5: Results are returned in the order provided by searchSimilar
  it('returns results in the same order as provided by searchSimilar', async () => {
    const dbRows = [
      makeResult({ page_id: 10, relevance_score: 0.9 }),
      makeResult({ page_id: 20, relevance_score: 0.7 }),
      makeResult({ page_id: 30, relevance_score: 0.5 }),
    ];
    searchSimilar.mockResolvedValue(dbRows);

    const results = await searchWiki(MOCK_DB, BASE_URL, { query: 'something', top_k: 3 });

    expect(results.map((r) => r.page_id)).toEqual([10, 20, 30]);
  });

  // Test 6: When DB throws → returns error object with descriptive message (Req 5.6)
  it('returns error object with descriptive message when DB throws', async () => {
    searchSimilar.mockRejectedValue(new Error('connection refused'));

    const result = await searchWiki(MOCK_DB, BASE_URL, { query: 'test', top_k: 5 });

    // Should return an error object (not throw), with a descriptive message
    expect(result).toHaveProperty('error');
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });
});

// ─── get_wiki_page tests (task 8.3) ───────────────────────────────────────────

describe('getWikiPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 7: Retrieval by page_id → calls getPageContent, returns page data
  it('retrieves page by page_id and returns page data', async () => {
    const page = {
      id: 42,
      path: '/docs/intro',
      title: 'Introduction',
      content: '# Intro\n\nWelcome.',
      updatedAt: '2024-03-15T10:00:00Z',
    };
    getPageContent.mockResolvedValue(page);

    const result = await getWikiPage(BASE_URL, { page_id: 42 });

    expect(getPageContent).toHaveBeenCalledWith(BASE_URL, 42);
    expect(getPageByPath).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      page_id: 42,
      title: 'Introduction',
      path: '/docs/intro',
      content: '# Intro\n\nWelcome.',
    });
  });

  // Test 8: Retrieval by path → calls getPageByPath, returns page data
  it('retrieves page by path and returns page data', async () => {
    const page = {
      id: 7,
      path: '/guides/setup',
      title: 'Setup Guide',
      content: 'Follow these steps...',
      updatedAt: '2024-02-20T08:30:00Z',
    };
    getPageByPath.mockResolvedValue(page);

    const result = await getWikiPage(BASE_URL, { path: '/guides/setup' });

    expect(getPageByPath).toHaveBeenCalledWith(BASE_URL, '/guides/setup');
    expect(getPageContent).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      title: 'Setup Guide',
      path: '/guides/setup',
      content: 'Follow these steps...',
    });
  });

  // Test 9: Neither page_id nor path provided → returns error
  it('returns error when neither page_id nor path is provided', async () => {
    const result = await getWikiPage(BASE_URL, {});

    expect(result).toHaveProperty('error');
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });

  // Test 10: Page not found (getPageContent throws) → returns error with descriptive message
  it('returns error with descriptive message when page is not found', async () => {
    getPageContent.mockRejectedValue(new Error('Page not found: 999'));

    const result = await getWikiPage(BASE_URL, { page_id: 999 });

    expect(result).toHaveProperty('error');
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });
});

// ─── create_wiki_page tests (task 1.1) ───────────────────────────────────────

describe('createWikiPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Creates page successfully and returns success response
  it('creates page successfully and returns page_id, path, title, success, message', async () => {
    const mockResponse = {
      responseResult: {
        succeeded: true,
        errorCode: 0,
        message: 'Page created successfully',
      },
      page: {
        id: 42,
        path: '/test-page',
        title: 'Test Page',
      },
    };
    createPage.mockResolvedValue(mockResponse);

    const result = await createWikiPage(BASE_URL, 'test-token', {
      title: 'Test Page',
      path: '/test-page',
      content: 'Test content',
    });

    expect(result.success).toBe(true);
    expect(result.page_id).toBe(42);
    expect(result.path).toBe('/test-page');
    expect(result.title).toBe('Test Page');
    expect(result.message).toBe('Page created successfully');
  });

  // Test 2: Returns error when required parameters are missing
  it('returns error when title is missing', async () => {
    const result = await createWikiPage(BASE_URL, 'test-token', {
      path: '/test',
      content: 'Content',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('required');
    expect(createPage).not.toHaveBeenCalled();
  });

  // Test 3: Returns error when page already exists (error code 2001)
  it('returns error when page already exists at path', async () => {
    const mockResponse = {
      responseResult: {
        succeeded: false,
        errorCode: 2001,
        message: 'A page already exists at this path',
      },
      page: null,
    };
    createPage.mockResolvedValue(mockResponse);

    const result = await createWikiPage(BASE_URL, 'test-token', {
      title: 'Duplicate',
      path: '/duplicate',
      content: 'Content',
    });

    expect(result.success).toBe(false);
    expect(result.error_code).toBe(2001);
    expect(result.message).toContain('already exists');
  });
});

// ─── update_wiki_page tests (task 1.2) ───────────────────────────────────────

describe('updateWikiPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Updates page successfully and returns success response
  it('updates page successfully and returns page_id, updated_at, success, message', async () => {
    const mockResponse = {
      responseResult: {
        succeeded: true,
        errorCode: 0,
        message: 'Page updated successfully',
      },
      page: {
        id: 42,
        path: '/test-page',
        title: 'Updated Title',
        updatedAt: '2024-03-15T11:00:00Z',
      },
    };
    updatePage.mockResolvedValue(mockResponse);

    const result = await updateWikiPage(BASE_URL, 'test-token', {
      page_id: 42,
      title: 'Updated Title',
      content: 'Updated content',
    });

    expect(result.success).toBe(true);
    expect(result.page_id).toBe(42);
    expect(result.updated_at).toBe('2024-03-15T11:00:00Z');
    expect(result.message).toBe('Page updated successfully');
  });

  // Test 2: Returns error when page_id is missing
  it('returns error when page_id is missing', async () => {
    const result = await updateWikiPage(BASE_URL, 'test-token', {
      content: 'Content',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('required');
    expect(updatePage).not.toHaveBeenCalled();
  });

  // Test 3: Returns error when page not found (error code 2002)
  it('returns error when page not found', async () => {
    const mockResponse = {
      responseResult: {
        succeeded: false,
        errorCode: 2002,
        message: 'Page not found',
      },
      page: null,
    };
    updatePage.mockResolvedValue(mockResponse);

    const result = await updateWikiPage(BASE_URL, 'test-token', {
      page_id: 999,
      content: 'New content',
    });

    expect(result.success).toBe(false);
    expect(result.error_code).toBe(2002);
    expect(result.message).toContain('not found');
  });
});
// ─── delete_wiki_page tests (task 1.3) ───────────────────────────────────────

describe('deleteWikiPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Deletes page successfully and returns success response
  it('deletes page successfully and returns page_id, success, message', async () => {
    const mockResponse = {
      responseResult: {
        succeeded: true,
        errorCode: 0,
        message: 'Page deleted successfully',
      },
    };
    deletePage.mockResolvedValue(mockResponse);

    const result = await deleteWikiPage(BASE_URL, 'test-token', {
      page_id: 42,
    });

    expect(result.success).toBe(true);
    expect(result.page_id).toBe(42);
    expect(result.message).toBe('Page deleted successfully');
  });

  // Test 2: Returns error when page_id is missing
  it('returns error when page_id is missing', async () => {
    const result = await deleteWikiPage(BASE_URL, 'test-token', {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('required');
    expect(deletePage).not.toHaveBeenCalled();
  });

  // Test 3: Returns error when page not found (error code 2002)
  it('returns error when page not found', async () => {
    const mockResponse = {
      responseResult: {
        succeeded: false,
        errorCode: 2002,
        message: 'Page not found',
      },
    };
    deletePage.mockResolvedValue(mockResponse);

    const result = await deleteWikiPage(BASE_URL, 'test-token', {
      page_id: 999,
    });

    expect(result.success).toBe(false);
    expect(result.error_code).toBe(2002);
    expect(result.message).toContain('not found');
  });

  // Test 4: Returns error when API call fails
  it('returns error when API call fails', async () => {
    deletePage.mockRejectedValue(new Error('Network error'));

    const result = await deleteWikiPage(BASE_URL, 'test-token', {
      page_id: 42,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to delete page');
  });
});

// ─── move_wiki_page tests (task 1.4) ─────────────────────────────────────────

describe('moveWikiPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Moves page successfully and returns old_path, new_path, success, message
  it('moves page successfully and returns page_id, old_path, new_path, success, message', async () => {
    const oldPage = {
      id: 42,
      path: '/old-path',
      title: 'Test Page',
      content: 'Content',
      updatedAt: '2024-03-15T10:00:00Z',
    };
    getPageContent.mockResolvedValue(oldPage);

    const mockResponse = {
      responseResult: {
        succeeded: true,
        errorCode: 0,
        message: 'Page moved successfully',
      },
    };
    movePage.mockResolvedValue(mockResponse);

    const result = await moveWikiPage(BASE_URL, 'test-token', {
      page_id: 42,
      destination_path: '/new-path',
    });

    expect(result.success).toBe(true);
    expect(result.page_id).toBe(42);
    expect(result.old_path).toBe('/old-path');
    expect(result.new_path).toBe('/new-path');
    expect(result.message).toBe('Page moved successfully');
    expect(getPageContent).toHaveBeenCalledWith(BASE_URL, 42);
    expect(movePage).toHaveBeenCalledWith(BASE_URL, 'test-token', 42, '/new-path', 'en');
  });

  // Test 2: Returns error when page_id is missing
  it('returns error when page_id is missing', async () => {
    const result = await moveWikiPage(BASE_URL, 'test-token', {
      destination_path: '/new-path',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('required');
    expect(getPageContent).not.toHaveBeenCalled();
    expect(movePage).not.toHaveBeenCalled();
  });

  // Test 3: Returns error when destination_path is missing
  it('returns error when destination_path is missing', async () => {
    const result = await moveWikiPage(BASE_URL, 'test-token', {
      page_id: 42,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('required');
    expect(getPageContent).not.toHaveBeenCalled();
    expect(movePage).not.toHaveBeenCalled();
  });

  // Test 4: Returns error when page not found (error code 2002)
  it('returns error when page not found', async () => {
    getPageContent.mockResolvedValue({ id: 42, path: '/old-path' });

    const mockResponse = {
      responseResult: {
        succeeded: false,
        errorCode: 2002,
        message: 'Page not found',
      },
    };
    movePage.mockResolvedValue(mockResponse);

    const result = await moveWikiPage(BASE_URL, 'test-token', {
      page_id: 999,
      destination_path: '/new-path',
    });

    expect(result.success).toBe(false);
    expect(result.error_code).toBe(2002);
    expect(result.message).toContain('not found');
  });

  // Test 5: Returns error when destination path already exists (error code 2001)
  it('returns error when destination path already exists', async () => {
    getPageContent.mockResolvedValue({ id: 42, path: '/old-path' });

    const mockResponse = {
      responseResult: {
        succeeded: false,
        errorCode: 2001,
        message: 'A page already exists at the destination path',
      },
    };
    movePage.mockResolvedValue(mockResponse);

    const result = await moveWikiPage(BASE_URL, 'test-token', {
      page_id: 42,
      destination_path: '/existing-path',
    });

    expect(result.success).toBe(false);
    expect(result.error_code).toBe(2001);
    expect(result.message).toContain('already exists');
  });

  // Test 6: Returns error when API call fails
  it('returns error when API call fails', async () => {
    getPageContent.mockRejectedValue(new Error('Network error'));

    const result = await moveWikiPage(BASE_URL, 'test-token', {
      page_id: 42,
      destination_path: '/new-path',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to move page');
  });

  // Test 7: Supports custom destination_locale
  it('supports custom destination_locale parameter', async () => {
    const oldPage = {
      id: 42,
      path: '/old-path',
      title: 'Test Page',
    };
    getPageContent.mockResolvedValue(oldPage);

    const mockResponse = {
      responseResult: {
        succeeded: true,
        errorCode: 0,
        message: 'Page moved successfully',
      },
    };
    movePage.mockResolvedValue(mockResponse);

    await moveWikiPage(BASE_URL, 'test-token', {
      page_id: 42,
      destination_path: '/nouveau-chemin',
      destination_locale: 'fr',
    });

    expect(movePage).toHaveBeenCalledWith(BASE_URL, 'test-token', 42, '/nouveau-chemin', 'fr');
  });
});
