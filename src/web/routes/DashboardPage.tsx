import { useMemo, useState } from 'react';
import { useControllers } from '../api/queries/controllers.ts';
import { useMetricsRecent, useMetricsStatus } from '../api/queries/metrics.ts';
import { type HeatmapCell, HourlyHeatmap } from '../components/charts/HourlyHeatmap.tsx';
import { TimeSeriesChart, type TimeSeriesSeries } from '../components/charts/TimeSeriesChart.tsx';
import { Card } from '../components/ui/Card.tsx';
import { formatBytes, formatNumber, formatRate, formatRelative } from '../lib/format.ts';

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

  const series = useMemo(() => groupSeries(recent.data?.rows ?? []), [recent.data]);
  const tableRows = useMemo(() => summarizeDevices(recent.data?.rows ?? []), [recent.data]);
  const heatmapCells = useMemo<HeatmapCell[]>(
    () =>
      (recent.data?.rows ?? [])
        .filter((r) => r.deviceId !== null && r.radio === null && r.clientMac === null)
        .map((r) => ({ ts: r.ts, value: r.retryRate })),
    [recent.data],
  );

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
        {recent.isLoading ? (
          <p className="text-sm text-slate-500">Carregando…</p>
        ) : series.length === 0 ? (
          <p className="text-sm text-slate-500">
            Sem amostras nesta janela. Cadastre um controller e aguarde a primeira coleta.
          </p>
        ) : (
          <TimeSeriesChart
            series={series}
            yLabel="Bytes / janela"
            formatY={(v) => formatBytes(v)}
          />
        )}
      </Card>

      <Card title="Taxa de retransmissão — hora × dia">
        {heatmapCells.length === 0 ? (
          <p className="text-sm text-slate-500">
            Sem amostras suficientes na janela selecionada para o heatmap.
          </p>
        ) : (
          <HourlyHeatmap cells={heatmapCells} formatValue={(v) => formatRate(v)} />
        )}
      </Card>

      <Card title="Resumo por AP">
        {tableRows.length === 0 ? (
          <p className="text-sm text-slate-500">Nada para mostrar ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Device</th>
                  <th className="px-3 py-2">Amostras</th>
                  <th className="px-3 py-2">Bytes Tx</th>
                  <th className="px-3 py-2">Pkts Tx</th>
                  <th className="px-3 py-2">Retx (médio)</th>
                  <th className="px-3 py-2">Erros (médio)</th>
                  <th className="px-3 py-2">Drop (médio)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {tableRows.map((r) => (
                  <tr key={r.deviceId}>
                    <td className="px-3 py-2 font-mono text-xs">{r.deviceId}</td>
                    <td className="px-3 py-2">{r.samples}</td>
                    <td className="px-3 py-2">{formatBytes(r.totalBytes)}</td>
                    <td className="px-3 py-2">{formatNumber(r.totalPackets)}</td>
                    <td className="px-3 py-2">{formatRate(r.avgRetryRate)}</td>
                    <td className="px-3 py-2">{formatRate(r.avgErrorRate)}</td>
                    <td className="px-3 py-2">{formatRate(r.avgDropRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
): TimeSeriesSeries[] {
  const byDevice = new Map<string, Array<{ ts: number; value: number | null }>>();
  for (const r of rows) {
    if (!r.deviceId) continue;
    if (!byDevice.has(r.deviceId)) byDevice.set(r.deviceId, []);
    byDevice.get(r.deviceId)!.push({ ts: r.ts, value: r.dTxBytes });
  }
  return [...byDevice.entries()].map(([deviceId, data]) => ({
    name: deviceId.slice(0, 10),
    data,
  }));
}

interface DeviceRowSummary {
  deviceId: string;
  samples: number;
  totalBytes: number;
  totalPackets: number;
  avgRetryRate: number | null;
  avgErrorRate: number | null;
  avgDropRate: number | null;
}

function summarizeDevices(
  rows: Array<{
    deviceId: string | null;
    dTxBytes: number | null;
    dTxPackets: number | null;
    retryRate: number | null;
    errorRate: number | null;
    dropRate: number | null;
  }>,
): DeviceRowSummary[] {
  const acc = new Map<
    string,
    DeviceRowSummary & {
      _retrySum: number;
      _retryN: number;
      _errSum: number;
      _errN: number;
      _dropSum: number;
      _dropN: number;
    }
  >();
  for (const r of rows) {
    if (!r.deviceId) continue;
    let cur = acc.get(r.deviceId);
    if (!cur) {
      cur = {
        deviceId: r.deviceId,
        samples: 0,
        totalBytes: 0,
        totalPackets: 0,
        avgRetryRate: null,
        avgErrorRate: null,
        avgDropRate: null,
        _retrySum: 0,
        _retryN: 0,
        _errSum: 0,
        _errN: 0,
        _dropSum: 0,
        _dropN: 0,
      };
      acc.set(r.deviceId, cur);
    }
    cur.samples += 1;
    cur.totalBytes += r.dTxBytes ?? 0;
    cur.totalPackets += r.dTxPackets ?? 0;
    if (r.retryRate != null) {
      cur._retrySum += r.retryRate;
      cur._retryN += 1;
    }
    if (r.errorRate != null) {
      cur._errSum += r.errorRate;
      cur._errN += 1;
    }
    if (r.dropRate != null) {
      cur._dropSum += r.dropRate;
      cur._dropN += 1;
    }
  }
  const out: DeviceRowSummary[] = [];
  for (const v of acc.values()) {
    out.push({
      deviceId: v.deviceId,
      samples: v.samples,
      totalBytes: v.totalBytes,
      totalPackets: v.totalPackets,
      avgRetryRate: v._retryN ? v._retrySum / v._retryN : null,
      avgErrorRate: v._errN ? v._errSum / v._errN : null,
      avgDropRate: v._dropN ? v._dropSum / v._dropN : null,
    });
  }
  return out.sort((a, b) => b.totalBytes - a.totalBytes);
}
