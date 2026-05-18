import type { JobQueue } from '@server/collector/queue.ts';
import type { DB } from '@server/db/client.ts';
import { logAudit } from '@server/db/queries/audit.ts';
import {
  deleteController,
  getController,
  insertController,
  listControllers,
  updateController,
} from '@server/db/queries/controllers.ts';
import { listSitesByController } from '@server/db/queries/sites.ts';
import { controllerCreateInputSchema } from '@shared/schemas/controller.ts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const idParamSchema = z.object({ id: z.string().min(1).max(64) });

const updateControllerSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  pollSeconds: z.number().int().min(60).max(3600).optional(),
  insecureTls: z.boolean().optional(),
});

export interface RegisterControllerRoutesOptions {
  db: DB;
  queue: JobQueue;
  masterKey: string;
}

export async function registerControllerRoutes(
  app: FastifyInstance,
  opts: RegisterControllerRoutesOptions,
): Promise<void> {
  const { db, queue, masterKey } = opts;

  app.get('/api/v1/controllers', { preHandler: app.requireAdmin() }, async () => {
    return { ok: true, data: listControllers(db) };
  });

  app.get('/api/v1/controllers/:id', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const controller = getController(db, id);
    if (!controller) {
      reply.code(404).send({ ok: false, error: 'not_found' });
      return;
    }
    const sites = listSitesByController(db, id);
    return { ok: true, data: { ...controller, sites } };
  });

  app.post('/api/v1/controllers', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const input = controllerCreateInputSchema.parse(req.body);
    const id = insertController(db, { input, masterKey });
    queue.enqueue('collect', { controllerId: id }, undefined, { idempotencyKey: id });
    const created = getController(db, id);
    logAudit(db, {
      action: 'controller.created',
      target: id,
      metadata: { name: input.name, baseUrl: input.baseUrl, authMode: input.authMode },
    });
    reply.code(201).send({ ok: true, data: created });
  });

  app.patch('/api/v1/controllers/:id', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const patch = updateControllerSchema.parse(req.body);
    const before = getController(db, id);
    if (!before) {
      reply.code(404).send({ ok: false, error: 'not_found' });
      return;
    }
    const ok = updateController(db, id, patch);
    if (!ok) {
      reply.code(404).send({ ok: false, error: 'not_found' });
      return;
    }
    logAudit(db, { action: 'controller.updated', target: id, metadata: patch });
    return { ok: true, data: getController(db, id) };
  });

  app.delete('/api/v1/controllers/:id', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const before = getController(db, id);
    const removed = deleteController(db, id);
    if (!removed) {
      reply.code(404).send({ ok: false, error: 'not_found' });
      return;
    }
    logAudit(db, {
      action: 'controller.deleted',
      target: id,
      metadata: before ? { name: before.name } : undefined,
    });
    reply.code(204).send();
  });

  // Sanity check para diagnóstico de credenciais antes de cadastrar.
  app.post('/api/v1/controllers/test', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const input = controllerCreateInputSchema.parse(req.body);
    const { Agent, request } = await import('undici');
    const dispatcher = new Agent({ connect: { rejectUnauthorized: !input.insecureTls } });
    const url = `${input.baseUrl.replace(/\/+$/, '')}${
      input.variant === 'unifi-os' ? '/api/auth/login' : '/api/login'
    }`;
    try {
      const body =
        input.authMode === 'local'
          ? JSON.stringify({ username: input.username, password: input.password, remember: true })
          : '';
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (input.authMode === 'api-key') headers['x-api-key'] = input.apiKey;
      const res = await request(url, {
        method: input.authMode === 'local' ? 'POST' : 'GET',
        body: body || undefined,
        headers,
        dispatcher,
      });
      await res.body.text();
      reply.send({
        ok: true,
        data: {
          reachable: res.statusCode < 500,
          statusCode: res.statusCode,
          variantHint: detectVariantHint(res),
        },
      });
    } catch (err) {
      reply.code(422).send({
        ok: false,
        error: 'unreachable',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await dispatcher.close();
    }
  });
}

function detectVariantHint(res: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  return res.headers['x-csrf-token'] ? 'unifi-os' : 'classic';
}
