import type { DB } from '@server/db/client.ts';
import { listDevicesBySite } from '@server/db/queries/devices.ts';
import { listAllSites, listSitesByController } from '@server/db/queries/sites.ts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const queryControllerSchema = z.object({ controllerId: z.string().min(1).max(64).optional() });

export async function registerSiteRoutes(app: FastifyInstance, db: DB): Promise<void> {
  app.get('/api/v1/sites', { preHandler: app.requireAdmin() }, async (req) => {
    const query = queryControllerSchema.parse(req.query);
    const sites = query.controllerId
      ? listSitesByController(db, query.controllerId)
      : listAllSites(db);
    return { ok: true, data: sites };
  });

  app.get('/api/v1/sites/:id/devices', { preHandler: app.requireAdmin() }, async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const devices = listDevicesBySite(db, id);
    return { ok: true, data: devices };
  });
}
