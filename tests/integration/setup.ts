/**
 * Setup global do Vitest.
 * - Define defaults de env para os testes (MASTER_KEY, JWT_SECRET).
 *
 * Suites individuais que precisem de MSW configuram seus próprios servers
 * via `setupServer(...handlers)` em `beforeAll`/`afterAll`.
 */

process.env.MASTER_KEY ??= Buffer.alloc(32, 0x42).toString('base64');
process.env.JWT_SECRET ??=
  'a-very-long-test-secret-for-jwt-signing-please-replace-in-real-deploys-abcdefghij';
process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'silent';
