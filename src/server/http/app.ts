import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { JobQueue } from '@server/collector/queue.ts';
import type { DB } from '@server/db/client.ts';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import authPlugin from './plugins/auth.ts';
import { registerErrorHandler } from './plugins/error-handler.ts';
import { registerAuditRoutes } from './routes/audit.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerClientRoutes } from './routes/clients.ts';
import { registerControllerRoutes } from './routes/controllers.ts';
import { registerDeviceRoutes } from './routes/devices.ts';
import { registerEventsRoutes } from './routes/events.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerHealthz } from './routes/healthz.ts';
import { registerMetricsRoutes } from './routes/metrics.ts';
import { registerReportRoutes } from './routes/reports.ts';
import { registerSiteRoutes } from './routes/sites.ts';
import { registerThresholdsRoutes } from './routes/thresholds.ts';

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

  // Security headers — single-admin SaaS self-hosted, sem CSP por enquanto
  // (Vite gera scripts/styles inline em prod e exigiria nonce-per-request).
  // HSTS, frameguard, noSniff, referrer-policy etc cobrem o essencial.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true },
  });

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
  await registerClientRoutes(app, opts.db);
  await registerMetricsRoutes(app, opts.db);
  await registerReportRoutes(app, opts.db);
  await registerAuditRoutes(app, opts.db);
  await registerHealthRoutes(app, opts.db);
  await registerEventsRoutes(app, opts.db);
  await registerThresholdsRoutes(app, opts.db);

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
