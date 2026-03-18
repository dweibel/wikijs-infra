/**
 * MCP server tool handler functions.
 *
 * Extracted as pure functions so they can be unit-tested independently
 * of the MCP SDK transport layer.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.6
 */

import { generateEmbedding } from './embeddings.js';
import { searchSimilar } from './db.js';
import { getPageContent, getPageByPath, createPage, updatePage, deletePage, movePage } from './wiki-client.js';

/**
 * Handler for the search_wiki MCP tool.
 *
 * @param {import('pg').Client} dbClient  - Connected pg client
 * @param {string} wikiBaseUrl            - Base URL of the Wiki.js instance
 * @param {{ query: string, top_k?: number }} args
 * @returns {Promise<Array<{page_id, page_title, page_path, chunk_text, relevance_score}> | {error: string}>}
 */
export async function searchWiki(dbClient, wikiBaseUrl, { query, top_k = 5 }) {
  // Empty query → return empty results immediately (Req 5.1 / error handling)
  if (!query || query.trim() === '') {
    return [];
  }

  try {
    const embedding = await generateEmbedding(query);
    const results = await searchSimilar(dbClient, embedding, top_k);
    return results;
  } catch (err) {
    // Req 5.6: return descriptive error object instead of throwing
    return { error: `Search failed: ${err.message}` };
  }
}

/**
 * Handler for the get_wiki_page MCP tool.
 *
 * @param {string} wikiBaseUrl                          - Base URL of the Wiki.js instance
 * @param {{ page_id?: number, path?: string }} args
 * @returns {Promise<{page_id, title, path, content, updated_at} | {error: string}>}
 */
export async function getWikiPage(wikiBaseUrl, { page_id, path } = {}) {
  if (page_id == null && path == null) {
    return { error: 'Either page_id or path must be provided' };
  }

  try {
    let page;
    if (page_id != null) {
      page = await getPageContent(wikiBaseUrl, page_id);
    } else {
      page = await getPageByPath(wikiBaseUrl, path);
    }

    return {
      page_id: page.id,
      title: page.title,
      path: page.path,
      content: page.content,
      updated_at: page.updatedAt,
    };
  } catch (err) {
    // Req 5.6: return descriptive error object instead of throwing
    return { error: `Failed to retrieve page: ${err.message}` };
  }
}

/**
 * Handler for the create_wiki_page MCP tool.
 *
 * @param {string} wikiBaseUrl - Base URL of the Wiki.js instance
 * @param {string} token - JWT authentication token
 * @param {object} pageData - Page creation data
 * @returns {Promise<{page_id, path, title, success, message, error_code?}>}
 */
export async function createWikiPage(wikiBaseUrl, token, pageData) {
  // Validate required parameters
  if (!pageData.title || !pageData.path || !pageData.content) {
    return {
      success: false,
      message: 'Missing required parameters: title, path, and content are required',
    };
  }

  try {
    // Call Wiki.js API
    const result = await createPage(wikiBaseUrl, token, pageData);

    // Check GraphQL response
    if (!result.responseResult.succeeded) {
      return {
        success: false,
        message: result.responseResult.message,
        error_code: result.responseResult.errorCode,
      };
    }

    // Success
    return {
      page_id: result.page.id,
      path: result.page.path,
      title: result.page.title,
      success: true,
      message: result.responseResult.message,
    };
  } catch (err) {
    // Catch all other errors
    return {
      success: false,
      message: `Failed to create page: ${err.message}`,
    };
  }
}

/**
 * Handler for the update_wiki_page MCP tool.
 *
 * @param {string} wikiBaseUrl - Base URL of the Wiki.js instance
 * @param {string} token - JWT authentication token
 * @param {object} updates - Page update data
 * @returns {Promise<{page_id, updated_at, success, message, error_code?}>}
 */
export async function updateWikiPage(wikiBaseUrl, token, updates) {
  // Validate required parameters
  if (!updates.page_id) {
    return {
      success: false,
      message: 'Missing required parameter: page_id is required',
    };
  }

  try {
    // Call Wiki.js API
    const result = await updatePage(wikiBaseUrl, token, updates.page_id, updates);

    // Check GraphQL response
    if (!result.responseResult.succeeded) {
      return {
        success: false,
        message: result.responseResult.message,
        error_code: result.responseResult.errorCode,
      };
    }

    // Success
    return {
      page_id: result.page.id,
      updated_at: result.page.updatedAt,
      success: true,
      message: result.responseResult.message,
    };
  } catch (err) {
    // Catch all other errors
    return {
      success: false,
      message: `Failed to update page: ${err.message}`,
    };
  }
}
/**
 * Handler for the delete_wiki_page MCP tool.
 *
 * @param {string} wikiBaseUrl - Base URL of the Wiki.js instance
 * @param {string} token - JWT authentication token
 * @param {object} params - Parameters for page deletion
 * @returns {Promise<{page_id: number, success: boolean, message: string, error_code?: number}>}
 */
export async function deleteWikiPage(wikiBaseUrl, token, { page_id }) {
  if (!page_id) {
    return {
      success: false,
      message: 'Missing required parameter: page_id is required',
    };
  }

  try {
    const result = await deletePage(wikiBaseUrl, token, page_id);
    
    if (!result.responseResult.succeeded) {
      return {
        success: false,
        message: result.responseResult.message,
        error_code: result.responseResult.errorCode,
      };
    }

    return {
      page_id,
      success: true,
      message: result.responseResult.message,
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to delete page: ${err.message}`,
    };
  }
}

/**
 * Handler for the move_wiki_page MCP tool.
 *
 * @param {string} wikiBaseUrl - Base URL of the Wiki.js instance
 * @param {string} token - JWT authentication token
 * @param {object} params - Parameters for page move
 * @returns {Promise<{page_id: number, old_path: string, new_path: string, success: boolean, message: string, error_code?: number}>}
 */
export async function moveWikiPage(wikiBaseUrl, token, { page_id, destination_path, destination_locale = 'en' }) {
  if (!page_id || !destination_path) {
    return {
      success: false,
      message: 'Missing required parameters: page_id and destination_path are required',
    };
  }

  try {
    // Get old path before moving
    const oldPage = await getPageContent(wikiBaseUrl, page_id);
    const old_path = oldPage.path;
    
    const result = await movePage(wikiBaseUrl, token, page_id, destination_path, destination_locale);
    
    if (!result.responseResult.succeeded) {
      return {
        success: false,
        message: result.responseResult.message,
        error_code: result.responseResult.errorCode,
      };
    }

    return {
      page_id,
      old_path,
      new_path: destination_path,
      success: true,
      message: result.responseResult.message,
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to move page: ${err.message}`,
    };
  }
}
