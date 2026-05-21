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
    // Cold-start de container Postgres+Timescale leva ~3-5s; cada teste tem
    // que ter folga para isso na primeira chamada de `createTestDb()`.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/server/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['**/*.test.ts', '**/types.ts', 'src/server/index.ts'],
      // Sem thresholds bloqueantes por enquanto — coverage atual ~18% (unit puro
      // + integração de collector). Crescemos a cobertura ao longo do tempo;
      // quando estabilizar, re-introduzir thresholds aqui.
    },
    pool: 'forks',
  },
});
