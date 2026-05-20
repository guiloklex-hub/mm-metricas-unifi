import type { DB } from '@server/db/client.ts';
import { markControllerError, markControllerSeen } from '@server/db/queries/controllers.ts';
import { upsertDevice } from '@server/db/queries/devices.ts';
import {
  insertSamples5m,
  insertVapSamples5m,
  type MetricSampleInput,
  type VapSampleInput,
} from '@server/db/queries/metrics-write.ts';
import { listEnabledSitesByController, upsertSite } from '@server/db/queries/sites.ts';
import type { UnifiClient } from '@server/unifi/client.ts';
import {
  computeSiteAggregate,
  type ParsedSample,
  parseClientPayload,
  parseDevicePayload,
  parseVapTable,
} from '@server/unifi/parser.ts';
import { bucketTs, nowSeconds } from '@server/utils/time.ts';
import type { Logger } from 'pino';
import type { UnifiClientPool } from '../clients-pool.ts';

export interface CollectJobPayload {
  controllerId: string;
}

export interface CollectJobResult {
  controllerId: string;
  sitesPolled: number;
  samplesInserted: number;
  resetSignals: number;
  errors: Array<{ site: string; message: string }>;
}

export interface CollectJobDeps {
  db: DB;
  pool: UnifiClientPool;
  logger: Logger;
}

/**
 * Executa uma coleta completa para um controller:
 *   1) fetchSites + sincroniza catálogo `sites` (cria os que ainda não existem).
 *   2) Para cada site habilitado:
 *        - fetchDevices → parser → ParsedSample[] (por rádio + agregado por AP).
 *        - fetchClients → parser → ParsedSample[] (por cliente).
 *        - computeSiteAggregate → ParsedSample (agregado de site).
 *        - Mapeia para MetricSampleInput[] resolvendo deviceMac → deviceId (upsert).
 *        - insertSamples5m em uma transação por site.
 *   3) Marca `controllers.last_seen_at` no sucesso; `last_error` na falha.
 *
 * Falhas individuais por site são contidas: o job continua para os outros e
 * só falha em bloco se for um erro de sessão/autenticação (que afeta tudo).
 */
export async function runCollectJob(
  payload: CollectJobPayload,
  deps: CollectJobDeps,
): Promise<CollectJobResult> {
  const { db, pool, logger } = deps;
  const log = logger.child({ jobKind: 'collect', controllerId: payload.controllerId });

  const result: CollectJobResult = {
    controllerId: payload.controllerId,
    sitesPolled: 0,
    samplesInserted: 0,
    resetSignals: 0,
    errors: [],
  };

  let client: UnifiClient;
  try {
    client = await pool.getOrCreate(payload.controllerId);
  } catch (err) {
    const msg = errMsg(err);
    markControllerError(db, payload.controllerId, `client: ${msg}`);
    throw err;
  }

  // Sincroniza catálogo de sites.
  let remoteSites: Array<{ _id?: string; name: string; desc?: string }>;
  try {
    remoteSites = await client.fetchSites();
  } catch (err) {
    const msg = errMsg(err);
    markControllerError(db, payload.controllerId, `fetchSites: ${msg}`);
    throw err;
  }

  for (const s of remoteSites) {
    if (!s.name) continue;
    upsertSite(db, payload.controllerId, {
      unifiId: s._id ?? s.name,
      unifiName: s.name,
      displayName: s.desc ?? s.name,
    });
  }

  const enabledSites = listEnabledSitesByController(db, payload.controllerId);
  const bucket = bucketTs(nowSeconds(), '5m');

  for (const site of enabledSites) {
    try {
      const { metrics, vap } = await collectSite(
        client,
        payload.controllerId,
        site,
        bucket,
        db,
        log,
      );
      const metricsRes = insertSamples5m(db, metrics);
      const vapRes = insertVapSamples5m(db, vap);
      result.sitesPolled += 1;
      result.samplesInserted += metricsRes.inserted + vapRes.inserted;
      result.resetSignals += metricsRes.resetSignals + vapRes.resetSignals;
      log.debug(
        {
          site: site.unifiName,
          metricsInserted: metricsRes.inserted,
          vapInserted: vapRes.inserted,
        },
        'site coletado',
      );
    } catch (err) {
      const msg = errMsg(err);
      result.errors.push({ site: site.unifiName, message: msg });
      log.warn({ err: msg, site: site.unifiName }, 'falha coletando site');
    }
  }

  if (result.errors.length === enabledSites.length && enabledSites.length > 0) {
    // Todos os sites falharam — sinaliza erro global no controller.
    markControllerError(
      db,
      payload.controllerId,
      `todos os sites falharam (último erro: ${result.errors.at(-1)?.message})`,
    );
  } else {
    markControllerSeen(db, payload.controllerId);
    // Falha parcial: deixa registro visível no log para diagnóstico, mas não
    // marca o controller como down. O markControllerSeen mantém lastSeenAt
    // limpo já que pelo menos 1 site respondeu.
    if (result.errors.length > 0) {
      log.warn(
        {
          totalSites: enabledSites.length,
          failedSites: result.errors.map((e) => e.site),
          firstError: result.errors[0]?.message,
        },
        'falha parcial: alguns sites do controller não puderam ser coletados',
      );
    }
  }

  return result;
}

async function collectSite(
  client: UnifiClient,
  controllerId: string,
  site: { id: string; unifiName: string },
  bucket: number,
  db: DB,
  log: Logger,
): Promise<{ metrics: MetricSampleInput[]; vap: VapSampleInput[] }> {
  const [devicesPayload, clientsPayload] = await Promise.all([
    client.fetchDevices(site.unifiName),
    client.fetchClients(site.unifiName),
  ]);

  const parsedDevices = devicesPayload
    .map((d) => parseDevicePayload(d))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Upsert devices catálogo (recupera id → mac).
  const macToDeviceId = new Map<string, string>();
  const seenAt = bucket * 1000;
  for (const r of parsedDevices) {
    const id = upsertDevice(db, {
      controllerId,
      siteId: site.id,
      mac: r.device.mac,
      name: r.device.name,
      model: r.device.model,
      type: r.device.type,
      seenAt,
      version: r.device.version,
      serial: r.device.serial,
      state: r.device.state,
    });
    macToDeviceId.set(r.device.mac, id);
  }

  // Coleta amostras de devices + rádios.
  const all: MetricSampleInput[] = [];
  const deviceSamples: ParsedSample[] = [];
  for (const r of parsedDevices) {
    for (const sample of r.samples) {
      const deviceId = sample.deviceMac ? (macToDeviceId.get(sample.deviceMac) ?? null) : null;
      all.push(toMetricInput(sample, controllerId, site.id, bucket, deviceId));
      deviceSamples.push(sample);
    }
  }

  // Site aggregate (a partir dos device aggregates, sem rádio nem cliente).
  const siteAgg = computeSiteAggregate(deviceSamples);
  all.push(toMetricInput(siteAgg, controllerId, site.id, bucket, null));

  // Clientes.
  for (const c of clientsPayload) {
    const parsed = parseClientPayload(c);
    if (!parsed) continue;
    const deviceId = parsed.deviceMac ? (macToDeviceId.get(parsed.deviceMac) ?? null) : null;
    all.push(toMetricInput(parsed, controllerId, site.id, bucket, deviceId));
  }

  // VAP (SSID × rádio): coleta paralela aos contadores principais. Mesmo
  // bucket de timestamp; gravados em tabela separada `metrics_vap_5m`.
  // parseVapTable normaliza o MAC do device para o formato canônico, então
  // o lookup no macToDeviceId funciona consistente com parseDevicePayload.
  const vap: VapSampleInput[] = [];
  for (const raw of devicesPayload) {
    for (const v of parseVapTable(raw)) {
      const deviceId = macToDeviceId.get(v.deviceMac);
      if (!deviceId) continue; // VAP de device que falhou no parseDevicePayload — pular
      vap.push({
        ts: bucket,
        controllerId,
        siteId: site.id,
        deviceId,
        radio: v.radio,
        ssid: v.ssid,
        numSta: v.numSta,
        isGuest: v.isGuest,
        avgClientSignal: v.avgClientSignal,
        txBytes: v.txBytes,
        rxBytes: v.rxBytes,
        macFilterRejections: v.macFilterRejections,
      });
    }
  }

  log.debug(
    {
      devices: parsedDevices.length,
      clients: clientsPayload.length,
      vapSamples: vap.length,
      samples: all.length,
    },
    'coletado',
  );
  return { metrics: all, vap };
}

function toMetricInput(
  sample: ParsedSample,
  controllerId: string,
  siteId: string,
  ts: number,
  deviceId: string | null,
): MetricSampleInput {
  return {
    ts,
    controllerId,
    siteId,
    deviceId,
    radio: sample.radio,
    clientMac: sample.clientMac,
    clientCount: sample.clientCount,
    txBytes: sample.txBytes,
    txPackets: sample.txPackets,
    txDropped: sample.txDropped,
    txErrors: sample.txErrors,
    txRetries: sample.txRetries,
    rxBytes: sample.rxBytes,
    rxPackets: sample.rxPackets,
    rxDropped: sample.rxDropped,
    rxErrors: sample.rxErrors,
    wifiTxAttempts: sample.wifiTxAttempts,
    wifiTxDropped: sample.wifiTxDropped,
    rxCrypts: sample.rxCrypts,
    macFilterRejections: sample.macFilterRejections,
    numRoamEvents: sample.numRoamEvents,
    cpuPct: sample.cpuPct,
    memPct: sample.memPct,
    uptimeSec: sample.uptimeSec,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
