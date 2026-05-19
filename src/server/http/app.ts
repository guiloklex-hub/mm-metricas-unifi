import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { JobQueue } from '@server/collector/queue.ts';
import type { DB } from '@server/db/client.ts';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import authPlugin from './plugins/auth.ts';
import { registerErrorHandler } from './plugins/error-handler.ts';
import { registerAuditRoutes } from './routes/audit.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerControllerRoutes } from './routes/controllers.ts';
import { registerDeviceRoutes } from './routes/devices.ts';
import { registerHealthz } from './routes/healthz.ts';
import { registerMetricsRoutes } from './routes/metrics.ts';
import { registerReportRoutes } from './routes/reports.ts';
import { registerSiteRoutes } from './routes/sites.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BuildAppOptions {
  db: DB;
  queue: JobQueue;
  logger: FastifyBaseLogger;
  jwtSecret: string;
  masterKey: string;
  staticDir?: string;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: opts.logger,
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
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
  await registerControllerRoutes(app, {
    db: opts.db,
    queue: opts.queue,
    masterKey: opts.masterKey,
  });
  await registerSiteRoutes(app, opts.db);
  await registerDeviceRoutes(app, opts.db);
  await registerMetricsRoutes(app, opts.db);
  await registerReportRoutes(app, opts.db);
  await registerAuditRoutes(app, opts.db);

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
