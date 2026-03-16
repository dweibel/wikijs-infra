import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/integration/**/*.test.js'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
