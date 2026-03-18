# Wiki.js GraphQL API Documentation

## Overview

Wiki.js exposes a comprehensive GraphQL API for managing wiki content, users, authentication, and more. This document focuses on the pages API used for CRUD operations on wiki pages.

**Endpoint:** `http://<wiki-host>:3000/graphql`  
**Protocol:** GraphQL over HTTP POST  
**Content-Type:** `application/json`

## Authentication

Most mutations require authentication via JWT token.

### Obtaining a JWT Token

**Mutation:**

```graphql
mutation Login($username: String!, $password: String!) {
  authentication {
    login(username: $username, password: $password, strategy: "local") {
      responseResult {
        succeeded
        message
      }
      jwt
    }
  }
}
```

**Variables:**

```json
{
  "username": "admin@wiki.local",
  "password": "ChangeMe123!"
}
```

**Response:**

```json
{
  "data": {
    "authentication": {
      "login": {
        "responseResult": {
          "succeeded": true,
          "message": "Login successful"
        },
        "jwt": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
      }
    }
  }
}
```

### Using the JWT Token

Include the token in the `Authorization` header for authenticated requests:

```bash
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt-token>" \
  -d '{"query": "..."}'
```

## Pages API

### Queries

#### List All Pages

Retrieve a list of all pages with basic metadata.

**Query:**

```graphql
query ListPages {
  pages {
    list(orderBy: UPDATED, orderByDirection: DESC) {
      id
      path
      title
      description
      isPublished
      isPrivate
      locale
      createdAt
      updatedAt
    }
  }
}
```

**Response:**

```json
{
  "data": {
    "pages": {
      "list": [
        {
          "id": 1,
          "path": "/home",
          "title": "Home",
          "description": "Welcome page",
          "isPublished": true,
          "isPrivate": false,
          "locale": "en",
          "createdAt": "2026-03-01T10:00:00Z",
          "updatedAt": "2026-03-10T14:30:00Z"
        }
      ]
    }
  }
}
```

#### Get Single Page by ID

Retrieve full page content by page ID.

**Query:**

```graphql
query GetPage($id: Int!) {
  pages {
    single(id: $id) {
      id
      path
      title
      description
      content
      contentType
      isPublished
      isPrivate
      locale
      tags {
        id
        tag
      }
      createdAt
      updatedAt
    }
  }
}
```

**Variables:**

```json
{
  "id": 42
}
```

**Response:**

```json
{
  "data": {
    "pages": {
      "single": {
        "id": 42,
        "path": "/admin/authentication",
        "title": "Authentication Setup",
        "description": "Guide to configuring authentication",
        "content": "# Authentication Setup\n\nThis guide covers...",
        "contentType": "markdown",
        "isPublished": true,
        "isPrivate": false,
        "locale": "en",
        "tags": [
          {"id": 1, "tag": "admin"},
          {"id": 5, "tag": "security"}
        ],
        "createdAt": "2026-03-01T10:00:00Z",
        "updatedAt": "2026-03-10T14:30:00Z"
      }
    }
  }
}
```

#### Get Single Page by Path

Retrieve full page content by path and locale.

**Query:**

```graphql
query GetPageByPath($path: String!, $locale: String!) {
  pages {
    singleByPath(path: $path, locale: $locale) {
      id
      path
      title
      description
      content
      contentType
      isPublished
      isPrivate
      locale
      tags {
        id
        tag
      }
      createdAt
      updatedAt
    }
  }
}
```

**Variables:**

```json
{
  "path": "/admin/authentication",
  "locale": "en"
}
```

**Response:** Same structure as `single` query above.

#### Search Pages

Search pages by title or content.

**Query:**

```graphql
query SearchPages($query: String!) {
  pages {
    search(query: $query) {
      results {
        id
        title
        path
        description
        locale
      }
      totalHits
    }
  }
}
```

**Variables:**

```json
{
  "query": "authentication"
}
```

**Response:**

```json
{
  "data": {
    "pages": {
      "search": {
        "results": [
          {
            "id": 42,
            "title": "Authentication Setup",
            "path": "/admin/authentication",
            "description": "Guide to configuring authentication",
            "locale": "en"
          }
        ],
        "totalHits": 1
      }
    }
  }
}
```

### Mutations

All mutations require authentication (JWT token in Authorization header).

#### Create Page

Create a new wiki page.

**Mutation:**

```graphql
mutation CreatePage(
  $content: String!
  $description: String!
  $editor: String!
  $isPublished: Boolean!
  $isPrivate: Boolean!
  $locale: String!
  $path: String!
  $tags: [String]!
  $title: String!
) {
  pages {
    create(
      content: $content
      description: $description
      editor: $editor
      isPublished: $isPublished
      isPrivate: $isPrivate
      locale: $locale
      path: $path
      tags: $tags
      title: $title
    ) {
      responseResult {
        succeeded
        errorCode
        slug
        message
      }
      page {
        id
        path
        title
      }
    }
  }
}
```

**Variables:**

```json
{
  "content": "# Getting Started\n\nWelcome to our wiki!",
  "description": "Introduction guide for new users",
  "editor": "markdown",
  "isPublished": true,
  "isPrivate": false,
  "locale": "en",
  "path": "/getting-started",
  "tags": ["tutorial", "beginner"],
  "title": "Getting Started"
}
```

**Editor Options:**
- `markdown` - Markdown editor
- `code` - Code editor
- `wysiwyg` - Visual editor

**Response (Success):**

```json
{
  "data": {
    "pages": {
      "create": {
        "responseResult": {
          "succeeded": true,
          "errorCode": 0,
          "slug": "getting-started",
          "message": "Page created successfully"
        },
        "page": {
          "id": 43,
          "path": "/getting-started",
          "title": "Getting Started"
        }
      }
    }
  }
}
```

**Response (Error):**

```json
{
  "data": {
    "pages": {
      "create": {
        "responseResult": {
          "succeeded": false,
          "errorCode": 2001,
          "slug": null,
          "message": "A page already exists at this path"
        },
        "page": null
      }
    }
  }
}
```

#### Update Page

Update an existing page's content or metadata.

**Mutation:**

```graphql
mutation UpdatePage(
  $id: Int!
  $content: String
  $description: String
  $editor: String
  $isPublished: Boolean
  $isPrivate: Boolean
  $locale: String
  $path: String
  $tags: [String]
  $title: String
) {
  pages {
    update(
      id: $id
      content: $content
      description: $description
      editor: $editor
      isPublished: $isPublished
      isPrivate: $isPrivate
      locale: $locale
      path: $path
      tags: $tags
      title: $title
    ) {
      responseResult {
        succeeded
        errorCode
        slug
        message
      }
      page {
        id
        path
        title
        updatedAt
      }
    }
  }
}
```

**Variables (partial update):**

```json
{
  "id": 43,
  "content": "# Getting Started\n\nUpdated content with more details...",
  "description": "Updated introduction guide"
}
```

**Response:**

```json
{
  "data": {
    "pages": {
      "update": {
        "responseResult": {
          "succeeded": true,
          "errorCode": 0,
          "slug": "getting-started",
          "message": "Page updated successfully"
        },
        "page": {
          "id": 43,
          "path": "/getting-started",
          "title": "Getting Started",
          "updatedAt": "2026-03-11T10:15:00Z"
        }
      }
    }
  }
}
```

#### Delete Page

Delete a page permanently.

**Mutation:**

```graphql
mutation DeletePage($id: Int!) {
  pages {
    delete(id: $id) {
      responseResult {
        succeeded
        errorCode
        message
      }
    }
  }
}
```

**Variables:**

```json
{
  "id": 43
}
```

**Response:**

```json
{
  "data": {
    "pages": {
      "delete": {
        "responseResult": {
          "succeeded": true,
          "errorCode": 0,
          "message": "Page deleted successfully"
        }
      }
    }
  }
}
```

#### Move/Rename Page

Move a page to a new path or rename it.

**Mutation:**

```graphql
mutation MovePage(
  $id: Int!
  $destinationPath: String!
  $destinationLocale: String!
) {
  pages {
    move(
      id: $id
      destinationPath: $destinationPath
      destinationLocale: $destinationLocale
    ) {
      responseResult {
        succeeded
        errorCode
        message
      }
    }
  }
}
```

**Variables:**

```json
{
  "id": 43,
  "destinationPath": "/guides/getting-started",
  "destinationLocale": "en"
}
```

**Response:**

```json
{
  "data": {
    "pages": {
      "move": {
        "responseResult": {
          "succeeded": true,
          "errorCode": 0,
          "message": "Page moved successfully"
        }
      }
    }
  }
}
```

## Response Result Codes

Common error codes returned in `responseResult.errorCode`:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2001 | Page already exists at path |
| 2002 | Page not found |
| 2003 | Invalid page path |
| 2004 | Insufficient permissions |
| 2005 | Invalid editor type |
| 3001 | Authentication required |
| 3002 | Invalid credentials |

## Complete Example: Create and Update Page

### Step 1: Authenticate

```bash
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation($u:String!,$p:String!){authentication{login(username:$u,password:$p,strategy:\"local\"){responseResult{succeeded}jwt}}}",
    "variables": {"u": "admin@wiki.local", "p": "ChangeMe123!"}
  }'
```

Extract JWT from response: `jq -r '.data.authentication.login.jwt'`

### Step 2: Create Page

```bash
TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "query": "mutation($content:String!,$description:String!,$editor:String!,$isPublished:Boolean!,$isPrivate:Boolean!,$locale:String!,$path:String!,$tags:[String]!,$title:String!){pages{create(content:$content,description:$description,editor:$editor,isPublished:$isPublished,isPrivate:$isPrivate,locale:$locale,path:$path,tags:$tags,title:$title){responseResult{succeeded,errorCode,message}page{id,path,title}}}}",
    "variables": {
      "content": "# API Documentation\n\nThis page describes our API.",
      "description": "API reference guide",
      "editor": "markdown",
      "isPublished": true,
      "isPrivate": false,
      "locale": "en",
      "path": "/api-docs",
      "tags": ["api", "documentation"],
      "title": "API Documentation"
    }
  }'
```

### Step 3: Update Page

```bash
PAGE_ID=44  # From create response

curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "query": "mutation($id:Int!,$content:String){pages{update(id:$id,content:$content){responseResult{succeeded,message}page{id,updatedAt}}}}",
    "variables": {
      "id": '$PAGE_ID',
      "content": "# API Documentation\n\nUpdated content with examples..."
    }
  }'
```

## GraphQL Playground

Wiki.js includes GraphQL Playground for interactive API exploration:

**URL:** `http://<wiki-host>:3000/graphql`

Open in browser to:
- Explore schema documentation
- Test queries and mutations interactively
- View auto-complete suggestions
- See real-time validation

## Write Mutations Summary

Quick reference for all write mutations:

| Mutation | Purpose | Required Parameters | Returns |
|----------|---------|---------------------|---------|
| `pages.create` | Create new page | `content`, `title`, `path`, `editor`, `locale`, `isPublished`, `isPrivate` | `page.id`, `responseResult` |
| `pages.update` | Update existing page | `id` + at least one field to update | `page.id`, `page.updatedAt`, `responseResult` |
| `pages.delete` | Delete page | `id` | `responseResult` |
| `pages.move` | Move/rename page | `id`, `destinationPath`, `destinationLocale` | `responseResult` |

## Best Practices

1. **Always check `responseResult.succeeded`** before assuming success
2. **Use variables** instead of inline values for security
3. **Request only needed fields** to minimize response size
4. **Handle authentication errors** gracefully (token expiration)
5. **Validate paths** before creating pages (no spaces, special chars)
6. **Use tags consistently** for better organization
7. **Set appropriate `isPrivate`** flag for sensitive content
8. **Test mutations in development** before using in production
9. **Implement retry logic** for transient failures
10. **Log all write operations** for audit trail

## Limitations

1. **No bulk operations** - Must create/update/delete pages individually
2. **No transaction support** - Each mutation is independent
3. **Rate limiting** - May apply depending on Wiki.js configuration
4. **File uploads** - Requires separate assets API (not covered here)
5. **Page history** - Read-only via separate API
6. **No undo/trash** - Deletions are permanent
7. **Path conflicts** - Cannot create/move to existing path
8. **Locale restrictions** - Must specify valid locale code

## Error Handling for Write Operations

Common error codes and solutions:

| Error Code | Mutation | Cause | Solution |
|------------|----------|-------|----------|
| 2001 | create | Page already exists at path | Use different path or update existing page |
| 2002 | update, delete, move | Page not found | Verify page ID exists |
| 2003 | create, move | Invalid page path | Use valid path format (starts with `/`, no spaces) |
| 2004 | All | Insufficient permissions | Verify JWT token has admin privileges |
| 2005 | create, update | Invalid editor type | Use `markdown`, `code`, or `wysiwyg` |
| 3001 | All | Authentication required | Include valid JWT in Authorization header |
| 3002 | All | Invalid credentials | Regenerate JWT token |

## Performance Considerations for Write Operations

**Create Page**:
- Typical latency: 200-500ms
- Includes content validation and indexing
- Large pages (>100KB) may take longer

**Update Page**:
- Typical latency: 150-400ms
- Partial updates faster than full updates
- Triggers re-indexing in Wiki.js

**Delete Page**:
- Typical latency: 100-300ms
- Fastest write operation
- Cascades to related data (tags, links)

**Move Page**:
- Typical latency: 200-500ms
- Updates all internal links
- May trigger re-indexing

**Recommendations**:
1. Batch operations with delays to avoid rate limiting
2. Use partial updates when possible
3. Implement exponential backoff for retries
4. Monitor response times and adjust accordingly

## Integration with REST API Gateway

The Wiki REST API Gateway uses this GraphQL API internally for all operations:

- **Sync Pipeline**: `pages.list` to detect new/updated pages for embedding generation
- **Content Retrieval**: `pages.single` and `pages.singleByPath` for full content
- **Write Operations** (when `API_KEY_RW` is configured):
  - `POST /api/pages` → `pages.create` mutation
  - `PUT /api/pages/:id` → `pages.update` mutation
  - `DELETE /api/pages/:id` → `pages.delete` mutation
  - `POST /api/pages/:id/move` → `pages.move` mutation

External clients do not interact with the GraphQL API directly — they use the REST API gateway on port 3001. The GraphQL API on port 3000 is pod-internal only.

See [API.md](./API.md) for REST API endpoint documentation.

## Additional Resources

- [Wiki.js Official Documentation](https://docs.requarks.io/)
- [GraphQL Playground](http://localhost:3000/graphql) (accessible within the pod or on the host — not exposed externally)
- [GraphQL Specification](https://graphql.org/learn/)
- [Wiki.js GitHub Repository](https://github.com/requarks/wiki)
- [REST API Gateway Reference](./API.md) — the client-facing API that wraps this GraphQL API

## Testing the API

The GraphQL API is used internally by the gateway and the smoke test script:

```bash
# Obtain admin token
eval $(./scripts/deploy-wikijs.sh get-token)

# Run smoke test (creates test page via GraphQL, verifies gateway search, cleans up)
./scripts/smoke-test-wikijs.sh <instance-ip>
```

For day-to-day usage, interact with the REST API gateway instead of GraphQL directly. See [TESTING.md](./TESTING.md) for the full testing guide.
