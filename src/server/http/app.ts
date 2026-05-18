import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { DB } from '@server/db/client.ts';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import authPlugin from './plugins/auth.ts';
import { registerErrorHandler } from './plugins/error-handler.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerHealthz } from './routes/healthz.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BuildAppOptions {
  db: DB;
  logger: FastifyBaseLogger;
  jwtSecret: string;
  staticDir?: string;
}

/**
 * Constrói a instância Fastify com middlewares, plugins e rotas registradas.
 * Não inicia o listen — quem chama é responsável.
 */
export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: opts.logger,
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 1024 * 1024, // 1MB
  });

  registerErrorHandler(app);

  await app.register(authPlugin, { jwtSecret: opts.jwtSecret });
  await app.register(fastifyRateLimit, {
    global: false,
    max: 30,
    timeWindow: '1 minute',
  });

  await registerHealthz(app);
  await registerAuthRoutes(app, opts.db);

  const staticDir = opts.staticDir ?? resolve(__dirname, '../../../dist/web');
  const hasStatic = existsSync(staticDir);
  if (hasStatic) {
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
      wildcard: false,
      index: ['index.html'],
    });
  }

  // Único notFoundHandler: APIs respondem 404 JSON; demais entregam index.html
  // (SPA fallback) quando há build estático disponível.
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url === '/healthz') {
      reply.status(404).send({ ok: false, error: 'not_found', path: req.url });
      return;
    }
    if (hasStatic) {
      return reply.sendFile('index.html');
    }
    reply.status(404).send({ ok: false, error: 'not_found', path: req.url });
  });

  return app;
}
