import type { DB } from '@server/db/client.ts';
import { logAudit } from '@server/db/queries/audit.ts';
import {
  bulkUpsertClientAliasesByMac,
  findClientById,
  listAllClients,
  setClientAlias,
} from '@server/db/queries/clients.ts';
import { parseAliasCsv } from '@server/http/routes/devices.ts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const MAX_ALIAS_LEN = 120;
const MAX_CSV_ROWS = 50_000;

const listQuerySchema = z.object({
  controllerId: z.string().min(1).max(64).optional(),
  siteId: z.string().min(1).max(64).optional(),
});

const aliasBodySchema = z.object({
  alias: z.string().max(MAX_ALIAS_LEN).nullable(),
});

const importBodySchema = z.object({
  csv: z
    .string()
    .min(1)
    .max(4 * 1024 * 1024),
  controllerId: z.string().min(1).max(64).optional(),
});

const idParamSchema = z.object({ id: z.string().min(1).max(64) });

export async function registerClientRoutes(app: FastifyInstance, db: DB): Promise<void> {
  app.get('/api/v1/clients', { preHandler: app.requireAdmin() }, async (req) => {
    const filters = listQuerySchema.parse(req.query);
    return { ok: true, data: listAllClients(db, filters) };
  });

  app.put('/api/v1/clients/:id/alias', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const { alias } = aliasBodySchema.parse(req.body);
    const changes = setClientAlias(db, id, alias);
    if (changes === 0) {
      return reply.code(404).send({ ok: false, error: 'client_not_found' });
    }
    const updated = findClientById(db, id);
    logAudit(db, {
      action: 'client.alias.updated',
      target: id,
      metadata: { alias: alias ?? null, mac: updated?.mac ?? null },
    });
    return { ok: true, data: updated };
  });

  app.post(
    '/api/v1/clients/aliases/import',
    { preHandler: app.requireAdmin() },
    async (req, reply) => {
      const { csv, controllerId } = importBodySchema.parse(req.body);
      const parsed = parseAliasCsv(csv);
      if (parsed.entries.length > MAX_CSV_ROWS) {
        return reply.code(400).send({
          ok: false,
          error: 'too_many_rows',
          message: `Máximo de ${MAX_CSV_ROWS} linhas por import.`,
        });
      }
      const result = bulkUpsertClientAliasesByMac(db, parsed.entries, { controllerId });
      const allErrors = [...parsed.parseErrors, ...result.errors];
      logAudit(db, {
        action: 'client.aliases.imported',
        metadata: {
          updated: result.updated,
          skipped: result.skipped,
          parseErrors: parsed.parseErrors.length,
          controllerId: controllerId ?? null,
        },
      });
      return {
        ok: true,
        data: {
          updated: result.updated,
          skipped: result.skipped + parsed.parseErrors.length,
          errors: allErrors,
        },
      };
    },
  );
}
