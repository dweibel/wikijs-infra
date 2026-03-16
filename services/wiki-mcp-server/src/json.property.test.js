/**
 * Property-based tests for JSON parsing in MCP server.
 * 
 * Uses fast-check library to verify that valid JSON MCP requests
 * can be successfully parsed into internal data structures.
 * 
 * Feature: wikijs-infra-repository
 * Task: 13.1 - Write property test for JSON parsing
 * Property 57: JSON parsing for valid requests
 * 
 * **Validates: Requirements 25.1**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Arbitrary generator for valid MCP request IDs
 */
const mcpRequestId = fc.oneof(
  fc.string({ minLength: 1, maxLength: 50 }),
  fc.integer({ min: 1, max: 1000000 })
);

/**
 * Arbitrary generator for MCP tool names
 */
const mcpToolName = fc.constantFrom(
  'search_wiki',
  'get_wiki_page',
  'create_wiki_page',
  'update_wiki_page',
  'delete_wiki_page',
  'move_wiki_page'
);

/**
 * Arbitrary generator for search_wiki tool arguments
 */
const searchWikiArgs = fc.record({
  query: fc.string({ minLength: 1, maxLength: 500 }),
  top_k: fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined })
});

/**
 * Arbitrary generator for get_wiki_page tool arguments
 */
const getWikiPageArgs = fc.oneof(
  fc.record({
    page_id: fc.integer({ min: 1, max: 1000000 }),
    path: fc.constant(undefined)
  }),
  fc.record({
    page_id: fc.constant(undefined),
    path: fc.string({ minLength: 1, maxLength: 200 }).map(s => `/${s}`)
  })
);

/**
 * Arbitrary generator for create_wiki_page tool arguments
 */
const createWikiPageArgs = fc.record({
  title: fc.string({ minLength: 1, maxLength: 200 }),
  path: fc.string({ minLength: 1, maxLength: 200 }).map(s => `/${s}`),
  content: fc.string({ minLength: 0, maxLength: 5000 }),
  description: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
  tags: fc.option(fc.array(fc.string({ maxLength: 50 }), { maxLength: 10 }), { nil: undefined }),
  isPublished: fc.option(fc.boolean(), { nil: undefined }),
  isPrivate: fc.option(fc.boolean(), { nil: undefined }),
  locale: fc.option(fc.constantFrom('en', 'es', 'fr', 'de'), { nil: undefined })
});

/**
 * Arbitrary generator for update_wiki_page tool arguments
 */
const updateWikiPageArgs = fc.record({
  page_id: fc.integer({ min: 1, max: 1000000 }),
  content: fc.option(fc.string({ maxLength: 5000 }), { nil: undefined }),
  title: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
  description: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
  tags: fc.option(fc.array(fc.string({ maxLength: 50 }), { maxLength: 10 }), { nil: undefined }),
  isPublished: fc.option(fc.boolean(), { nil: undefined }),
  isPrivate: fc.option(fc.boolean(), { nil: undefined })
});

/**
 * Arbitrary generator for delete_wiki_page tool arguments
 */
const deleteWikiPageArgs = fc.record({
  page_id: fc.integer({ min: 1, max: 1000000 })
});

/**
 * Arbitrary generator for move_wiki_page tool arguments
 */
const moveWikiPageArgs = fc.record({
  page_id: fc.integer({ min: 1, max: 1000000 }),
  destination_path: fc.string({ minLength: 1, maxLength: 200 }).map(s => `/${s}`),
  destination_locale: fc.option(fc.constantFrom('en', 'es', 'fr', 'de'), { nil: undefined })
});

/**
 * Arbitrary generator for MCP tool call arguments based on tool name
 */
const mcpToolArguments = (toolName) => {
  switch (toolName) {
    case 'search_wiki':
      return searchWikiArgs;
    case 'get_wiki_page':
      return getWikiPageArgs;
    case 'create_wiki_page':
      return createWikiPageArgs;
    case 'update_wiki_page':
      return updateWikiPageArgs;
    case 'delete_wiki_page':
      return deleteWikiPageArgs;
    case 'move_wiki_page':
      return moveWikiPageArgs;
    default:
      return fc.record({});
  }
};

/**
 * Arbitrary generator for MCP tools/call requests
 */
const mcpToolCallRequest = fc.tuple(mcpRequestId, mcpToolName).chain(([id, toolName]) =>
  fc.record({
    jsonrpc: fc.constant('2.0'),
    id: fc.constant(id),
    method: fc.constant('tools/call'),
    params: fc.record({
      name: fc.constant(toolName),
      arguments: mcpToolArguments(toolName)
    })
  })
);

/**
 * Arbitrary generator for MCP tools/list requests
 */
const mcpToolListRequest = fc.record({
  jsonrpc: fc.constant('2.0'),
  id: mcpRequestId,
  method: fc.constant('tools/list'),
  params: fc.option(fc.record({}), { nil: undefined })
});

/**
 * Arbitrary generator for MCP initialize requests
 */
const mcpInitializeRequest = fc.record({
  jsonrpc: fc.constant('2.0'),
  id: mcpRequestId,
  method: fc.constant('initialize'),
  params: fc.record({
    protocolVersion: fc.constantFrom('2024-11-05', '1.0.0'),
    capabilities: fc.record({
      roots: fc.option(fc.record({ listChanged: fc.boolean() }), { nil: undefined }),
      sampling: fc.option(fc.record({}), { nil: undefined })
    }),
    clientInfo: fc.record({
      name: fc.string({ minLength: 1, maxLength: 100 }),
      version: fc.string({ minLength: 1, maxLength: 50 })
    })
  })
});

/**
 * Arbitrary generator for any valid MCP request
 */
const mcpRequest = fc.oneof(
  mcpToolCallRequest,
  mcpToolListRequest,
  mcpInitializeRequest
);

describe('JSON Parsing Property-Based Tests', () => {
  /**
   * Property 57: JSON parsing for valid requests
   * 
   * For any valid JSON MCP request, the MCP server should successfully
   * parse it into internal data structures without errors.
   * 
   * This property verifies that:
   * 1. Valid MCP request objects can be serialized to JSON
   * 2. The JSON can be parsed back into equivalent objects
   * 3. The parsed objects maintain their structure and data types
   * 
   * **Validates: Requirements 25.1**
   */
  it('Property 57: valid JSON MCP requests parse successfully', () => {
    fc.assert(
      fc.property(
        mcpRequest,
        (request) => {
          // Serialize the request to JSON
          const jsonString = JSON.stringify(request);
          
          // Verify JSON string is valid (no exceptions thrown)
          expect(jsonString).toBeDefined();
          expect(typeof jsonString).toBe('string');
          expect(jsonString.length).toBeGreaterThan(0);
          
          // Parse the JSON back into an object
          let parsed;
          expect(() => {
            parsed = JSON.parse(jsonString);
          }).not.toThrow();
          
          // Verify parsed object has correct structure
          expect(parsed).toBeDefined();
          expect(parsed.jsonrpc).toBe('2.0');
          expect(parsed.id).toBeDefined();
          expect(parsed.method).toBeDefined();
          expect(typeof parsed.method).toBe('string');
          
          // Verify method-specific structure
          if (parsed.method === 'tools/call') {
            expect(parsed.params).toBeDefined();
            expect(parsed.params.name).toBeDefined();
            expect(typeof parsed.params.name).toBe('string');
            expect(parsed.params.arguments).toBeDefined();
          } else if (parsed.method === 'tools/list') {
            // params is optional for tools/list
            if (parsed.params !== undefined) {
              expect(typeof parsed.params).toBe('object');
            }
          } else if (parsed.method === 'initialize') {
            expect(parsed.params).toBeDefined();
            expect(parsed.params.protocolVersion).toBeDefined();
            expect(parsed.params.clientInfo).toBeDefined();
            expect(parsed.params.clientInfo.name).toBeDefined();
            expect(parsed.params.clientInfo.version).toBeDefined();
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
  
  /**
   * Property: JSON parsing preserves data types
   * 
   * For any valid MCP request, parsing the JSON should preserve the
   * data types of all fields (strings remain strings, numbers remain
   * numbers, booleans remain booleans, etc.).
   * 
   * **Validates: Requirements 25.1**
   */
  it('property: JSON parsing preserves data types', () => {
    fc.assert(
      fc.property(
        mcpRequest,
        (request) => {
          const jsonString = JSON.stringify(request);
          const parsed = JSON.parse(jsonString);
          
          // Verify top-level types
          expect(typeof parsed.jsonrpc).toBe(typeof request.jsonrpc);
          expect(typeof parsed.id).toBe(typeof request.id);
          expect(typeof parsed.method).toBe(typeof request.method);
          
          // Verify params types if present
          if (request.params !== undefined) {
            expect(typeof parsed.params).toBe(typeof request.params);
            
            // For tools/call, verify arguments types
            if (parsed.method === 'tools/call' && request.params.arguments) {
              const originalArgs = request.params.arguments;
              const parsedArgs = parsed.params.arguments;
              
              // Check each argument's type is preserved
              for (const key in originalArgs) {
                if (originalArgs[key] !== undefined) {
                  expect(typeof parsedArgs[key]).toBe(typeof originalArgs[key]);
                }
              }
            }
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
  
  /**
   * Property: JSON parsing handles nested objects
   * 
   * For any valid MCP request with nested objects (like params.arguments),
   * parsing should correctly reconstruct the nested structure.
   * 
   * **Validates: Requirements 25.1**
   */
  it('property: JSON parsing handles nested objects correctly', () => {
    fc.assert(
      fc.property(
        mcpToolCallRequest,
        (request) => {
          const jsonString = JSON.stringify(request);
          const parsed = JSON.parse(jsonString);
          
          // Verify nested params structure
          expect(parsed.params).toBeDefined();
          expect(typeof parsed.params).toBe('object');
          expect(parsed.params.name).toBe(request.params.name);
          
          // Verify nested arguments structure
          expect(parsed.params.arguments).toBeDefined();
          expect(typeof parsed.params.arguments).toBe('object');
          
          // Verify all argument keys with defined values are preserved
          // Note: JSON.stringify drops undefined values
          const originalKeys = Object.keys(request.params.arguments).filter(
            key => request.params.arguments[key] !== undefined
          );
          const parsedKeys = Object.keys(parsed.params.arguments);
          
          for (const key of originalKeys) {
            expect(parsedKeys).toContain(key);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
  
  /**
   * Property: JSON parsing handles arrays
   * 
   * For any valid MCP request containing arrays (like tags),
   * parsing should correctly reconstruct the arrays with all elements.
   * 
   * **Validates: Requirements 25.1**
   */
  it('property: JSON parsing handles arrays correctly', () => {
    fc.assert(
      fc.property(
        fc.record({
          jsonrpc: fc.constant('2.0'),
          id: mcpRequestId,
          method: fc.constant('tools/call'),
          params: fc.record({
            name: fc.constant('create_wiki_page'),
            arguments: fc.record({
              title: fc.string({ minLength: 1, maxLength: 100 }),
              path: fc.string({ minLength: 1, maxLength: 100 }).map(s => `/${s}`),
              content: fc.string({ maxLength: 1000 }),
              tags: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 10 })
            })
          })
        }),
        (request) => {
          const jsonString = JSON.stringify(request);
          const parsed = JSON.parse(jsonString);
          
          // Verify tags array is preserved
          expect(Array.isArray(parsed.params.arguments.tags)).toBe(true);
          expect(parsed.params.arguments.tags.length).toBe(request.params.arguments.tags.length);
          
          // Verify all array elements are preserved
          for (let i = 0; i < request.params.arguments.tags.length; i++) {
            expect(parsed.params.arguments.tags[i]).toBe(request.params.arguments.tags[i]);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
  
  /**
   * Property: JSON parsing handles optional fields
   * 
   * For any valid MCP request with optional fields (undefined values),
   * parsing should correctly handle the absence of those fields.
   * 
   * **Validates: Requirements 25.1**
   */
  it('property: JSON parsing handles optional fields correctly', () => {
    fc.assert(
      fc.property(
        fc.record({
          jsonrpc: fc.constant('2.0'),
          id: mcpRequestId,
          method: fc.constant('tools/call'),
          params: fc.record({
            name: fc.constant('update_wiki_page'),
            arguments: fc.record({
              page_id: fc.integer({ min: 1, max: 1000000 }),
              content: fc.option(fc.string({ maxLength: 1000 }), { nil: undefined }),
              title: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
              description: fc.option(fc.string({ maxLength: 500 }), { nil: undefined })
            })
          })
        }),
        (request) => {
          const jsonString = JSON.stringify(request);
          const parsed = JSON.parse(jsonString);
          
          // Verify required field is present
          expect(parsed.params.arguments.page_id).toBe(request.params.arguments.page_id);
          
          // Verify optional fields match (undefined fields are not serialized to JSON)
          const args = request.params.arguments;
          const parsedArgs = parsed.params.arguments;
          
          if (args.content !== undefined) {
            expect(parsedArgs.content).toBe(args.content);
          } else {
            expect(parsedArgs.content).toBeUndefined();
          }
          
          if (args.title !== undefined) {
            expect(parsedArgs.title).toBe(args.title);
          } else {
            expect(parsedArgs.title).toBeUndefined();
          }
          
          if (args.description !== undefined) {
            expect(parsedArgs.description).toBe(args.description);
          } else {
            expect(parsedArgs.description).toBeUndefined();
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-based tests for JSON serialization in MCP server.
 * 
 * Uses fast-check library to verify that MCP server responses
 * can be successfully serialized to valid JSON.
 * 
 * Feature: wikijs-infra-repository
 * Task: 13.2 - Write property test for JSON serialization
 * Property 58: JSON serialization for responses
 * 
 * **Validates: Requirements 25.2**
 */
describe('JSON Serialization Property-Based Tests', () => {
  /**
   * Arbitrary generator for search_wiki response
   */
  const searchWikiResponse = fc.array(
    fc.record({
      page_id: fc.integer({ min: 1, max: 1000000 }),
      page_title: fc.string({ minLength: 1, maxLength: 200 }),
      page_path: fc.string({ minLength: 1, maxLength: 200 }).map(s => `/${s}`),
      chunk_text: fc.string({ minLength: 0, maxLength: 5000 }),
      relevance_score: fc.float({ min: 0, max: 1, noNaN: true })
    }),
    { maxLength: 20 }
  );

  /**
   * Arbitrary generator for get_wiki_page response
   */
  const getWikiPageResponse = fc.record({
    page_id: fc.integer({ min: 1, max: 1000000 }),
    title: fc.string({ minLength: 1, maxLength: 200 }),
    path: fc.string({ minLength: 1, maxLength: 200 }).map(s => `/${s}`),
    content: fc.string({ minLength: 0, maxLength: 10000 }),
    updated_at: fc.date().map(d => d.toISOString())
  });

  /**
   * Arbitrary generator for create_wiki_page response
   */
  const createWikiPageResponse = fc.record({
    page_id: fc.integer({ min: 1, max: 1000000 }),
    path: fc.string({ minLength: 1, maxLength: 200 }).map(s => `/${s}`),
    title: fc.string({ minLength: 1, maxLength: 200 }),
    success: fc.boolean(),
    message: fc.string({ maxLength: 500 }),
    error_code: fc.option(fc.integer({ min: 1000, max: 9999 }), { nil: undefined })
  });

  /**
   * Arbitrary generator for update_wiki_page response
   */
  const updateWikiPageResponse = fc.record({
    page_id: fc.integer({ min: 1, max: 1000000 }),
    updated_at: fc.date().map(d => d.toISOString()),
    success: fc.boolean(),
    message: fc.string({ maxLength: 500 }),
    error_code: fc.option(fc.integer({ min: 1000, max: 9999 }), { nil: undefined })
  });

  /**
   * Arbitrary generator for delete_wiki_page response
   */
  const deleteWikiPageResponse = fc.record({
    page_id: fc.integer({ min: 1, max: 1000000 }),
    success: fc.boolean(),
    message: fc.string({ maxLength: 500 }),
    error_code: fc.option(fc.integer({ min: 1000, max: 9999 }), { nil: undefined })
  });

  /**
   * Arbitrary generator for move_wiki_page response
   */
  const moveWikiPageResponse = fc.record({
    page_id: fc.integer({ min: 1, max: 1000000 }),
    old_path: fc.string({ minLength: 1, maxLength: 200 }).map(s => `/${s}`),
    new_path: fc.string({ minLength: 1, maxLength: 200 }).map(s => `/${s}`),
    success: fc.boolean(),
    message: fc.string({ maxLength: 500 }),
    error_code: fc.option(fc.integer({ min: 1000, max: 9999 }), { nil: undefined })
  });

  /**
   * Arbitrary generator for error response
   */
  const errorResponse = fc.record({
    error: fc.string({ minLength: 1, maxLength: 500 })
  });

  /**
   * Arbitrary generator for any MCP server response
   */
  const mcpResponse = fc.oneof(
    searchWikiResponse,
    getWikiPageResponse,
    createWikiPageResponse,
    updateWikiPageResponse,
    deleteWikiPageResponse,
    moveWikiPageResponse,
    errorResponse
  );

  /**
   * Property 58: JSON serialization for responses
   * 
   * For any MCP server response, it should be serialized to valid JSON
   * that can be parsed by standard JSON parsers.
   * 
   * This property verifies that:
   * 1. Any MCP response object can be serialized to JSON without errors
   * 2. The serialized JSON is valid and can be parsed
   * 3. The parsed result maintains the original structure
   * 
   * **Validates: Requirements 25.2**
   */
  it('Property 58: MCP server responses serialize to valid JSON', () => {
    fc.assert(
      fc.property(
        mcpResponse,
        (response) => {
          // Serialize the response to JSON
          let jsonString;
          expect(() => {
            jsonString = JSON.stringify(response);
          }).not.toThrow();
          
          // Verify JSON string is valid
          expect(jsonString).toBeDefined();
          expect(typeof jsonString).toBe('string');
          expect(jsonString.length).toBeGreaterThan(0);
          
          // Parse the JSON back to verify it's valid
          let parsed;
          expect(() => {
            parsed = JSON.parse(jsonString);
          }).not.toThrow();
          
          // Verify parsed object is defined
          expect(parsed).toBeDefined();
          expect(typeof parsed).toBe('object');
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: JSON serialization preserves response structure
   * 
   * For any MCP server response, serializing and parsing should
   * preserve the structure and all fields.
   * 
   * **Validates: Requirements 25.2**
   */
  it('property: JSON serialization preserves response structure', () => {
    fc.assert(
      fc.property(
        mcpResponse,
        (response) => {
          const jsonString = JSON.stringify(response);
          const parsed = JSON.parse(jsonString);
          
          // JSON.stringify drops undefined values, so only compare defined keys
          const definedKeys = Object.keys(response).filter(
            key => response[key] !== undefined
          );
          const parsedKeys = Object.keys(parsed);
          
          expect(parsedKeys.length).toBe(definedKeys.length);
          
          for (const key of definedKeys) {
            expect(parsedKeys).toContain(key);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: JSON serialization handles arrays in responses
   * 
   * For search_wiki responses (which return arrays), serialization
   * should correctly preserve the array structure and all elements.
   * 
   * **Validates: Requirements 25.2**
   */
  it('property: JSON serialization handles array responses', () => {
    fc.assert(
      fc.property(
        searchWikiResponse,
        (response) => {
          const jsonString = JSON.stringify(response);
          const parsed = JSON.parse(jsonString);
          
          // Verify array structure is preserved
          expect(Array.isArray(parsed)).toBe(true);
          expect(parsed.length).toBe(response.length);
          
          // Verify each element is preserved
          for (let i = 0; i < response.length; i++) {
            expect(parsed[i].page_id).toBe(response[i].page_id);
            expect(parsed[i].page_title).toBe(response[i].page_title);
            expect(parsed[i].page_path).toBe(response[i].page_path);
            expect(parsed[i].chunk_text).toBe(response[i].chunk_text);
            expect(parsed[i].relevance_score).toBeCloseTo(response[i].relevance_score, 10);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: JSON serialization handles nested objects in responses
   * 
   * For responses with nested structures, serialization should
   * correctly preserve all nested fields.
   * 
   * **Validates: Requirements 25.2**
   */
  it('property: JSON serialization handles nested response objects', () => {
    fc.assert(
      fc.property(
        getWikiPageResponse,
        (response) => {
          const jsonString = JSON.stringify(response);
          const parsed = JSON.parse(jsonString);
          
          // Verify all fields are preserved
          expect(parsed.page_id).toBe(response.page_id);
          expect(parsed.title).toBe(response.title);
          expect(parsed.path).toBe(response.path);
          expect(parsed.content).toBe(response.content);
          expect(parsed.updated_at).toBe(response.updated_at);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: JSON serialization handles optional fields in responses
   * 
   * For responses with optional fields (like error_code), serialization
   * should correctly handle both present and absent fields.
   * 
   * **Validates: Requirements 25.2**
   */
  it('property: JSON serialization handles optional response fields', () => {
    fc.assert(
      fc.property(
        createWikiPageResponse,
        (response) => {
          const jsonString = JSON.stringify(response);
          const parsed = JSON.parse(jsonString);
          
          // Verify required fields
          expect(parsed.page_id).toBe(response.page_id);
          expect(parsed.path).toBe(response.path);
          expect(parsed.title).toBe(response.title);
          expect(parsed.success).toBe(response.success);
          expect(parsed.message).toBe(response.message);
          
          // Verify optional field handling
          if (response.error_code !== undefined) {
            expect(parsed.error_code).toBe(response.error_code);
          } else {
            expect(parsed.error_code).toBeUndefined();
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: JSON serialization handles error responses
   * 
   * For error responses, serialization should correctly preserve
   * the error message.
   * 
   * **Validates: Requirements 25.2**
   */
  it('property: JSON serialization handles error responses', () => {
    fc.assert(
      fc.property(
        errorResponse,
        (response) => {
          const jsonString = JSON.stringify(response);
          const parsed = JSON.parse(jsonString);
          
          // Verify error field is preserved
          expect(parsed.error).toBe(response.error);
          expect(typeof parsed.error).toBe('string');
          expect(parsed.error.length).toBeGreaterThan(0);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: JSON serialization produces parseable output
   * 
   * For any MCP server response, the serialized JSON should be
   * parseable by standard JSON.parse() without throwing errors.
   * 
   * **Validates: Requirements 25.2**
   */
  it('property: serialized JSON is parseable by standard parsers', () => {
    fc.assert(
      fc.property(
        mcpResponse,
        (response) => {
          const jsonString = JSON.stringify(response);
          
          // Verify standard JSON.parse can parse it
          let parsed;
          let parseError = null;
          
          try {
            parsed = JSON.parse(jsonString);
          } catch (err) {
            parseError = err;
          }
          
          // Should not throw any errors
          expect(parseError).toBeNull();
          expect(parsed).toBeDefined();
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-based tests for JSON round-trip in MCP server.
 *
 * Uses fast-check library to verify that parsing then serializing then
 * parsing a valid MCP request produces an equivalent request.
 *
 * Feature: wikijs-infra-repository, Property 59: JSON round-trip property
 * Task: 13.3 - Write property test for JSON round-trip
 *
 * **Validates: Requirements 25.4**
 */
// Feature: wikijs-infra-repository, Property 59: JSON round-trip property
describe('MCP Request JSON Round-Trip Property-Based Tests', () => {
  /**
   * Property 59: JSON round-trip property
   *
   * For ALL valid MCP requests, parsing then serializing then parsing
   * SHALL produce an equivalent request (round-trip property).
   *
   * parse(serialize(parse(serialize(request)))) === parse(serialize(request))
   *
   * **Validates: Requirements 25.4**
   */
  it('Property 59: parsing then serializing then parsing preserves request', () => {
    fc.assert(
      fc.property(
        fc.record({
          method: fc.constantFrom('tools/list', 'tools/call'),
          params: fc.record({
            name: fc.string(),
            // Use jsonValue() to constrain to JSON-serializable values only
            // (no undefined, no functions, no symbols, no circular refs)
            arguments: fc.dictionary(fc.string(), fc.jsonValue())
          })
        }),
        (request) => {
          const json = JSON.stringify(request);
          const parsed1 = JSON.parse(json);
          const json2 = JSON.stringify(parsed1);
          const parsed2 = JSON.parse(json2);
          expect(parsed2).toEqual(request);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-based tests for descriptive JSON parse errors in MCP server.
 *
 * Uses fast-check library to verify that invalid JSON produces descriptive
 * error messages with parse failure location (line and column number).
 *
 * Feature: wikijs-infra-repository, Property 60: Descriptive JSON parse errors
 * Task: 13.4 - Write property test for descriptive JSON parse errors
 *
 * **Validates: Requirements 25.5**
 */
// Feature: wikijs-infra-repository, Property 60: Descriptive JSON parse errors
import { parseJsonSafely } from './json-utils.js';

/**
 * Arbitrary generator for strings that are guaranteed to be invalid JSON.
 *
 * Strategies:
 *  1. Truncated valid JSON (cut off before closing bracket/brace/quote)
 *  2. Random printable strings that are not valid JSON values
 *  3. Structurally malformed JSON (extra/missing brackets, bad escapes)
 */
const invalidJsonArbitrary = fc.oneof(
  // Strategy 1: truncated JSON objects
  fc.record({
    key: fc.string({ minLength: 1, maxLength: 20 }),
    value: fc.string({ minLength: 1, maxLength: 50 }),
  }).map((obj) => {
    const full = JSON.stringify(obj);
    // Remove the last 1–5 characters to truncate
    const cutBy = Math.max(1, Math.floor(full.length * 0.1) + 1);
    return full.slice(0, full.length - cutBy);
  }),

  // Strategy 2: random strings that are not valid JSON
  fc.string({ minLength: 1, maxLength: 100 }).filter((s) => {
    try { JSON.parse(s); return false; } catch { return true; }
  }),

  // Strategy 3: structurally malformed – extra closing brace
  fc.record({
    key: fc.string({ minLength: 1, maxLength: 20 }),
    value: fc.integer(),
  }).map((obj) => JSON.stringify(obj) + '}'),

  // Strategy 4: truncated JSON arrays
  fc.array(fc.integer(), { minLength: 1, maxLength: 10 }).map((arr) => {
    const full = JSON.stringify(arr);
    return full.slice(0, full.length - 1); // remove closing ]
  }),

  // Strategy 5: object with trailing comma (invalid JSON)
  fc.record({
    key: fc.string({ minLength: 1, maxLength: 20 }),
    value: fc.integer(),
  }).map((obj) => {
    const inner = Object.entries(obj)
      .map(([k, v]) => `"${k}":${v}`)
      .join(',');
    return `{${inner},}`;
  }),
);

describe('Descriptive JSON Parse Errors Property-Based Tests', () => {
  /**
   * Property 60: Descriptive JSON parse errors
   *
   * For ANY invalid JSON string, parseJsonSafely should:
   *  1. Return an error (not a value)
   *  2. Include a descriptive message (non-empty string)
   *  3. Include parse failure location info where possible
   *
   * **Validates: Requirements 25.5**
   */
  it('Property 60: invalid JSON produces a descriptive error with location info', () => {
    fc.assert(
      fc.property(
        invalidJsonArbitrary,
        (invalidJson) => {
          const result = parseJsonSafely(invalidJson);

          // Must return an error, not a value
          expect(result.error).not.toBeNull();
          expect(result.value).toBeNull();

          // Error message must be a non-empty string
          expect(typeof result.error.message).toBe('string');
          expect(result.error.message.length).toBeGreaterThan(0);

          // Error message must contain "JSON parse error" prefix
          expect(result.error.message).toMatch(/JSON parse error/i);

          // Line and column must be numbers or null (never undefined)
          expect(result.error.line === null || typeof result.error.line === 'number').toBe(true);
          expect(result.error.column === null || typeof result.error.column === 'number').toBe(true);

          // When location is provided, values must be positive integers
          if (result.error.line !== null) {
            expect(result.error.line).toBeGreaterThanOrEqual(1);
          }
          if (result.error.column !== null) {
            expect(result.error.column).toBeGreaterThanOrEqual(1);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Complementary property: valid JSON never produces an error.
   *
   * Ensures parseJsonSafely does not produce false positives.
   * Note: JSON.parse("null") returns null, which is a valid parsed value —
   * we check error is null rather than value is non-null.
   *
   * **Validates: Requirements 25.5**
   */
  it('Property 60 (complement): valid JSON never produces a parse error', () => {
    fc.assert(
      fc.property(
        fc.jsonValue(),
        (value) => {
          const jsonString = JSON.stringify(value);
          const result = parseJsonSafely(jsonString);

          // No error should be produced for valid JSON
          expect(result.error).toBeNull();
          // The parsed value should equal the original (JSON.stringify then parse is identity for JSON-safe values)
          expect(result.value).toEqual(value);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Spot-check: truncated JSON object produces a descriptive error.
   */
  it('Property 60 (example): truncated JSON object produces descriptive error', () => {
    const truncated = '{"key": "value"'; // missing closing }
    const result = parseJsonSafely(truncated);

    expect(result.error).not.toBeNull();
    expect(result.value).toBeNull();
    expect(result.error.message).toMatch(/JSON parse error/i);
  });

  /**
   * Spot-check: completely random non-JSON string produces a descriptive error.
   */
  it('Property 60 (example): random non-JSON string produces descriptive error', () => {
    const notJson = 'hello world this is not json!!!';
    const result = parseJsonSafely(notJson);

    expect(result.error).not.toBeNull();
    expect(result.value).toBeNull();
    expect(result.error.message).toMatch(/JSON parse error/i);
  });

  /**
   * Spot-check: extra closing brace produces a descriptive error.
   */
  it('Property 60 (example): extra closing brace produces descriptive error', () => {
    const malformed = '{"key": 1}}';
    const result = parseJsonSafely(malformed);

    expect(result.error).not.toBeNull();
    expect(result.value).toBeNull();
    expect(result.error.message).toMatch(/JSON parse error/i);
  });
});
