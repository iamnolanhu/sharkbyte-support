import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // PGlite-backed tests can pay the one-time PGlite boot inside a test body; matches TEST_DB_TIMEOUT_MS.
    testTimeout: 30_000,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'public/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
