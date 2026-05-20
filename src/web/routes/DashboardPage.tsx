import { useMemo, useState } from 'react';
import { useControllers } from '../api/queries/controllers.ts';
import { useDevices } from '../api/queries/devices.ts';
import { useMetricsRecent, useMetricsStatus } from '../api/queries/metrics.ts';
import { useTopTalkers } from '../api/queries/top-talkers.ts';
import { useVapRecent, type VapRow } from '../api/queries/vap-metrics.ts';
import { type HeatmapCell, HourlyHeatmap } from '../components/charts/HourlyHeatmap.tsx';
import { TimeSeriesChart, type TimeSeriesSeries } from '../components/charts/TimeSeriesChart.tsx';
import { Card } from '../components/ui/Card.tsx';
import { QueryState } from '../components/ui/QueryState.tsx';
import { deviceLabelWithMac } from '../lib/device-label.ts';
import {
  formatBytes,
  formatNumber,
  formatPercent,
  formatRate,
  formatRelative,
  formatUptime,
} from '../lib/format.ts';

type Window = '6h' | '24h' | '7d';

const WINDOW_SECONDS: Record<Window, number> = {
  '6h': 6 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 86400,
};

export function DashboardPage() {
  const status = useMetricsStatus();
  const controllers = useControllers();
  const [windowKey, setWindowKey] = useState<Window>('24h');
  const [controllerId, setControllerId] = useState<string | undefined>(undefined);

  const recent = useMetricsRecent({
    seconds: WINDOW_SECONDS[windowKey],
    controllerId,
    groupBy: 'device',
  });
  const devices = useDevices(controllerId ? { controllerId } : {});

  const aliasMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of devices.data ?? []) {
      map.set(d.id, deviceLabelWithMac(d));
    }
    return map;
  }, [devices.data]);

  const series = useMemo(
    () => groupSeries(recent.data?.rows ?? [], aliasMap),
    [recent.data, aliasMap],
  );
  const tableRows = useMemo(
    () => summarizeDevices(recent.data?.rows ?? [], aliasMap),
    [recent.data, aliasMap],
  );
  const heatmapCells = useMemo<HeatmapCell[]>(
    () =>
      (recent.data?.rows ?? [])
        .filter((r) => r.deviceId !== null && r.radio === null && r.clientMac === null)
        .map((r) => ({ ts: r.ts, value: r.retryRate })),
    [recent.data],
  );
  const topTalkers = useTopTalkers({
    seconds: WINDOW_SECONDS[windowKey],
    controllerId,
    limit: 10,
  });
  const vap = useVapRecent({
    seconds: WINDOW_SECONDS[windowKey],
    controllerId,
  });
  const bandSummary = useMemo(() => summarizeBands(vap.data?.rows ?? []), [vap.data]);
  const ssidSummary = useMemo(() => summarizeSsids(vap.data?.rows ?? []), [vap.data]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Amostras 5min" value={formatNumber(status.data?.rows['5m'])} />
        <SummaryCard label="Amostras 1h" value={formatNumber(status.data?.rows['1h'])} />
        <SummaryCard
          label="Última coleta"
          value={status.data?.latestSample ? formatRelative(status.data.latestSample * 1000) : '—'}
        />
        <SummaryCard
          label="Jobs ativos"
          value={`${status.data?.jobs.pending ?? 0} pendentes · ${
            status.data?.jobs.running ?? 0
          } executando`}
        />
      </div>

      <Card
        title="Tráfego transmitido (por AP)"
        actions={
          <div className="flex items-center gap-2 text-sm">
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
              value={controllerId ?? ''}
              onChange={(e) => setControllerId(e.target.value || undefined)}
            >
              <option value="">Todos os controllers</option>
              {controllers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="flex rounded-md border border-slate-300 dark:border-slate-700">
              {(Object.keys(WINDOW_SECONDS) as Window[]).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWindowKey(w)}
                  className={`px-2 py-1 text-xs ${
                    windowKey === w
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : ''
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <QueryState
          isLoading={recent.isLoading}
          isError={recent.isError}
          error={recent.error}
          isEmpty={series.length === 0}
          emptyText="Sem amostras nesta janela. Cadastre um controller e aguarde a primeira coleta."
        >
          <TimeSeriesChart
            series={series}
            yLabel="Bytes / janela"
            formatY={(v) => formatBytes(v)}
          />
        </QueryState>
      </Card>

      <Card title="Taxa de retransmissão — hora × dia">
        <QueryState
          isLoading={recent.isLoading}
          isError={recent.isError}
          error={recent.error}
          isEmpty={heatmapCells.length === 0}
          emptyText="Sem amostras suficientes na janela selecionada para o heatmap."
        >
          <HourlyHeatmap cells={heatmapCells} formatValue={(v) => formatRate(v)} />
        </QueryState>
      </Card>

      <Card title="Top talkers (clientes que mais consumiram)">
        <QueryState
          isLoading={topTalkers.isLoading}
          isError={topTalkers.isError}
          error={topTalkers.error}
          isEmpty={!topTalkers.data || topTalkers.data.rows.length === 0}
          emptyText="Sem dados de cliente nesta janela. Coletor precisa estar rodando há pelo menos um ciclo."
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Cliente (MAC)</th>
                  <th className="px-3 py-2">Bytes</th>
                  <th className="px-3 py-2">Pacotes</th>
                  <th className="px-3 py-2">Amostras</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {topTalkers.data?.rows.map((t) => (
                  <tr key={t.clientMac}>
                    <td className="px-3 py-2 font-mono text-xs">{t.clientMac}</td>
                    <td className="px-3 py-2">{formatBytes(t.totalBytes)}</td>
                    <td className="px-3 py-2">{formatNumber(t.totalPackets)}</td>
                    <td className="px-3 py-2">{t.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </Card>

      <Card title="Clientes por banda">
        <QueryState
          isLoading={vap.isLoading}
          isError={vap.isError}
          error={vap.error}
          isEmpty={bandSummary.totalSta === 0 && !vap.isLoading}
          emptyText="Sem dados de VAP na janela. Aguarde 1 ciclo de coleta após o redeploy."
        >
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <BandCounter label="2.4 GHz" value={bandSummary.ng} />
            <BandCounter label="5 GHz" value={bandSummary.na} />
            <BandCounter label="6 GHz" value={bandSummary.sixE} />
            <BandCounter label="Total" value={bandSummary.totalSta} highlight />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Pico de clientes simultâneos na janela selecionada, agregado entre todos os APs.
          </p>
        </QueryState>
      </Card>

      <Card title="Por SSID">
        <QueryState
          isLoading={vap.isLoading}
          isError={vap.isError}
          error={vap.error}
          isEmpty={ssidSummary.length === 0 && !vap.isLoading}
          emptyText="Sem dados de SSID na janela."
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">SSID</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2" title="Pico de clientes na janela">
                    Clientes (pico)
                  </th>
                  <th className="px-3 py-2">2.4 / 5 / 6 GHz</th>
                  <th className="px-3 py-2">Bytes Tx</th>
                  <th className="px-3 py-2">Bytes Rx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {ssidSummary.map((s) => (
                  <tr key={s.ssid}>
                    <td className="px-3 py-2 font-medium">{s.ssid}</td>
                    <td className="px-3 py-2 text-xs">
                      {s.isGuest ? (
                        <span className="rounded bg-yellow-100 px-2 py-0.5 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-200">
                          Guest
                        </span>
                      ) : (
                        <span className="text-slate-500">Corp</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-semibold">{formatNumber(s.maxClients)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {formatNumber(s.byBand.ng)} / {formatNumber(s.byBand.na)} /{' '}
                      {formatNumber(s.byBand.sixE)}
                    </td>
                    <td className="px-3 py-2">{formatBytes(s.totalBytes)}</td>
                    <td className="px-3 py-2">{formatBytes(s.totalRxBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </Card>

      <Card title="Resumo por AP">
        <QueryState
          isLoading={recent.isLoading}
          isError={recent.isError}
          error={recent.error}
          isEmpty={tableRows.length === 0}
          emptyText="Nada para mostrar ainda."
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Antena</th>
                  <th className="px-3 py-2">Amostras</th>
                  <th className="px-3 py-2" title="Maior número de clientes conectados na janela">
                    Clientes (máx)
                  </th>
                  <th className="px-3 py-2">Bytes Tx</th>
                  <th className="px-3 py-2">Bytes Rx</th>
                  <th className="px-3 py-2">Pkts Tx</th>
                  <th className="px-3 py-2">Drop (Tx)</th>
                  <th className="px-3 py-2">Drop (Rx)</th>
                  <th className="px-3 py-2">Erros (Tx)</th>
                  <th className="px-3 py-2">Erros (Rx)</th>
                  <th className="px-3 py-2">Retx</th>
                  <th className="px-3 py-2">Retx %</th>
                  <th className="px-3 py-2">Erro %</th>
                  <th className="px-3 py-2">Drop %</th>
                  <th
                    className="px-3 py-2"
                    title="CPU média do AP na janela (gauge)"
                  >
                    CPU %
                  </th>
                  <th
                    className="px-3 py-2"
                    title="Memória média do AP na janela (gauge)"
                  >
                    Mem %
                  </th>
                  <th
                    className="px-3 py-2"
                    title="Tempo desde o último boot do AP (segundos)"
                  >
                    Uptime
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {tableRows.map((r) => (
                  <tr key={r.deviceId}>
                    <td className="px-3 py-2 text-xs">{r.label}</td>
                    <td className="px-3 py-2">{r.samples}</td>
                    <td className="px-3 py-2">{formatNumber(r.maxClientCount)}</td>
                    <td className="px-3 py-2">{formatBytes(r.totalBytes)}</td>
                    <td className="px-3 py-2">{formatBytes(r.totalRxBytes)}</td>
                    <td className="px-3 py-2">{formatNumber(r.totalPackets)}</td>
                    <td className="px-3 py-2">{formatNumber(r.totalDropped)}</td>
                    <td className="px-3 py-2">{formatNumber(r.totalRxDropped)}</td>
                    <td className="px-3 py-2">{formatNumber(r.totalErrors)}</td>
                    <td className="px-3 py-2">{formatNumber(r.totalRxErrors)}</td>
                    <td className="px-3 py-2">{formatNumber(r.totalRetries)}</td>
                    <td className="px-3 py-2">{formatRate(r.avgRetryRate)}</td>
                    <td className="px-3 py-2">{formatRate(r.avgErrorRate)}</td>
                    <td className="px-3 py-2">{formatRate(r.avgDropRate)}</td>
                    <td className="px-3 py-2">{formatPercent(r.avgCpuPct)}</td>
                    <td className="px-3 py-2">{formatPercent(r.avgMemPct)}</td>
                    <td className="px-3 py-2">{formatUptime(r.lastUptimeSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function groupSeries(
  rows: Array<{ ts: number; deviceId: string | null; dTxBytes: number | null }>,
  aliasMap: Map<string, string>,
): TimeSeriesSeries[] {
  const byDevice = new Map<string, Array<{ ts: number; value: number | null }>>();
  for (const r of rows) {
    if (!r.deviceId) continue;
    if (!byDevice.has(r.deviceId)) byDevice.set(r.deviceId, []);
    byDevice.get(r.deviceId)!.push({ ts: r.ts, value: r.dTxBytes });
  }
  return [...byDevice.entries()].map(([deviceId, data]) => ({
    name: aliasMap.get(deviceId) ?? deviceId,
    data,
  }));
}

interface DeviceRowSummary {
  deviceId: string;
  label: string;
  samples: number;
  maxClientCount: number | null;
  totalBytes: number;
  totalPackets: number;
  totalDropped: number;
  totalErrors: number;
  totalRetries: number;
  totalRxBytes: number;
  totalRxDropped: number;
  totalRxErrors: number;
  avgRetryRate: number | null;
  avgErrorRate: number | null;
  avgDropRate: number | null;
  avgCpuPct: number | null;
  avgMemPct: number | null;
  lastUptimeSec: number | null;
}

function summarizeDevices(
  rows: Array<{
    deviceId: string | null;
    clientCount: number | null;
    dTxBytes: number | null;
    dTxPackets: number | null;
    dTxDropped: number | null;
    dTxErrors: number | null;
    dTxRetries: number | null;
    dWifiTxAttempts: number | null;
    dRxBytes: number | null;
    dRxDropped: number | null;
    dRxErrors: number | null;
    cpuPct: number | null;
    memPct: number | null;
    uptimeSec: number | null;
  }>,
  aliasMap: Map<string, string>,
): DeviceRowSummary[] {
  const acc = new Map<
    string,
    DeviceRowSummary & {
      _totalAttempts: number;
      _cpuSum: number;
      _cpuN: number;
      _memSum: number;
      _memN: number;
    }
  >();
  for (const r of rows) {
    if (!r.deviceId) continue;
    let cur = acc.get(r.deviceId);
    if (!cur) {
      cur = {
        deviceId: r.deviceId,
        label: aliasMap.get(r.deviceId) ?? 'Antena desconhecida',
        samples: 0,
        maxClientCount: null,
        totalBytes: 0,
        totalPackets: 0,
        totalDropped: 0,
        totalErrors: 0,
        totalRetries: 0,
        totalRxBytes: 0,
        totalRxDropped: 0,
        totalRxErrors: 0,
        avgRetryRate: null,
        avgErrorRate: null,
        avgDropRate: null,
        avgCpuPct: null,
        avgMemPct: null,
        lastUptimeSec: null,
        _totalAttempts: 0,
        _cpuSum: 0,
        _cpuN: 0,
        _memSum: 0,
        _memN: 0,
      };
      acc.set(r.deviceId, cur);
    }
    cur.samples += 1;
    cur.totalBytes += r.dTxBytes ?? 0;
    cur.totalPackets += r.dTxPackets ?? 0;
    cur.totalDropped += r.dTxDropped ?? 0;
    cur.totalErrors += r.dTxErrors ?? 0;
    cur.totalRetries += r.dTxRetries ?? 0;
    cur._totalAttempts += r.dWifiTxAttempts ?? 0;
    cur.totalRxBytes += r.dRxBytes ?? 0;
    cur.totalRxDropped += r.dRxDropped ?? 0;
    cur.totalRxErrors += r.dRxErrors ?? 0;
    if (r.clientCount != null) {
      cur.maxClientCount =
        cur.maxClientCount == null ? r.clientCount : Math.max(cur.maxClientCount, r.clientCount);
    }
    if (r.cpuPct != null) {
      cur._cpuSum += r.cpuPct;
      cur._cpuN += 1;
    }
    if (r.memPct != null) {
      cur._memSum += r.memPct;
      cur._memN += 1;
    }
    if (r.uptimeSec != null) {
      // Maior uptime na janela = mais recente (gauge monotônico). Captura
      // ultimo valor sem precisar de ordem temporal explícita das amostras.
      cur.lastUptimeSec =
        cur.lastUptimeSec == null ? r.uptimeSec : Math.max(cur.lastUptimeSec, r.uptimeSec);
    }
  }
  // Taxas via SUM(N)/SUM(D) — média ponderada pelo tráfego, não média
  // aritmética dos rates por amostra (que falseava o número quando havia
  // amostras com baixo tráfego e taxa alta). Denominador prefere
  // wifi_tx_attempts (tx_errors pode ser > tx_packets em UniFi).
  const out: DeviceRowSummary[] = [];
  for (const v of acc.values()) {
    const denom = v._totalAttempts || v.totalPackets;
    out.push({
      deviceId: v.deviceId,
      label: v.label,
      samples: v.samples,
      maxClientCount: v.maxClientCount,
      totalBytes: v.totalBytes,
      totalPackets: v.totalPackets,
      totalDropped: v.totalDropped,
      totalErrors: v.totalErrors,
      totalRetries: v.totalRetries,
      totalRxBytes: v.totalRxBytes,
      totalRxDropped: v.totalRxDropped,
      totalRxErrors: v.totalRxErrors,
      avgRetryRate: denom > 0 ? v.totalRetries / denom : null,
      avgErrorRate: denom > 0 ? v.totalErrors / denom : null,
      avgDropRate: denom > 0 ? v.totalDropped / denom : null,
      avgCpuPct: v._cpuN ? v._cpuSum / v._cpuN : null,
      avgMemPct: v._memN ? v._memSum / v._memN : null,
      lastUptimeSec: v.lastUptimeSec,
    });
  }
  return out.sort((a, b) => b.totalBytes - a.totalBytes);
}

/* -------------------------- VAP (SSID × banda) -------------------------- */

interface BandSummary {
  ng: number;
  na: number;
  sixE: number;
  totalSta: number;
}

/**
 * Soma os picos de num_sta por (device × radio × ssid). Esse total é "clientes
 * únicos por banda no momento de pico", não a soma de todos os tempos —
 * usamos `MAX` no último timestamp da janela para ter snapshot atual.
 */
function summarizeBands(rows: VapRow[]): BandSummary {
  if (rows.length === 0) return { ng: 0, na: 0, sixE: 0, totalSta: 0 };
  // Pega só o último ts (snapshot mais recente) — soma num_sta cross-VAP.
  let maxTs = 0;
  for (const r of rows) if (r.ts > maxTs) maxTs = r.ts;
  const sum = { ng: 0, na: 0, sixE: 0 };
  for (const r of rows) {
    if (r.ts !== maxTs) continue;
    if (r.numSta == null) continue;
    if (r.radio === 'ng') sum.ng += r.numSta;
    else if (r.radio === 'na') sum.na += r.numSta;
    else if (r.radio === '6e') sum.sixE += r.numSta;
  }
  return { ...sum, totalSta: sum.ng + sum.na + sum.sixE };
}

interface SsidSummaryRow {
  ssid: string;
  isGuest: boolean;
  maxClients: number;
  totalBytes: number;
  totalRxBytes: number;
  byBand: { ng: number; na: number; sixE: number };
}

function summarizeSsids(rows: VapRow[]): SsidSummaryRow[] {
  // Encontra ts mais recente para o "snapshot" de clientes por banda.
  let maxTs = 0;
  for (const r of rows) if (r.ts > maxTs) maxTs = r.ts;
  type Agg = SsidSummaryRow;
  const acc = new Map<string, Agg>();
  for (const r of rows) {
    let cur = acc.get(r.ssid);
    if (!cur) {
      cur = {
        ssid: r.ssid,
        isGuest: false,
        maxClients: 0,
        totalBytes: 0,
        totalRxBytes: 0,
        byBand: { ng: 0, na: 0, sixE: 0 },
      };
      acc.set(r.ssid, cur);
    }
    if (r.isGuest === true) cur.isGuest = true;
    cur.totalBytes += r.dTxBytes ?? 0;
    cur.totalRxBytes += r.dRxBytes ?? 0;
    // Por-banda counts só no snapshot mais recente (gauge).
    if (r.ts === maxTs && r.numSta != null) {
      if (r.radio === 'ng') cur.byBand.ng += r.numSta;
      else if (r.radio === 'na') cur.byBand.na += r.numSta;
      else if (r.radio === '6e') cur.byBand.sixE += r.numSta;
    }
  }
  for (const v of acc.values()) {
    v.maxClients = v.byBand.ng + v.byBand.na + v.byBand.sixE;
  }
  return [...acc.values()].sort((a, b) => b.maxClients - a.maxClients);
}

function BandCounter({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        highlight
          ? 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          highlight ? 'text-blue-900 dark:text-blue-200' : ''
        }`}
      >
        {value.toLocaleString('pt-BR')}
      </p>
    </div>
  );
}
