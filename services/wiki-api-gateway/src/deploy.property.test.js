/**
 * Property-based test for pod port mapping.
 *
 * Feature: wiki-rest-api-gateway, Property 15: GraphQL not exposed to host
 * **Validates: Requirements 14.5, 16.2**
 *
 * The Podman pod port mapping shall include only port 3001 (gateway).
 * Port 3000 (Wiki.js GraphQL) and port 5432 (PostgreSQL) shall not appear
 * in the pod's published port list.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEPLOY_SCRIPT = resolve(__dirname, '../../../scripts/deploy-wikijs.sh');

describe('Property 15: GraphQL not exposed to host', () => {
  const script = readFileSync(DEPLOY_SCRIPT, 'utf-8');

  // Extract the podman pod create command, which may span multiple lines via \
  // The command starts with "podman pod create" and ends at the next blank line,
  // comment line, or next podman command.
  function extractPodCreateCommand() {
    const lines = script.split('\n');
    let capturing = false;
    let cmdLines = [];

    for (const line of lines) {
      if (!capturing && line.trim().startsWith('podman pod create')) {
        capturing = true;
        cmdLines.push(line);
        if (!line.trimEnd().endsWith('\\')) {
          break;
        }
        continue;
      }
      if (capturing) {
        cmdLines.push(line);
        if (!line.trimEnd().endsWith('\\')) {
          break;
        }
      }
    }

    return cmdLines.join(' ');
  }

  it('podman pod create only publishes port 3001', () => {
    // Feature: wiki-rest-api-gateway, Property 15: GraphQL not exposed to host
    const podCreateCmd = extractPodCreateCommand();
    expect(podCreateCmd).toBeTruthy();

    // Extract all -p port mappings from the pod create command
    const portMappings = [...podCreateCmd.matchAll(/-p\s+["']?(\S+?)["']?(?:\s|$)/g)]
      .map(m => m[1]);

    // Should have at least one port mapping
    expect(portMappings.length).toBeGreaterThanOrEqual(1);

    // All port mappings should reference GATEWAY_PORT (defaults to 3001) only.
    // The script uses variable interpolation: ${GATEWAY_PORT}:${GATEWAY_PORT}
    for (const mapping of portMappings) {
      expect(mapping).toMatch(/GATEWAY_PORT|3001/);
      expect(mapping).not.toMatch(/\b3000\b/);
      expect(mapping).not.toMatch(/\b5432\b/);
    }

    // Verify GATEWAY_PORT is defined as 3001 in the script constants
    expect(script).toMatch(/GATEWAY_PORT=3001/);
  });

  it('no -p flag anywhere in the script maps Wiki.js port 3000 to the host', () => {
    // Feature: wiki-rest-api-gateway, Property 15: GraphQL not exposed to host
    const allPortFlags = [...script.matchAll(/-p\s+["']?(\S+?)["']?(?:\s|$)/g)]
      .map(m => m[1]);

    for (const mapping of allPortFlags) {
      expect(mapping).not.toMatch(/\b3000\b/);
    }
  });

  it('no -p flag anywhere in the script maps PostgreSQL port 5432 to the host', () => {
    // Feature: wiki-rest-api-gateway, Property 15: GraphQL not exposed to host
    const allPortFlags = [...script.matchAll(/-p\s+["']?(\S+?)["']?(?:\s|$)/g)]
      .map(m => m[1]);

    for (const mapping of allPortFlags) {
      expect(mapping).not.toMatch(/\b5432\b/);
    }
  });
});
