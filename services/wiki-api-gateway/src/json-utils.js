/**
 * JSON utility functions for the MCP server.
 *
 * Provides descriptive JSON parsing with location information
 * (line and column numbers) when parsing fails.
 */

/**
 * Parse a JSON string safely, returning a descriptive error with
 * parse failure location (line and column number) on failure.
 *
 * @param {string} jsonString - The JSON string to parse
 * @returns {{ value: any, error: null } | { value: null, error: { message: string, line: number|null, column: number|null } }}
 */
export function parseJsonSafely(jsonString) {
  try {
    const value = JSON.parse(jsonString);
    return { value, error: null };
  } catch (err) {
    const location = extractParseErrorLocation(err.message, jsonString);
    return {
      value: null,
      error: {
        message: buildDescriptiveMessage(err.message, location),
        line: location.line,
        column: location.column,
      },
    };
  }
}

/**
 * Extract line and column from a JSON.parse error message and the
 * original input string.
 *
 * Different JS engines format the error differently:
 *   - V8:  "Unexpected token 'x', ..."  (no position in message)
 *          but the SyntaxError has no standard position property.
 *   - We fall back to scanning the string ourselves when the engine
 *     does not embed position info.
 *
 * @param {string} errorMessage
 * @param {string} input
 * @returns {{ line: number|null, column: number|null }}
 */
function extractParseErrorLocation(errorMessage, input) {
  // Some engines (e.g. older V8) embed "at position N" in the message.
  const posMatch = errorMessage.match(/at position (\d+)/i);
  if (posMatch) {
    const pos = parseInt(posMatch[1], 10);
    return positionToLineCol(input, pos);
  }

  // Node 20+ V8 embeds "(line N, column N)" in the message.
  const lineColMatch = errorMessage.match(/\(line (\d+), column (\d+)\)/i);
  if (lineColMatch) {
    return {
      line: parseInt(lineColMatch[1], 10),
      column: parseInt(lineColMatch[2], 10),
    };
  }

  // Fallback: try to find the first invalid character ourselves.
  const firstBadPos = findFirstInvalidPosition(input);
  if (firstBadPos !== null) {
    return positionToLineCol(input, firstBadPos);
  }

  return { line: null, column: null };
}

/**
 * Convert a flat character offset into 1-based line/column numbers.
 *
 * @param {string} input
 * @param {number} offset
 * @returns {{ line: number, column: number }}
 */
function positionToLineCol(input, offset) {
  const before = input.slice(0, offset);
  const lines = before.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

/**
 * Attempt to locate the first character position that makes the JSON
 * invalid by scanning for common structural problems.
 *
 * Returns null when no heuristic applies.
 *
 * @param {string} input
 * @returns {number|null}
 */
function findFirstInvalidPosition(input) {
  if (typeof input !== 'string' || input.length === 0) return 0;

  // Walk through looking for unmatched braces / truncation
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth < 0) return i;
    }
  }

  // Truncated input (depth > 0 or still inside a string)
  if (depth > 0 || inString) return input.length;

  return null;
}

/**
 * Build a human-readable error message that includes location info
 * when available.
 *
 * @param {string} originalMessage
 * @param {{ line: number|null, column: number|null }} location
 * @returns {string}
 */
function buildDescriptiveMessage(originalMessage, location) {
  if (location.line !== null && location.column !== null) {
    return `JSON parse error at line ${location.line}, column ${location.column}: ${originalMessage}`;
  }
  return `JSON parse error: ${originalMessage}`;
}
