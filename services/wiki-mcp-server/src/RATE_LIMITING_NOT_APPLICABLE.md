# Rate Limiting - Not Applicable to Stdio-Based MCP Server

## Overview

This document explains why rate limiting properties (53-56) and requirements (24.1-24.5) are not applicable to the current MCP server architecture.

## Architecture Context

The Wiki.js MCP server uses **stdio-based communication** via `StdioServerTransport` from the MCP SDK:

```javascript
// From src/index.js
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const transport = new StdioServerTransport();
await server.connect(transport);
```

This means:
- Communication happens over standard input/output streams
- No HTTP protocol is involved
- No HTTP status codes (200, 429, 503, etc.)
- No HTTP headers (Retry-After, etc.)
- Direct process-to-process communication

## Why Rate Limiting Requirements Are Not Applicable

### Requirement 24.1: Rate Limiting Implementation
**Requirement:** "THE MCP_Server SHALL implement rate limiting for all API endpoints"

**Why Not Applicable:** There are no HTTP API endpoints. The MCP server exposes tools through the MCP protocol over stdio, not REST/HTTP endpoints.

### Requirement 24.2: Configurable Rate Limits
**Requirement:** "THE MCP_Server SHALL support configurable rate limits via environment variables"

**Why Not Applicable:** Without HTTP endpoints, there's no request/response cycle to apply rate limits to.

### Requirement 24.3: HTTP 429 Status Code
**Requirement:** "THE MCP_Server SHALL return HTTP 429 when rate limits are exceeded"

**Why Not Applicable:** HTTP status codes don't exist in stdio-based communication. The MCP protocol uses JSON-RPC style messages.

### Requirement 24.4: Retry-After Headers
**Requirement:** "THE MCP_Server SHALL include retry-after headers in rate limit responses"

**Why Not Applicable:** HTTP headers don't exist in stdio-based communication.

### Requirement 24.5: Rate Limit Violation Logging
**Requirement:** "THE MCP_Server SHALL log rate limit violations"

**Why Not Applicable:** Without rate limiting implementation, there are no violations to log.

## Properties Not Applicable

### Property 53: Rate limiting enforcement
*For any API endpoint, when the number of requests from a client exceeds the configured rate limit within the time window, subsequent requests should receive HTTP 429 responses.*

**Not Applicable:** No HTTP endpoints, no HTTP 429 responses.

### Property 54: Configurable rate limits
*For any valid rate limit value specified in environment variables, the MCP server should enforce that rate limit.*

**Not Applicable:** No rate limiting mechanism exists in stdio-based architecture.

### Property 55: Retry-after header inclusion
*For any rate limit response (HTTP 429), the response should include a Retry-After header indicating when the client can retry.*

**Not Applicable:** No HTTP headers in stdio-based communication.

### Property 56: Rate limit violation logging
*For any rate limit violation, a log entry should be created with the client identifier, endpoint, and timestamp.*

**Not Applicable:** No rate limiting violations occur.

## Alternative Approaches for Stdio-Based MCP Servers

If rate limiting were desired for stdio-based MCP servers, alternative approaches would be needed:

### 1. Client-Side Rate Limiting
The MCP client (Kiro, Claude Desktop, etc.) could implement rate limiting on their side before sending requests.

**Pros:**
- Prevents overwhelming the server
- Client has full control over request timing

**Cons:**
- Requires client cooperation
- No server-side enforcement
- Different clients may have different limits

### 2. Tool-Level Throttling
Implement delays or queuing within individual tool implementations:

```javascript
// Example: Add delay to expensive operations
server.tool('search_wiki', schema, async (params) => {
  await rateLimitDelay(); // Custom delay function
  return await searchWiki(dbClient, wikiBaseUrl, params);
});
```

**Pros:**
- Server-side control
- Can protect expensive operations

**Cons:**
- Blocks the entire process (single-threaded Node.js)
- No per-client tracking
- Affects all clients equally

### 3. Process-Level Resource Limits
Use OS-level resource limits (CPU, memory) to prevent abuse:

```bash
# Example: systemd service limits
[Service]
CPUQuota=50%
MemoryMax=512M
```

**Pros:**
- Protects system resources
- Works regardless of protocol

**Cons:**
- Coarse-grained control
- Doesn't distinguish between legitimate and abusive usage

### 4. Wrapper Service with HTTP Endpoints
Add an HTTP API layer that wraps the stdio-based MCP server:

```
Client → HTTP API (with rate limiting) → MCP Server (stdio)
```

**Pros:**
- Traditional HTTP rate limiting applies
- Can use standard middleware (express-rate-limit, etc.)
- Per-client tracking via IP/API keys

**Cons:**
- Adds complexity and latency
- Requires maintaining two communication layers
- Defeats the purpose of stdio-based simplicity

## Future Considerations

If the MCP server architecture changes to support HTTP endpoints (e.g., via `HttpServerTransport`), rate limiting requirements would become applicable:

1. **Add HTTP Transport:**
   ```javascript
   import { HttpServerTransport } from '@modelcontextprotocol/sdk/server/http.js';
   
   const transport = new HttpServerTransport({
     port: 3001,
     rateLimit: {
       windowMs: 60000,
       max: 100
     }
   });
   ```

2. **Implement Rate Limiting Middleware:**
   - Use libraries like `express-rate-limit`
   - Track requests per client (IP address or API key)
   - Return HTTP 429 with Retry-After headers

3. **Add Configuration:**
   ```bash
   # .env
   RATE_LIMIT_WINDOW_MS=60000
   RATE_LIMIT_MAX_REQUESTS=100
   ```

4. **Implement Logging:**
   ```javascript
   rateLimiter.on('limit', (req) => {
     console.warn('[RATE_LIMIT] Client exceeded limit:', {
       client: req.ip,
       endpoint: req.path,
       timestamp: new Date().toISOString()
     });
   });
   ```

## Conclusion

Rate limiting requirements (24.1-24.5) and properties (53-56) are **not applicable** to the current stdio-based MCP server architecture. These requirements assume HTTP-based communication with endpoints, status codes, and headers that don't exist in the stdio transport model.

If rate limiting becomes necessary in the future, the architecture would need to:
1. Switch to HTTP-based transport, OR
2. Implement alternative rate limiting approaches suitable for stdio-based communication

For now, these optional tasks (12.4-12.7) are correctly marked as not applicable to the current implementation.

## References

- **MCP SDK Documentation:** https://github.com/modelcontextprotocol/sdk
- **StdioServerTransport:** Used for process-to-process communication
- **HttpServerTransport:** Alternative transport for HTTP-based communication (not currently used)
- **Requirements 24.1-24.5:** Rate limiting requirements in requirements.md
- **Properties 53-56:** Rate limiting properties in design.md
- **Tasks 12.4-12.7:** Optional property test tasks in tasks.md
