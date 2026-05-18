import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@server': path.resolve(__dirname, 'src/server'),
      '@web': path.resolve(__dirname, 'src/web'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    setupFiles: ['tests/integration/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/server/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['**/*.test.ts', '**/types.ts', 'src/server/index.ts'],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 65,
      },
    },
    pool: 'forks',
  },
});
