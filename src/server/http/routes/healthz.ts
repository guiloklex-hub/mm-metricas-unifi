import { APP_NAME, APP_VERSION } from '@shared/constants.ts';
import type { FastifyInstance } from 'fastify';

export async function registerHealthz(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({
    ok: true,
    name: APP_NAME,
    version: APP_VERSION,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  }));
}
