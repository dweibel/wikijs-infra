/**
 * Unit tests for configuration module.
 * 
 * Feature: wiki-mcp-access-control
 * Task: 2.1 - Environment Variable Configuration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, validateConfig } from './config.js';

describe('Configuration Module', () => {
  let originalEnv;
  
  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });
  
  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });
  
  describe('loadConfig', () => {
    it('loads configuration with all required environment variables', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
      process.env.ENABLE_WRITE_OPERATIONS = 'true';
      process.env.WIKI_ADMIN_TOKEN = 'test-admin-token';
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
      
      expect(config.openrouterApiKey).toBe('sk-or-test-key');
      expect(config.enableWriteOps).toBe(true);
      expect(config.wikiAdminToken).toBe('test-admin-token');
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
    
    it('uses default values for optional configuration', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
      // Clear optional variables
      delete process.env.ENABLE_WRITE_OPERATIONS;
      delete process.env.WIKI_BASE_URL;
      delete process.env.PGHOST;
      delete process.env.PGPORT;
      delete process.env.PGDATABASE;
      delete process.env.PGUSER;
      delete process.env.SYNC_INTERVAL_MS;
      delete process.env.EMBEDDING_MODEL;
      delete process.env.OPENROUTER_BASE_URL;
      
      const config = loadConfig();
      
      expect(config.enableWriteOps).toBe(false);
      expect(config.wikiBaseUrl).toBe('http://localhost:3000');
      expect(config.pgHost).toBe('localhost');
      expect(config.pgPort).toBe(5432);
      expect(config.pgDatabase).toBe('wiki');
      expect(config.pgUser).toBe('wiki');
      expect(config.syncIntervalMs).toBe(300000);
      expect(config.embeddingModel).toBe('openai/text-embedding-3-small');
      expect(config.openrouterBaseUrl).toBe('https://openrouter.ai/api/v1');
    });
    
    it('defaults ENABLE_WRITE_OPERATIONS to false', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
      delete process.env.ENABLE_WRITE_OPERATIONS;
      
      const config = loadConfig();
      
      expect(config.enableWriteOps).toBe(false);
    });
    
    it('parses ENABLE_WRITE_OPERATIONS=true correctly', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
      process.env.ENABLE_WRITE_OPERATIONS = 'true';
      process.env.WIKI_ADMIN_TOKEN = 'test-token';
      
      const config = loadConfig();
      
      expect(config.enableWriteOps).toBe(true);
    });
    
    it('treats non-"true" values as false for ENABLE_WRITE_OPERATIONS', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
      
      const testValues = ['false', 'True', 'TRUE', '1', 'yes', ''];
      
      for (const value of testValues) {
        process.env.ENABLE_WRITE_OPERATIONS = value;
        const config = loadConfig();
        expect(config.enableWriteOps).toBe(false);
      }
    });
  });
  
  describe('validateConfig', () => {
    it('throws error when OPENROUTER_API_KEY is missing', () => {
      const config = {
        openrouterApiKey: undefined,
        enableWriteOps: false,
        pgPort: 5432,
        syncIntervalMs: 300000,
      };
      
      expect(() => validateConfig(config)).toThrow('OPENROUTER_API_KEY is required');
    });
    
    it('throws error when OPENROUTER_API_KEY is empty string', () => {
      const config = {
        openrouterApiKey: '',
        enableWriteOps: false,
        pgPort: 5432,
        syncIntervalMs: 300000,
      };
      
      expect(() => validateConfig(config)).toThrow('OPENROUTER_API_KEY is required');
    });
    
    it('throws error when WIKI_ADMIN_TOKEN missing with write ops enabled', () => {
      const config = {
        openrouterApiKey: 'sk-or-test-key',
        enableWriteOps: true,
        wikiAdminToken: undefined,
        pgPort: 5432,
        syncIntervalMs: 300000,
      };
      
      expect(() => validateConfig(config)).toThrow('WIKI_ADMIN_TOKEN required when ENABLE_WRITE_OPERATIONS=true');
    });
    
    it('throws error when WIKI_ADMIN_TOKEN is empty string with write ops enabled', () => {
      const config = {
        openrouterApiKey: 'sk-or-test-key',
        enableWriteOps: true,
        wikiAdminToken: '',
        pgPort: 5432,
        syncIntervalMs: 300000,
      };
      
      expect(() => validateConfig(config)).toThrow('WIKI_ADMIN_TOKEN required when ENABLE_WRITE_OPERATIONS=true');
    });
    
    it('does not require WIKI_ADMIN_TOKEN when write ops disabled', () => {
      const config = {
        openrouterApiKey: 'sk-or-test-key',
        enableWriteOps: false,
        wikiAdminToken: undefined,
        pgPort: 5432,
        syncIntervalMs: 300000,
      };
      
      expect(() => validateConfig(config)).not.toThrow();
    });
    
    it('accepts valid configuration with write ops enabled', () => {
      const config = {
        openrouterApiKey: 'sk-or-test-key',
        enableWriteOps: true,
        wikiAdminToken: 'test-token',
        pgPort: 5432,
        syncIntervalMs: 300000,
      };
      
      expect(() => validateConfig(config)).not.toThrow();
    });
    
    it('throws error for invalid PGPORT (too low)', () => {
      const config = {
        openrouterApiKey: 'sk-or-test-key',
        enableWriteOps: false,
        pgPort: 0,
        syncIntervalMs: 300000,
      };
      
      expect(() => validateConfig(config)).toThrow('Invalid PGPORT');
    });
    
    it('throws error for invalid PGPORT (too high)', () => {
      const config = {
        openrouterApiKey: 'sk-or-test-key',
        enableWriteOps: false,
        pgPort: 65536,
        syncIntervalMs: 300000,
      };
      
      expect(() => validateConfig(config)).toThrow('Invalid PGPORT');
    });
    
    it('throws error for invalid PGPORT (NaN)', () => {
      const config = {
        openrouterApiKey: 'sk-or-test-key',
        enableWriteOps: false,
        pgPort: NaN,
        syncIntervalMs: 300000,
      };
      
      expect(() => validateConfig(config)).toThrow('Invalid PGPORT');
    });
    
    it('throws error for invalid SYNC_INTERVAL_MS (too low)', () => {
      const config = {
        openrouterApiKey: 'sk-or-test-key',
        enableWriteOps: false,
        pgPort: 5432,
        syncIntervalMs: 999,
      };
      
      expect(() => validateConfig(config)).toThrow('Invalid SYNC_INTERVAL_MS');
    });
    
    it('throws error for invalid SYNC_INTERVAL_MS (NaN)', () => {
      const config = {
        openrouterApiKey: 'sk-or-test-key',
        enableWriteOps: false,
        pgPort: 5432,
        syncIntervalMs: NaN,
      };
      
      expect(() => validateConfig(config)).toThrow('Invalid SYNC_INTERVAL_MS');
    });
    
    it('accepts minimum valid SYNC_INTERVAL_MS (1000ms)', () => {
      const config = {
        openrouterApiKey: 'sk-or-test-key',
        enableWriteOps: false,
        pgPort: 5432,
        syncIntervalMs: 1000,
      };
      
      expect(() => validateConfig(config)).not.toThrow();
    });
  });
  
  describe('Error Messages', () => {
    it('provides clear error message for missing OPENROUTER_API_KEY', () => {
      process.env = {};
      
      expect(() => loadConfig()).toThrow(/OPENROUTER_API_KEY is required/);
    });
    
    it('provides clear error message for missing WIKI_ADMIN_TOKEN with write ops', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
      process.env.ENABLE_WRITE_OPERATIONS = 'true';
      delete process.env.WIKI_ADMIN_TOKEN;
      
      expect(() => loadConfig()).toThrow(/WIKI_ADMIN_TOKEN required when ENABLE_WRITE_OPERATIONS=true/);
    });
  });
});
