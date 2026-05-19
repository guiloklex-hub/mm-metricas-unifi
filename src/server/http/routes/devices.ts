import type { DB } from '@server/db/client.ts';
import { logAudit } from '@server/db/queries/audit.ts';
import {
  type AliasImportEntry,
  bulkUpsertAliasesByMac,
  findDeviceById,
  listAllDevices,
  setDeviceAlias,
} from '@server/db/queries/devices.ts';
import { normalizeMac } from '@server/unifi/parser.ts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const MAC_REGEX = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
const MAX_ALIAS_LEN = 120;
const MAX_CSV_ROWS = 10_000;

const listQuerySchema = z.object({
  controllerId: z.string().min(1).max(64).optional(),
  siteId: z.string().min(1).max(64).optional(),
});

const aliasBodySchema = z.object({
  alias: z.string().max(MAX_ALIAS_LEN).nullable(),
});

const importBodySchema = z.object({
  /** Conteúdo bruto do CSV (lido do arquivo no client). */
  csv: z
    .string()
    .min(1)
    .max(2 * 1024 * 1024),
  /** Filtro opcional: aplica só para devices deste controller. */
  controllerId: z.string().min(1).max(64).optional(),
});

const idParamSchema = z.object({ id: z.string().min(1).max(64) });

export async function registerDeviceRoutes(app: FastifyInstance, db: DB): Promise<void> {
  app.get('/api/v1/devices', { preHandler: app.requireAdmin() }, async (req) => {
    const filters = listQuerySchema.parse(req.query);
    return { ok: true, data: listAllDevices(db, filters) };
  });

  app.put('/api/v1/devices/:id/alias', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const { alias } = aliasBodySchema.parse(req.body);
    const changes = setDeviceAlias(db, id, alias);
    if (changes === 0) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }
    const updated = findDeviceById(db, id);
    logAudit(db, {
      action: 'device.alias.updated',
      target: id,
      metadata: { alias: alias ?? null, mac: updated?.mac ?? null },
    });
    return { ok: true, data: updated };
  });

  app.post(
    '/api/v1/devices/aliases/import',
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
      const result = bulkUpsertAliasesByMac(db, parsed.entries, { controllerId });
      const allErrors = [...parsed.parseErrors, ...result.errors];
      logAudit(db, {
        action: 'device.aliases.imported',
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

export interface CsvParseResult {
  entries: AliasImportEntry[];
  parseErrors: Array<{ line: number; mac: string; reason: 'mac_invalid' | 'alias_too_long' }>;
}

/**
 * Parser CSV minimalista para o caso `mac,alias`:
 *  - Suporta cabeçalho opcional `mac,alias` (case-insensitive).
 *  - Aceita separador `,` ou `;`.
 *  - `alias` pode estar entre aspas (caso contenha vírgula). Implementação cobre
 *    apenas pares de aspas simples no início/fim do campo — suficiente pro
 *    formato esperado.
 *  - Linhas vazias e linhas começando com `#` são ignoradas.
 *  - MAC inválido vira `parseErrors`, não interrompe o batch.
 */
export function parseAliasCsv(csv: string): CsvParseResult {
  const entries: AliasImportEntry[] = [];
  const parseErrors: CsvParseResult['parseErrors'] = [];
  const rawLines = csv.split(/\r?\n/);
  let headerSkipped = false;

  for (let i = 0; i < rawLines.length; i += 1) {
    const lineNo = i + 1;
    const line = rawLines[i]?.trim() ?? '';
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;

    const cols = splitCsvLine(line);
    if (cols.length < 1) continue;

    const first = cols[0]?.trim() ?? '';
    const second = (cols[1] ?? '').trim();

    // Header detection: primeira linha não-vazia, com texto que claramente
    // não é um MAC. Pular UMA vez.
    if (!headerSkipped && !looksLikeMac(first)) {
      headerSkipped = true;
      if (first.toLowerCase() === 'mac' || first.toLowerCase() === 'macaddress') {
        continue;
      }
      // Não-MAC sem ser header conhecido — reporta como erro.
      parseErrors.push({ line: lineNo, mac: first, reason: 'mac_invalid' });
      continue;
    }
    headerSkipped = true;

    const normalized = normalizeMac(first);
    if (!MAC_REGEX.test(normalized)) {
      parseErrors.push({ line: lineNo, mac: first, reason: 'mac_invalid' });
      continue;
    }

    const aliasRaw = unquote(second);
    const alias = aliasRaw.length === 0 ? null : aliasRaw;
    if (alias != null && alias.length > MAX_ALIAS_LEN) {
      parseErrors.push({ line: lineNo, mac: normalized, reason: 'alias_too_long' });
      continue;
    }

    entries.push({ mac: normalized, alias, line: lineNo });
  }

  return { entries, parseErrors };
}

function splitCsvLine(line: string): string[] {
  // Detecta delimitador mais provável.
  const delim = line.includes(';') && !line.includes(',') ? ';' : ',';
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replaceAll('""', '"');
  }
  return s;
}

function looksLikeMac(s: string): boolean {
  return /[0-9a-f]{2}[:-][0-9a-f]{2}/i.test(s);
}
