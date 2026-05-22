import type { UnifiClientPool } from '@server/collector/clients-pool.ts';
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
  // `null` re-arma o auto-detect na próxima coleta.
  variant: z.enum(['unifi-os', 'classic']).nullable().optional(),
});

const backfillBodySchema = z.object({
  days: z.number().int().min(1).max(365),
  intervals: z
    .array(z.enum(['5minutes', 'hourly', 'daily']))
    .min(1)
    .optional(),
  includeDaily: z.boolean().optional(),
});

export interface RegisterControllerRoutesOptions {
  db: DB;
  queue: JobQueue;
  pool: UnifiClientPool;
  masterKey: string;
}

export async function registerControllerRoutes(
  app: FastifyInstance,
  opts: RegisterControllerRoutesOptions,
): Promise<void> {
  const { db, queue, pool, masterKey } = opts;

  app.get('/api/v1/controllers', { preHandler: app.requireAdmin() }, async () => {
    return { ok: true, data: await listControllers(db) };
  });

  app.get('/api/v1/controllers/:id', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const controller = await getController(db, id);
    if (!controller) {
      reply.code(404).send({ ok: false, error: 'not_found' });
      return;
    }
    const sites = await listSitesByController(db, id);
    return { ok: true, data: { ...controller, sites } };
  });

  app.post('/api/v1/controllers', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const input = controllerCreateInputSchema.parse(req.body);
    const id = await insertController(db, { input, masterKey });
    await queue.enqueue('collect', { controllerId: id }, undefined, { idempotencyKey: id });
    const created = await getController(db, id);
    await logAudit(db, {
      action: 'controller.created',
      target: id,
      metadata: { name: input.name, baseUrl: input.baseUrl, authMode: input.authMode },
    });
    reply.code(201).send({ ok: true, data: created });
  });

  app.patch('/api/v1/controllers/:id', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const patch = updateControllerSchema.parse(req.body);
    const before = await getController(db, id);
    if (!before) {
      reply.code(404).send({ ok: false, error: 'not_found' });
      return;
    }
    const ok = await updateController(db, id, patch);
    if (!ok) {
      reply.code(404).send({ ok: false, error: 'not_found' });
      return;
    }

    // Configurações que afetam o cliente UniFi em memória (variant, TLS) exigem
    // descartar a instância cacheada — senão o pool continua usando o variant
    // antigo e o usuário não vê efeito até reiniciar o processo. Reagenda
    // coleta imediata para validar a mudança.
    const invalidatesClient = patch.variant !== undefined || patch.insecureTls !== undefined;
    if (invalidatesClient) {
      await pool.evict(id);
      await queue.enqueue('collect', { controllerId: id }, undefined, { idempotencyKey: id });
    }

    await logAudit(db, { action: 'controller.updated', target: id, metadata: patch });
    return { ok: true, data: await getController(db, id) };
  });

  app.delete('/api/v1/controllers/:id', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const before = await getController(db, id);
    const removed = await deleteController(db, id);
    if (!removed) {
      reply.code(404).send({ ok: false, error: 'not_found' });
      return;
    }
    await logAudit(db, {
      action: 'controller.deleted',
      target: id,
      metadata: before ? { name: before.name } : undefined,
    });
    reply.code(204).send();
  });

  // Backfill de histórico vindo do próprio controller (endpoint stat/report).
  app.post(
    '/api/v1/controllers/:id/backfill',
    { preHandler: app.requireAdmin() },
    async (req, reply) => {
      const { id } = idParamSchema.parse(req.params);
      const body = backfillBodySchema.parse(req.body ?? {});
      const controller = await getController(db, id);
      if (!controller) {
        reply.code(404).send({ ok: false, error: 'not_found' });
        return;
      }
      const jobId = await queue.enqueue(
        'backfill',
        {
          controllerId: id,
          days: body.days,
          intervals: body.intervals,
          includeDaily: body.includeDaily,
        },
        undefined,
        { idempotencyKey: id, maxAttempts: 1 },
      );
      await logAudit(db, {
        action: 'controller.backfill.requested',
        target: id,
        metadata: { days: body.days, intervals: body.intervals, includeDaily: body.includeDaily },
      });
      reply.code(202).send({ ok: true, data: { jobId, controllerId: id, days: body.days } });
    },
  );

  app.get(
    '/api/v1/controllers/:id/backfill/status',
    { preHandler: app.requireAdmin() },
    async (req, reply) => {
      const { id } = idParamSchema.parse(req.params);
      const controller = await getController(db, id);
      if (!controller) {
        reply.code(404).send({ ok: false, error: 'not_found' });
        return;
      }
      const job = await queue.findLatestByKey('backfill', id);
      if (!job) {
        return { ok: true, data: { controllerId: id, job: null } };
      }
      return {
        ok: true,
        data: {
          controllerId: id,
          job: {
            id: job.id,
            status: job.status,
            attempts: job.attempts,
            runAt: job.runAt,
            updatedAt: job.updatedAt,
            lastError: job.lastError,
          },
        },
      };
    },
  );

  // Sanity check para diagnóstico de credenciais antes de cadastrar.
  app.post('/api/v1/controllers/test', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const input = controllerCreateInputSchema.parse(req.body);
    const urlCheck = validateControllerUrl(input.baseUrl);
    if (!urlCheck.ok) {
      reply.code(400).send({ ok: false, error: 'invalid_base_url', message: urlCheck.reason });
      return;
    }
    const { Agent, request } = await import('undici');
    // Timeouts curtos para evitar hang em hosts que aceitam mas não respondem.
    const dispatcher = new Agent({
      connect: { rejectUnauthorized: !input.insecureTls, timeout: 5000 },
      headersTimeout: 8000,
      bodyTimeout: 10000,
    });
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
      // Não devolver err.message cru: pode vazar topologia interna em
      // ambientes onde o admin é compromissado (XSS via outro caminho).
      reply.code(422).send({ ok: false, error: 'unreachable' });
    } finally {
      await dispatcher.close();
    }
  });
}

/**
 * Valida que `baseUrl` aponta para um controller UniFi remoto, recusando
 * SSRF para hostnames internos (localhost, link-local, RFC1918) e protocolos
 * não-HTTP. Em ambientes onde o controller fica na rede privada e essa
 * proteção precisa ser desligada, basta exportar `ALLOW_LOCAL_CONTROLLER=1`.
 */
function validateControllerUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'URL inválida' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'Apenas http(s) é aceito' };
  }
  if (process.env.ALLOW_LOCAL_CONTROLLER === '1') return { ok: true };
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    return { ok: false, reason: 'Hostname local bloqueado (exporte ALLOW_LOCAL_CONTROLLER=1)' };
  }
  // Link-local AWS/GCP metadata.
  if (host.startsWith('169.254.') || host.startsWith('fe80:')) {
    return { ok: false, reason: 'Hostname de link-local/metadata bloqueado' };
  }
  // RFC1918 mais comuns — usuários self-hosted geralmente têm IP privado.
  // Mesmo assim, queremos o opt-in explícito para evitar SSRF acidental.
  if (
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return { ok: false, reason: 'IP privado bloqueado (exporte ALLOW_LOCAL_CONTROLLER=1)' };
  }
  return { ok: true };
}

function detectVariantHint(res: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  return res.headers['x-csrf-token'] ? 'unifi-os' : 'classic';
}
