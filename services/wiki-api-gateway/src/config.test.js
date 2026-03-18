/**
 * Unit tests for configuration module.
 * 
 * Feature: wiki-rest-api-gateway
 * Task: 1.3 - Write unit tests for config.js changes
 * 
 * Validates: Requirements 9.4, 13.2, 13.3, 13.4, 13.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, validateConfig } from './config.js';

describe('Configuration Module', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * Helper: sets the minimum env vars needed for a valid config.
   */
  function setMinimalValidEnv() {
    process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
    process.env.API_KEY_RO = 'ro-key-123';
  }

  describe('loadConfig', () => {
    it('loads all fields from environment variables', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
      process.env.API_KEY_RO = 'ro-key-123';
      process.env.API_KEY_RW = 'rw-key-456';
      process.env.WIKI_ADMIN_TOKEN = 'admin-token';
      process.env.GATEWAY_PORT = '4000';
      process.env.WIKI_BASE_URL = 'http://wiki.example.com';
      process.env.PGHOST = 'db.example.com';
      process.env.PGPORT = '5433';
      process.env.PGDATABASE = 'testdb';
      process.env.PGUSER = 'testuser';
      process.env.PGPASSWORD = 'testpass';
      process.env.SYNC_INTERVAL_MS = '60000';
      process.env.EMBEDDING_MODEL = 'custom/model';
      process.env.OPENROUTER_BASE_URL = 'https://custom.api';

      const config = loadConfig();

      expect(config.apiKeyRo).toBe('ro-key-123');
      expect(config.apiKeyRw).toBe('rw-key-456');
      expect(config.wikiAdminToken).toBe('admin-token');
      expect(config.gatewayPort).toBe(4000);
      expect(config.openrouterApiKey).toBe('sk-or-test-key');
      expect(config.wikiBaseUrl).toBe('http://wiki.example.com');
      expect(config.pgHost).toBe('db.example.com');
      expect(config.pgPort).toBe(5433);
      expect(config.pgDatabase).toBe('testdb');
      expect(config.pgUser).toBe('testuser');
      expect(config.pgPassword).toBe('testpass');
      expect(config.syncIntervalMs).toBe(60000);
      expect(config.embeddingModel).toBe('custom/model');
      expect(config.openrouterBaseUrl).toBe('https://custom.api');
    });

    it('sets apiKeyRo and apiKeyRw to null when not provided', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
      process.env.API_KEY_RO = 'ro-key';
      delete process.env.API_KEY_RW;

      const config = loadConfig();

      expect(config.apiKeyRo).toBe('ro-key');
      expect(config.apiKeyRw).toBeNull();
    });
  });

  // Validates: Requirement 13.5
  describe('default values', () => {
    it('defaults GATEWAY_PORT to 3001', () => {
      setMinimalValidEnv();
      delete process.env.GATEWAY_PORT;

      const config = loadConfig();

      expect(config.gatewayPort).toBe(3001);
    });

    it('defaults WIKI_BASE_URL to http://localhost:3000', () => {
      setMinimalValidEnv();
      delete process.env.WIKI_BASE_URL;

      const config = loadConfig();

      expect(config.wikiBaseUrl).toBe('http://localhost:3000');
    });

    it('defaults SYNC_INTERVAL_MS to 300000', () => {
      setMinimalValidEnv();
      delete process.env.SYNC_INTERVAL_MS;

      const config = loadConfig();

      expect(config.syncIntervalMs).toBe(300000);
    });

    it('defaults PGHOST to localhost', () => {
      setMinimalValidEnv();
      delete process.env.PGHOST;

      const config = loadConfig();

      expect(config.pgHost).toBe('localhost');
    });

    it('defaults PGPORT to 5432', () => {
      setMinimalValidEnv();
      delete process.env.PGPORT;

      const config = loadConfig();

      expect(config.pgPort).toBe(5432);
    });

    it('defaults PGDATABASE to wiki', () => {
      setMinimalValidEnv();
      delete process.env.PGDATABASE;

      const config = loadConfig();

      expect(config.pgDatabase).toBe('wiki');
    });

    it('defaults PGUSER to wiki', () => {
      setMinimalValidEnv();
      delete process.env.PGUSER;

      const config = loadConfig();

      expect(config.pgUser).toBe('wiki');
    });

    it('defaults EMBEDDING_MODEL to openai/text-embedding-3-small', () => {
      setMinimalValidEnv();
      delete process.env.EMBEDDING_MODEL;

      const config = loadConfig();

      expect(config.embeddingModel).toBe('openai/text-embedding-3-small');
    });
  });

  describe('validateConfig', () => {
    function validConfig(overrides = {}) {
      return {
        apiKeyRo: 'ro-key',
        apiKeyRw: null,
        wikiAdminToken: undefined,
        openrouterApiKey: 'sk-or-test-key',
        gatewayPort: 3001,
        pgPort: 5432,
        syncIntervalMs: 300000,
        ...overrides,
      };
    }

    // Validates: Requirement 13.3 / 9.4
    describe('API key validation', () => {
      it('throws when neither API_KEY_RO nor API_KEY_RW is set', () => {
        const config = validConfig({ apiKeyRo: null, apiKeyRw: null });

        expect(() => validateConfig(config)).toThrow(
          'At least one of API_KEY_RO or API_KEY_RW must be configured'
        );
      });

      it('accepts config with only API_KEY_RO set', () => {
        const config = validConfig({ apiKeyRo: 'ro-key', apiKeyRw: null });

        expect(() => validateConfig(config)).not.toThrow();
      });

      it('accepts config with only API_KEY_RW set (with admin token)', () => {
        const config = validConfig({
          apiKeyRo: null,
          apiKeyRw: 'rw-key',
          wikiAdminToken: 'admin-token',
        });

        expect(() => validateConfig(config)).not.toThrow();
      });

      it('accepts config with both API keys set', () => {
        const config = validConfig({
          apiKeyRo: 'ro-key',
          apiKeyRw: 'rw-key',
          wikiAdminToken: 'admin-token',
        });

        expect(() => validateConfig(config)).not.toThrow();
      });
    });

    // Validates: Requirement 13.4
    describe('WIKI_ADMIN_TOKEN required with API_KEY_RW', () => {
      it('throws when API_KEY_RW is set without WIKI_ADMIN_TOKEN', () => {
        const config = validConfig({
          apiKeyRw: 'rw-key',
          wikiAdminToken: undefined,
        });

        expect(() => validateConfig(config)).toThrow(
          'WIKI_ADMIN_TOKEN required when API_KEY_RW is configured'
        );
      });

      it('throws when API_KEY_RW is set with empty WIKI_ADMIN_TOKEN', () => {
        const config = validConfig({
          apiKeyRw: 'rw-key',
          wikiAdminToken: '',
        });

        expect(() => validateConfig(config)).toThrow(
          'WIKI_ADMIN_TOKEN required when API_KEY_RW is configured'
        );
      });

      it('does not require WIKI_ADMIN_TOKEN when only API_KEY_RO is set', () => {
        const config = validConfig({
          apiKeyRo: 'ro-key',
          apiKeyRw: null,
          wikiAdminToken: undefined,
        });

        expect(() => validateConfig(config)).not.toThrow();
      });
    });

    // Validates: Requirement 13.2
    describe('OPENROUTER_API_KEY validation', () => {
      it('throws when OPENROUTER_API_KEY is missing', () => {
        const config = validConfig({ openrouterApiKey: undefined });

        expect(() => validateConfig(config)).toThrow('OPENROUTER_API_KEY is required');
      });

      it('throws when OPENROUTER_API_KEY is empty string', () => {
        const config = validConfig({ openrouterApiKey: '' });

        expect(() => validateConfig(config)).toThrow('OPENROUTER_API_KEY is required');
      });
    });

    // GATEWAY_PORT validation
    describe('GATEWAY_PORT validation', () => {
      it('throws for GATEWAY_PORT of 0', () => {
        const config = validConfig({ gatewayPort: 0 });

        expect(() => validateConfig(config)).toThrow('Invalid GATEWAY_PORT');
      });

      it('throws for GATEWAY_PORT above 65535', () => {
        const config = validConfig({ gatewayPort: 65536 });

        expect(() => validateConfig(config)).toThrow('Invalid GATEWAY_PORT');
      });

      it('throws for GATEWAY_PORT that is NaN', () => {
        const config = validConfig({ gatewayPort: NaN });

        expect(() => validateConfig(config)).toThrow('Invalid GATEWAY_PORT');
      });

      it('accepts GATEWAY_PORT of 1', () => {
        const config = validConfig({ gatewayPort: 1 });

        expect(() => validateConfig(config)).not.toThrow();
      });

      it('accepts GATEWAY_PORT of 65535', () => {
        const config = validConfig({ gatewayPort: 65535 });

        expect(() => validateConfig(config)).not.toThrow();
      });
    });

    // PGPORT validation
    describe('PGPORT validation', () => {
      it('throws for invalid PGPORT (too low)', () => {
        const config = validConfig({ pgPort: 0 });

        expect(() => validateConfig(config)).toThrow('Invalid PGPORT');
      });

      it('throws for invalid PGPORT (too high)', () => {
        const config = validConfig({ pgPort: 65536 });

        expect(() => validateConfig(config)).toThrow('Invalid PGPORT');
      });

      it('throws for invalid PGPORT (NaN)', () => {
        const config = validConfig({ pgPort: NaN });

        expect(() => validateConfig(config)).toThrow('Invalid PGPORT');
      });
    });

    // SYNC_INTERVAL_MS validation
    describe('SYNC_INTERVAL_MS validation', () => {
      it('throws for SYNC_INTERVAL_MS below 1000', () => {
        const config = validConfig({ syncIntervalMs: 999 });

        expect(() => validateConfig(config)).toThrow('Invalid SYNC_INTERVAL_MS');
      });

      it('throws for SYNC_INTERVAL_MS that is NaN', () => {
        const config = validConfig({ syncIntervalMs: NaN });

        expect(() => validateConfig(config)).toThrow('Invalid SYNC_INTERVAL_MS');
      });

      it('accepts minimum valid SYNC_INTERVAL_MS (1000ms)', () => {
        const config = validConfig({ syncIntervalMs: 1000 });

        expect(() => validateConfig(config)).not.toThrow();
      });
    });
  });

  // Validates: Requirements 9.4, 13.2, 13.3, 13.4
  describe('loadConfig integration (env → validate)', () => {
    it('refuses startup when no API keys are configured', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
      delete process.env.API_KEY_RO;
      delete process.env.API_KEY_RW;

      expect(() => loadConfig()).toThrow(
        'At least one of API_KEY_RO or API_KEY_RW must be configured'
      );
    });

    it('refuses startup when API_KEY_RW set without WIKI_ADMIN_TOKEN', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
      process.env.API_KEY_RW = 'rw-key-456';
      delete process.env.API_KEY_RO;
      delete process.env.WIKI_ADMIN_TOKEN;

      expect(() => loadConfig()).toThrow(
        'WIKI_ADMIN_TOKEN required when API_KEY_RW is configured'
      );
    });

    it('refuses startup when OPENROUTER_API_KEY is missing', () => {
      delete process.env.OPENROUTER_API_KEY;
      process.env.API_KEY_RO = 'ro-key-123';

      expect(() => loadConfig()).toThrow('OPENROUTER_API_KEY is required');
    });

    it('starts successfully with only API_KEY_RO and OPENROUTER_API_KEY', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
      process.env.API_KEY_RO = 'ro-key-123';
      delete process.env.API_KEY_RW;

      expect(() => loadConfig()).not.toThrow();
    });

    it('starts successfully with both keys and admin token', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
      process.env.API_KEY_RO = 'ro-key-123';
      process.env.API_KEY_RW = 'rw-key-456';
      process.env.WIKI_ADMIN_TOKEN = 'admin-token';

      expect(() => loadConfig()).not.toThrow();
    });
  });
});
