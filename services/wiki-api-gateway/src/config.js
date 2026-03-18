/**
 * Configuration module for Wiki REST API Gateway.
 * 
 * Loads and validates environment variables, providing a centralized
 * configuration object for the application.
 */

/**
 * Load configuration from environment variables.
 * 
 * @returns {Object} Configuration object
 * @throws {Error} If required environment variables are missing or invalid
 */
export function loadConfig() {
  const config = {
    // API Key Authentication
    apiKeyRo: process.env.API_KEY_RO || null,
    apiKeyRw: process.env.API_KEY_RW || null,
    wikiAdminToken: process.env.WIKI_ADMIN_TOKEN,
    
    // Gateway
    gatewayPort: Number(process.env.GATEWAY_PORT ?? 3001),
    
    // OpenRouter API (required for embeddings)
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    embeddingModel: process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small',
    openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    
    // Wiki.js
    wikiBaseUrl: process.env.WIKI_BASE_URL ?? 'http://localhost:3000',
    
    // Database
    pgHost: process.env.PGHOST ?? 'localhost',
    pgPort: Number(process.env.PGPORT ?? 5432),
    pgDatabase: process.env.PGDATABASE ?? 'wiki',
    pgUser: process.env.PGUSER ?? 'wiki',
    pgPassword: process.env.PGPASSWORD,
    
    // Sync Pipeline
    syncIntervalMs: Number(process.env.SYNC_INTERVAL_MS ?? 300000),
  };
  
  validateConfig(config);
  return config;
}

/**
 * Validate configuration object.
 * 
 * @param {Object} config - Configuration object to validate
 * @throws {Error} If configuration is invalid
 */
export function validateConfig(config) {
  // At least one API key must be configured
  if (!config.apiKeyRo && !config.apiKeyRw) {
    throw new Error('At least one of API_KEY_RO or API_KEY_RW must be configured');
  }
  
  // WIKI_ADMIN_TOKEN required when API_KEY_RW is configured
  if (config.apiKeyRw && !config.wikiAdminToken) {
    throw new Error('WIKI_ADMIN_TOKEN required when API_KEY_RW is configured');
  }
  
  // OPENROUTER_API_KEY is always required (for embeddings)
  if (!config.openrouterApiKey) {
    throw new Error('OPENROUTER_API_KEY is required');
  }
  
  // Validate gateway port
  if (isNaN(config.gatewayPort) || config.gatewayPort < 1 || config.gatewayPort > 65535) {
    throw new Error(`Invalid GATEWAY_PORT: ${config.gatewayPort}. Must be between 1 and 65535`);
  }
  
  // Validate database port
  if (isNaN(config.pgPort) || config.pgPort < 1 || config.pgPort > 65535) {
    throw new Error(`Invalid PGPORT: ${config.pgPort}. Must be between 1 and 65535`);
  }
  
  // Validate sync interval
  if (isNaN(config.syncIntervalMs) || config.syncIntervalMs < 1000) {
    throw new Error(`Invalid SYNC_INTERVAL_MS: ${config.syncIntervalMs}. Must be at least 1000ms`);
  }
}
