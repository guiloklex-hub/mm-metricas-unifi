import type { DB } from '@server/db/client.ts';
import { markControllerError } from '@server/db/queries/controllers.ts';
import { findDeviceByMac, upsertDevice } from '@server/db/queries/devices.ts';
import {
  type HistoricalSample,
  type HistoricalTable,
  insertHistoricalSamples,
} from '@server/db/queries/metrics-write.ts';
import { listEnabledSitesByController } from '@server/db/queries/sites.ts';
import type { UnifiClient } from '@server/unifi/client.ts';
import {
  type HistoricalSampleInput,
  parseStatReportPoint,
  STAT_REPORT_ATTRS,
} from '@server/unifi/parser-history.ts';
import { bucketTs } from '@server/utils/time.ts';
import type { Logger } from 'pino';
import type { UnifiClientPool } from '../clients-pool.ts';

export interface BackfillJobPayload {
  controllerId: string;
  /** Janela em dias a buscar (a partir de agora). */
  days: number;
  /** Granularidades a buscar. Default: ['5minutes', 'hourly']. */
  intervals?: BackfillInterval[];
  /** Quando true, popula apenas a granularidade `daily` (cobertura de longo prazo). */
  includeDaily?: boolean;
}

export type BackfillInterval = '5minutes' | 'hourly' | 'daily';

export interface BackfillJobResult {
  controllerId: string;
  sitesProcessed: number;
  pointsFetched: number;
  samplesInserted: number;
  samplesSkipped: number;
  errors: Array<{ site: string; interval: BackfillInterval; message: string }>;
}

export interface BackfillJobDeps {
  db: DB;
  pool: UnifiClientPool;
  logger: Logger;
}

const INTERVAL_TO_TABLE: Record<BackfillInterval, HistoricalTable> = {
  '5minutes': 'metrics_5m',
  hourly: 'metrics_1h',
  daily: 'metrics_1d',
};

const INTERVAL_TO_GRANULARITY: Record<BackfillInterval, '5m' | '1h' | '1d'> = {
  '5minutes': '5m',
  hourly: '1h',
  daily: '1d',
};

/**
 * Importa o histórico já existente no controller (endpoint `stat/report`) para
 * dentro do banco. Usado uma única vez ao registrar um controller novo, ou
 * sob demanda na UI.
 *
 * Para cada site habilitado do controller, e cada granularidade pedida:
 *   1) GET `/stat/report/{interval}.site`  → série agregada do site
 *   2) GET `/stat/report/{interval}.ap`    → série por AP
 *   3) Resolve AP-MAC → device_id (upsert se ainda não conhecido).
 *   4) Insere via `insertHistoricalSamples` (ON CONFLICT DO NOTHING).
 */
export async function runBackfillJob(
  payload: BackfillJobPayload,
  deps: BackfillJobDeps,
): Promise<BackfillJobResult> {
  const { db, pool, logger } = deps;
  const log = logger.child({ jobKind: 'backfill', controllerId: payload.controllerId });

  const result: BackfillJobResult = {
    controllerId: payload.controllerId,
    sitesProcessed: 0,
    pointsFetched: 0,
    samplesInserted: 0,
    samplesSkipped: 0,
    errors: [],
  };

  let client: UnifiClient;
  try {
    client = await pool.getOrCreate(payload.controllerId);
  } catch (err) {
    const msg = errMsg(err);
    await markControllerError(db, payload.controllerId, `backfill client: ${msg}`);
    throw err;
  }

  const intervals: BackfillInterval[] =
    payload.intervals ??
    (payload.includeDaily ? ['5minutes', 'hourly', 'daily'] : ['5minutes', 'hourly']);

  const end = Date.now();
  const start = end - payload.days * 86400 * 1000;

  const sites = await listEnabledSitesByController(db, payload.controllerId);
  for (const site of sites) {
    let sitePointsFetched = 0;
    let siteInserted = 0;
    let siteSkipped = 0;

    for (const interval of intervals) {
      const table = INTERVAL_TO_TABLE[interval];
      const granularity = INTERVAL_TO_GRANULARITY[interval];
      try {
        // 1) Série do site (agregada).
        const sitePoints = await client.fetchStatReport(site.unifiName, interval, 'site', {
          start,
          end,
          attrs: [...STAT_REPORT_ATTRS],
        });
        const siteSamples: HistoricalSample[] = [];
        for (const p of sitePoints) {
          const parsed = parseStatReportPoint(p, {
            controllerId: payload.controllerId,
            siteId: site.id,
            subject: 'site',
          });
          if (!parsed) continue;
          siteSamples.push(toHistoricalSample(parsed, granularity, null));
        }
        const sitePersist = await insertHistoricalSamples(db, table, siteSamples);
        sitePointsFetched += sitePoints.length;
        siteInserted += sitePersist.inserted;
        siteSkipped += sitePersist.skipped;

        // 2) Série por AP.
        const apPoints = await client.fetchStatReport(site.unifiName, interval, 'ap', {
          start,
          end,
          attrs: [...STAT_REPORT_ATTRS],
        });
        // Resolve device_id para cada AP referenciado.
        const macsSeen = new Set<string>();
        const macToDeviceId = new Map<string, string>();
        for (const p of apPoints) {
          if (typeof p.ap === 'string') macsSeen.add(p.ap.toLowerCase());
        }
        for (const mac of macsSeen) {
          const existing = await findDeviceByMac(db, payload.controllerId, mac);
          if (existing) {
            macToDeviceId.set(mac, existing.id);
            continue;
          }
          // Device desconhecido (offline ou ainda não coletado em tempo real):
          // criamos placeholder pra preservar a relação.
          const id = await upsertDevice(db, {
            controllerId: payload.controllerId,
            siteId: site.id,
            mac,
            name: null,
            model: null,
            type: 'uap',
            seenAt: start,
          });
          macToDeviceId.set(mac, id);
        }

        const apSamples: HistoricalSample[] = [];
        for (const p of apPoints) {
          const parsed = parseStatReportPoint(p, {
            controllerId: payload.controllerId,
            siteId: site.id,
            subject: 'ap',
          });
          if (!parsed) continue;
          const deviceId = parsed.deviceMac ? (macToDeviceId.get(parsed.deviceMac) ?? null) : null;
          apSamples.push(toHistoricalSample(parsed, granularity, deviceId));
        }
        const apPersist = await insertHistoricalSamples(db, table, apSamples);
        sitePointsFetched += apPoints.length;
        siteInserted += apPersist.inserted;
        siteSkipped += apPersist.skipped;
      } catch (err) {
        const msg = errMsg(err);
        result.errors.push({ site: site.unifiName, interval, message: msg });
        log.warn({ err: msg, site: site.unifiName, interval }, 'falha no backfill do site');
      }
    }

    if (sitePointsFetched > 0) result.sitesProcessed += 1;
    result.pointsFetched += sitePointsFetched;
    result.samplesInserted += siteInserted;
    result.samplesSkipped += siteSkipped;
    log.info(
      {
        site: site.unifiName,
        pointsFetched: sitePointsFetched,
        inserted: siteInserted,
        skipped: siteSkipped,
      },
      'backfill do site concluído',
    );
  }

  log.info(
    {
      sitesProcessed: result.sitesProcessed,
      pointsFetched: result.pointsFetched,
      samplesInserted: result.samplesInserted,
      samplesSkipped: result.samplesSkipped,
      errors: result.errors.length,
    },
    'backfill concluído',
  );
  return result;
}

function toHistoricalSample(
  parsed: HistoricalSampleInput,
  granularity: '5m' | '1h' | '1d',
  deviceId: string | null,
): HistoricalSample {
  return {
    ts: bucketTs(parsed.ts, granularity),
    controllerId: parsed.controllerId,
    siteId: parsed.siteId,
    deviceId,
    dTxBytes: parsed.dTxBytes,
    dTxPackets: parsed.dTxPackets,
    dTxDropped: parsed.dTxDropped,
    clientCount: parsed.clientCount,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const BACKFILL_MAX_DAYS = 365;
