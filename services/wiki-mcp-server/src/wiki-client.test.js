/**
 * Unit tests for the Wiki.js GraphQL client (wiki-client.js).
 *
 * Uses vi.stubGlobal('fetch', ...) to mock native fetch so no real HTTP
 * requests are made. Tests verify correct GraphQL query construction,
 * response parsing, error handling, and retry/backoff behavior.
 *
 * Validates: Requirements 4.1, 4.5, 5.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listPages, getPageContent, getPageByPath } from './wiki-client.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a successful fetch Response for a GraphQL payload. */
function gqlOk(data) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data }),
  });
}

/** Build a fetch Response that represents an HTTP error (e.g. 500). */
function httpError(status = 500) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ errors: [{ message: `HTTP ${status}` }] }),
  });
}

const BASE_URL = 'http://wiki.local';

// ─── listPages ───────────────────────────────────────────────────────────────

describe('listPages', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns array of page objects with correct fields on success', async () => {
    const pages = [
      { id: 1, path: '/home', title: 'Home', updatedAt: '2024-01-01T00:00:00Z' },
      { id: 2, path: '/about', title: 'About', updatedAt: '2024-01-02T00:00:00Z' },
    ];

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(
      gqlOk({ pages: { list: pages } })
    ));

    const result = await listPages(BASE_URL);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 1, path: '/home', title: 'Home', updatedAt: '2024-01-01T00:00:00Z' });
    expect(result[1]).toMatchObject({ id: 2, path: '/about', title: 'About', updatedAt: '2024-01-02T00:00:00Z' });
  });

  it('sends POST to ${baseUrl}/graphql with correct Content-Type', async () => {
    const mockFetch = vi.fn().mockReturnValue(gqlOk({ pages: { list: [] } }));
    vi.stubGlobal('fetch', mockFetch);

    await listPages(BASE_URL);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/graphql`);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('retries up to 3 times on network error then throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    vi.stubGlobal('fetch', mockFetch);

    // Attach rejection handler immediately to prevent unhandled rejection,
    // then advance timers to drive the retry loop to completion.
    const assertion = expect(listPages(BASE_URL)).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;
    // 1 initial attempt + 2 retries = 3 total calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('retries on HTTP 500 response and eventually throws', async () => {
    const mockFetch = vi.fn().mockReturnValue(httpError(500));
    vi.stubGlobal('fetch', mockFetch);

    const assertion = expect(listPages(BASE_URL)).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

// ─── getPageContent ──────────────────────────────────────────────────────────

describe('getPageContent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns page with id, path, title, content, updatedAt on success', async () => {
    const page = {
      id: 42,
      path: '/docs/intro',
      title: 'Introduction',
      content: '# Introduction\n\nWelcome.',
      updatedAt: '2024-03-15T10:00:00Z',
    };

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(
      gqlOk({ pages: { single: page } })
    ));

    const result = await getPageContent(BASE_URL, 42);

    expect(result).toMatchObject({
      id: 42,
      path: '/docs/intro',
      title: 'Introduction',
      content: '# Introduction\n\nWelcome.',
      updatedAt: '2024-03-15T10:00:00Z',
    });
  });

  it('throws a descriptive error when page is null (not found)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(
      gqlOk({ pages: { single: null } })
    ));

    await expect(getPageContent(BASE_URL, 999)).rejects.toThrow(/not found|999/i);
  });
});

// ─── getPageByPath ───────────────────────────────────────────────────────────

describe('getPageByPath', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns page content when path exists', async () => {
    const page = {
      id: 7,
      path: '/guides/setup',
      title: 'Setup Guide',
      content: 'Follow these steps...',
      updatedAt: '2024-02-20T08:30:00Z',
    };

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(
      gqlOk({ pages: { singleByPath: page } })
    ));

    const result = await getPageByPath(BASE_URL, '/guides/setup');

    expect(result).toMatchObject({
      id: 7,
      path: '/guides/setup',
      title: 'Setup Guide',
      content: 'Follow these steps...',
      updatedAt: '2024-02-20T08:30:00Z',
    });
  });

  it('throws a descriptive error when path is not found (null response)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(
      gqlOk({ pages: { singleByPath: null } })
    ));

    await expect(getPageByPath(BASE_URL, '/nonexistent/path')).rejects.toThrow(
      /not found|\/nonexistent\/path/i
    );
  });
});

// ─── Retry succeeds on second attempt ────────────────────────────────────────

describe('retry succeeds on second attempt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns result when fetch fails once then succeeds', async () => {
    const pages = [{ id: 1, path: '/home', title: 'Home', updatedAt: '2024-01-01T00:00:00Z' }];

    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('Transient network error'))
      .mockReturnValueOnce(gqlOk({ pages: { list: pages } }));

    vi.stubGlobal('fetch', mockFetch);

    const promise = listPages(BASE_URL);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Home');
  });
});

// ─── createPage ──────────────────────────────────────────────────────────────

describe('createPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('creates page successfully and returns responseResult and page data', async () => {
    const pageData = {
      title: 'Test Page',
      path: '/test-page',
      content: '# Test\n\nThis is a test page.',
      description: 'A test page',
      tags: ['test', 'example'],
      isPublished: true,
      isPrivate: false,
      locale: 'en',
      editor: 'markdown',
    };

    const responseData = {
      pages: {
        create: {
          responseResult: {
            succeeded: true,
            errorCode: 0,
            slug: 'test-page',
            message: 'Page created successfully',
          },
          page: {
            id: 42,
            path: '/test-page',
            title: 'Test Page',
            description: 'A test page',
            isPublished: true,
            isPrivate: false,
            tags: [
              { id: 1, tag: 'test', title: 'Test' },
              { id: 2, tag: 'example', title: 'Example' },
            ],
            content: '# Test\n\nThis is a test page.',
            updatedAt: '2024-03-15T10:00:00Z',
          },
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(gqlOk(responseData)));

    const { createPage } = await import('./wiki-client.js');
    const result = await createPage(BASE_URL, 'test-token', pageData);

    expect(result.responseResult.succeeded).toBe(true);
    expect(result.page.id).toBe(42);
    expect(result.page.path).toBe('/test-page');
    expect(result.page.title).toBe('Test Page');
  });

  it('sends POST with Authorization header containing JWT token', async () => {
    const mockFetch = vi.fn().mockReturnValue(
      gqlOk({
        pages: {
          create: {
            responseResult: { succeeded: true, errorCode: 0, message: 'OK' },
            page: { id: 1, path: '/test', title: 'Test' },
          },
        },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const { createPage } = await import('./wiki-client.js');
    await createPage(BASE_URL, 'my-jwt-token', {
      title: 'Test',
      path: '/test',
      content: 'Content',
      editor: 'markdown',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer my-jwt-token');
  });

  it('returns error when page already exists (error code 2001)', async () => {
    const responseData = {
      pages: {
        create: {
          responseResult: {
            succeeded: false,
            errorCode: 2001,
            message: 'A page already exists at this path',
          },
          page: null,
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(gqlOk(responseData)));

    const { createPage } = await import('./wiki-client.js');
    const result = await createPage(BASE_URL, 'test-token', {
      title: 'Duplicate',
      path: '/duplicate',
      content: 'Content',
      editor: 'markdown',
    });

    expect(result.responseResult.succeeded).toBe(false);
    expect(result.responseResult.errorCode).toBe(2001);
  });

  it('retries on network error and eventually throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    vi.stubGlobal('fetch', mockFetch);

    const { createPage } = await import('./wiki-client.js');
    const assertion = expect(
      createPage(BASE_URL, 'test-token', {
        title: 'Test',
        path: '/test',
        content: 'Content',
        editor: 'markdown',
      })
    ).rejects.toThrow();

    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('includes all required GraphQL mutation variables', async () => {
    const mockFetch = vi.fn().mockReturnValue(
      gqlOk({
        pages: {
          create: {
            responseResult: { succeeded: true, errorCode: 0, message: 'OK' },
            page: { id: 1, path: '/test', title: 'Test' },
          },
        },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const { createPage } = await import('./wiki-client.js');
    await createPage(BASE_URL, 'test-token', {
      title: 'Test Page',
      path: '/test-page',
      content: 'Test content',
      description: 'Test description',
      tags: ['tag1', 'tag2'],
      isPublished: true,
      isPrivate: false,
      locale: 'en',
      editor: 'markdown',
    });

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body.variables).toMatchObject({
      title: 'Test Page',
      path: '/test-page',
      content: 'Test content',
      description: 'Test description',
      tags: ['tag1', 'tag2'],
      isPublished: true,
      isPrivate: false,
      locale: 'en',
      editor: 'markdown',
    });
  });
});

// ─── updatePage ──────────────────────────────────────────────────────────────

describe('updatePage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('updates page successfully and returns responseResult and page data', async () => {
    const responseData = {
      pages: {
        update: {
          responseResult: {
            succeeded: true,
            errorCode: 0,
            slug: 'test-page',
            message: 'Page updated successfully',
          },
          page: {
            id: 42,
            path: '/test-page',
            title: 'Updated Title',
            description: 'Updated description',
            isPublished: true,
            isPrivate: false,
            tags: [{ id: 1, tag: 'updated', title: 'Updated' }],
            content: 'Updated content',
            updatedAt: '2024-03-15T11:00:00Z',
          },
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(gqlOk(responseData)));

    const { updatePage } = await import('./wiki-client.js');
    const result = await updatePage(BASE_URL, 'test-token', 42, {
      title: 'Updated Title',
      content: 'Updated content',
      description: 'Updated description',
      tags: ['updated'],
    });

    expect(result.responseResult.succeeded).toBe(true);
    expect(result.page.id).toBe(42);
    expect(result.page.title).toBe('Updated Title');
    expect(result.page.content).toBe('Updated content');
  });

  it('sends POST with Authorization header containing JWT token', async () => {
    const mockFetch = vi.fn().mockReturnValue(
      gqlOk({
        pages: {
          update: {
            responseResult: { succeeded: true, errorCode: 0, message: 'OK' },
            page: { id: 42, path: '/test', title: 'Test', updatedAt: '2024-03-15T11:00:00Z' },
          },
        },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const { updatePage } = await import('./wiki-client.js');
    await updatePage(BASE_URL, 'my-jwt-token', 42, { content: 'New content' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer my-jwt-token');
  });

  it('supports partial updates with only specified fields', async () => {
    const mockFetch = vi.fn().mockReturnValue(
      gqlOk({
        pages: {
          update: {
            responseResult: { succeeded: true, errorCode: 0, message: 'OK' },
            page: { id: 42, path: '/test', title: 'Test', updatedAt: '2024-03-15T11:00:00Z' },
          },
        },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const { updatePage } = await import('./wiki-client.js');
    await updatePage(BASE_URL, 'test-token', 42, { content: 'Only content updated' });

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body.variables.id).toBe(42);
    expect(body.variables.content).toBe('Only content updated');
    expect(body.variables.title).toBeUndefined();
    expect(body.variables.description).toBeUndefined();
  });

  it('returns error when page not found (error code 2002)', async () => {
    const responseData = {
      pages: {
        update: {
          responseResult: {
            succeeded: false,
            errorCode: 2002,
            message: 'Page not found',
          },
          page: null,
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(gqlOk(responseData)));

    const { updatePage } = await import('./wiki-client.js');
    const result = await updatePage(BASE_URL, 'test-token', 999, { content: 'New content' });

    expect(result.responseResult.succeeded).toBe(false);
    expect(result.responseResult.errorCode).toBe(2002);
  });

  it('retries on network error and eventually throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    vi.stubGlobal('fetch', mockFetch);

    const { updatePage } = await import('./wiki-client.js');
    const assertion = expect(
      updatePage(BASE_URL, 'test-token', 42, { content: 'New content' })
    ).rejects.toThrow();

    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
// ─── deletePage ──────────────────────────────────────────────────────────────

describe('deletePage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('deletes page successfully and returns responseResult', async () => {
    const responseData = {
      pages: {
        delete: {
          responseResult: {
            succeeded: true,
            errorCode: 0,
            slug: 'test-page',
            message: 'Page deleted successfully',
          },
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(gqlOk(responseData)));

    const { deletePage } = await import('./wiki-client.js');
    const result = await deletePage(BASE_URL, 'test-token', 42);

    expect(result.responseResult.succeeded).toBe(true);
    expect(result.responseResult.message).toBe('Page deleted successfully');
  });

  it('sends POST with Authorization header containing JWT token', async () => {
    const mockFetch = vi.fn().mockReturnValue(
      gqlOk({
        pages: {
          delete: {
            responseResult: { succeeded: true, errorCode: 0, message: 'OK' },
          },
        },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const { deletePage } = await import('./wiki-client.js');
    await deletePage(BASE_URL, 'my-jwt-token', 42);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer my-jwt-token');
  });

  it('returns error when page not found (error code 2002)', async () => {
    const responseData = {
      pages: {
        delete: {
          responseResult: {
            succeeded: false,
            errorCode: 2002,
            message: 'Page not found',
          },
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(gqlOk(responseData)));

    const { deletePage } = await import('./wiki-client.js');
    const result = await deletePage(BASE_URL, 'test-token', 999);

    expect(result.responseResult.succeeded).toBe(false);
    expect(result.responseResult.errorCode).toBe(2002);
  });

  it('retries on network error and eventually throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    vi.stubGlobal('fetch', mockFetch);

    const { deletePage } = await import('./wiki-client.js');
    const assertion = expect(
      deletePage(BASE_URL, 'test-token', 42)
    ).rejects.toThrow();

    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('sends correct GraphQL mutation with page_id variable', async () => {
    const mockFetch = vi.fn().mockReturnValue(
      gqlOk({
        pages: {
          delete: {
            responseResult: { succeeded: true, errorCode: 0, message: 'OK' },
          },
        },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const { deletePage } = await import('./wiki-client.js');
    await deletePage(BASE_URL, 'test-token', 42);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body.query).toContain('mutation DeletePage');
    expect(body.query).toContain('delete(id: $id)');
    expect(body.variables).toEqual({ id: 42 });
  });
});

// ─── movePage ────────────────────────────────────────────────────────────────

describe('movePage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('moves page successfully and returns responseResult', async () => {
    const responseData = {
      pages: {
        move: {
          responseResult: {
            succeeded: true,
            errorCode: 0,
            slug: 'new-path',
            message: 'Page moved successfully',
          },
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(gqlOk(responseData)));

    const { movePage } = await import('./wiki-client.js');
    const result = await movePage(BASE_URL, 'test-token', 42, '/new-path', 'en');

    expect(result.responseResult.succeeded).toBe(true);
    expect(result.responseResult.message).toBe('Page moved successfully');
  });

  it('sends POST with Authorization header containing JWT token', async () => {
    const mockFetch = vi.fn().mockReturnValue(
      gqlOk({
        pages: {
          move: {
            responseResult: { succeeded: true, errorCode: 0, message: 'OK' },
          },
        },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const { movePage } = await import('./wiki-client.js');
    await movePage(BASE_URL, 'my-jwt-token', 42, '/new-path');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer my-jwt-token');
  });

  it('returns error when page not found (error code 2002)', async () => {
    const responseData = {
      pages: {
        move: {
          responseResult: {
            succeeded: false,
            errorCode: 2002,
            message: 'Page not found',
          },
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(gqlOk(responseData)));

    const { movePage } = await import('./wiki-client.js');
    const result = await movePage(BASE_URL, 'test-token', 999, '/new-path');

    expect(result.responseResult.succeeded).toBe(false);
    expect(result.responseResult.errorCode).toBe(2002);
  });

  it('returns error when destination path already exists (error code 2001)', async () => {
    const responseData = {
      pages: {
        move: {
          responseResult: {
            succeeded: false,
            errorCode: 2001,
            message: 'A page already exists at the destination path',
          },
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(gqlOk(responseData)));

    const { movePage } = await import('./wiki-client.js');
    const result = await movePage(BASE_URL, 'test-token', 42, '/existing-path');

    expect(result.responseResult.succeeded).toBe(false);
    expect(result.responseResult.errorCode).toBe(2001);
  });

  it('retries on network error and eventually throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    vi.stubGlobal('fetch', mockFetch);

    const { movePage } = await import('./wiki-client.js');
    const assertion = expect(
      movePage(BASE_URL, 'test-token', 42, '/new-path')
    ).rejects.toThrow();

    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('sends correct GraphQL mutation with all required variables', async () => {
    const mockFetch = vi.fn().mockReturnValue(
      gqlOk({
        pages: {
          move: {
            responseResult: { succeeded: true, errorCode: 0, message: 'OK' },
          },
        },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const { movePage } = await import('./wiki-client.js');
    await movePage(BASE_URL, 'test-token', 42, '/new-path', 'fr');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body.query).toContain('mutation MovePage');
    expect(body.query).toContain('move(id: $id, destinationPath: $destinationPath, destinationLocale: $destinationLocale)');
    expect(body.variables).toEqual({ 
      id: 42, 
      destinationPath: '/new-path',
      destinationLocale: 'fr'
    });
  });

  it('defaults to locale "en" when not specified', async () => {
    const mockFetch = vi.fn().mockReturnValue(
      gqlOk({
        pages: {
          move: {
            responseResult: { succeeded: true, errorCode: 0, message: 'OK' },
          },
        },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const { movePage } = await import('./wiki-client.js');
    await movePage(BASE_URL, 'test-token', 42, '/new-path');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body.variables.destinationLocale).toBe('en');
  });
});
