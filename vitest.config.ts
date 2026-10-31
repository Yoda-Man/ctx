import { defineConfig } from 'vitest/config';
import { resolve, join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

// Every test run gets its own home folder, so no test can read or write the
// real ~/.ctx (one that mocked only getDbPath wrote 2,500 chunks into it).
const testHome = mkdtempSync(join(tmpdir(), 'ctx-test-home-'));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: { HOME: testHome, USERPROFILE: testHome },
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/index.ts', // Barrel exports
        'src/**/*.d.ts', // Type definitions
        'src/**/__tests__/**', // Test files
        'src/test-utils/**', // Test utilities
      ],
      thresholds: {
        // Core modules with high-value coverage requirements
        'src/agent/**/*.ts': {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        'src/search/**/*.ts': {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        'src/errors/**/*.ts': {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
