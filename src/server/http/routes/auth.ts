import type { DB } from '@server/db/client.ts';
import { logAudit } from '@server/db/queries/audit.ts';
import { appConfig } from '@server/db/schema.ts';
import { loginInputSchema, setupAdminInputSchema } from '@shared/schemas/auth.ts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../auth/hash.ts';
import { SESSION_COOKIE } from '../plugins/auth.ts';

const PASSWORD_KEY = 'admin_password_hash';
const SETUP_KEY = 'setup_complete';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});

export async function registerAuthRoutes(app: FastifyInstance, db: DB): Promise<void> {
  app.get('/api/v1/auth/setup-status', async () => {
    const row = await db.select().from(appConfig).where(eq(appConfig.key, SETUP_KEY)).get();
    return { ok: true, data: { complete: row?.value === 'true' } };
  });

  app.post(
    '/api/v1/auth/setup',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const setupRow = await db.select().from(appConfig).where(eq(appConfig.key, SETUP_KEY)).get();
      if (setupRow?.value === 'true') {
        return reply.code(409).send({ ok: false, error: 'setup_already_complete' });
      }
      const input = setupAdminInputSchema.parse(req.body);
      const hash = await hashPassword(input.password);
      db.insert(appConfig)
        .values([
          { key: PASSWORD_KEY, value: hash },
          { key: SETUP_KEY, value: 'true' },
        ])
        .onConflictDoUpdate({
          target: appConfig.key,
          set: { value: hash },
        })
        .run();
      logAudit(db, { action: 'auth.setup', actor: 'admin' });
      return reply.code(201).send({ ok: true, data: { setupComplete: true } });
    },
  );

  app.post(
    '/api/v1/auth/login',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const input = loginInputSchema.parse(req.body);
      const row = await db.select().from(appConfig).where(eq(appConfig.key, PASSWORD_KEY)).get();
      if (!row) {
        return reply.code(409).send({ ok: false, error: 'setup_required' });
      }
      const ok = await verifyPassword(row.value, input.password);
      if (!ok) {
        logAudit(db, { action: 'auth.login.failed', actor: clientIp(req) });
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 200));
        return reply.code(401).send({ ok: false, error: 'invalid_credentials' });
      }
      const token = await reply.jwtSign({ role: 'admin' });
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.protocol === 'https',
        path: '/',
        maxAge: 24 * 60 * 60,
      });
      logAudit(db, { action: 'auth.login.success', actor: clientIp(req) });
      return reply.send({ ok: true, data: { role: 'admin' } });
    },
  );

  app.post('/api/v1/auth/logout', async (req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    logAudit(db, { action: 'auth.logout', actor: clientIp(req) });
    return reply.send({ ok: true });
  });

  app.get('/api/v1/auth/me', { preHandler: app.requireAdmin() }, async (req) => ({
    ok: true,
    data: req.sessionUser,
  }));

  app.post(
    '/api/v1/auth/change-password',
    { preHandler: app.requireAdmin() },
    async (req, reply) => {
      const input = changePasswordSchema.parse(req.body);
      const row = await db.select().from(appConfig).where(eq(appConfig.key, PASSWORD_KEY)).get();
      if (!row) {
        return reply.code(409).send({ ok: false, error: 'setup_required' });
      }
      const ok = await verifyPassword(row.value, input.currentPassword);
      if (!ok) {
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 200));
        return reply.code(401).send({ ok: false, error: 'invalid_credentials' });
      }
      const hash = await hashPassword(input.newPassword);
      db.update(appConfig).set({ value: hash }).where(eq(appConfig.key, PASSWORD_KEY)).run();
      logAudit(db, { action: 'auth.password_changed', actor: clientIp(req) });
      return reply.send({ ok: true });
    },
  );
}

function clientIp(req: { ip?: string; ips?: string[] }): string {
  if (req.ips && req.ips.length > 0) return req.ips[req.ips.length - 1] ?? 'unknown';
  return req.ip ?? 'unknown';
}
