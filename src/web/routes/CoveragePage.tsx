import { useMemo, useState } from 'react';
import { diagnoseClient } from '../../shared/diagnostics.ts';
import { useClientCoverage } from '../api/queries/health.ts';
import { FilterBar, type FilterValue } from '../components/FilterBar.tsx';
import { SeverityBadge } from '../components/SeverityBadge.tsx';
import { Card } from '../components/ui/Card.tsx';
import { QueryState } from '../components/ui/QueryState.tsx';
import { formatNumber, formatRelative } from '../lib/format.ts';

export function CoveragePage() {
  const [filter, setFilter] = useState<FilterValue>({});
  const coverage = useClientCoverage({ ...filter, sinceSeconds: 900, limit: 500 });
  const thresholds = coverage.data?.thresholds;
  const rows = coverage.data?.rows ?? [];
  const histogram = coverage.data?.histogram ?? [];

  const enriched = useMemo(() => {
    if (!thresholds) return [];
    return rows.map((c) => {
      const diagnosis = diagnoseClient(
        {
          signal: c.signal,
          noise: c.noise,
          txRateKbps: c.txRateKbps,
          rxRateKbps: c.rxRateKbps,
          roamCount: c.roamCount,
        },
        thresholds,
      );
      return { client: c, diagnosis };
    });
  }, [rows, thresholds]);

  const counts = useMemo(() => {
    let critical = 0;
    let warning = 0;
    let ok = 0;
    for (const e of enriched) {
      if (e.diagnosis?.severity === 'critical') critical += 1;
      else if (e.diagnosis?.severity === 'warning') warning += 1;
      else ok += 1;
    }
    return { critical, warning, ok };
  }, [enriched]);

  const top20Worst = useMemo(
    () =>
      [...enriched].sort((a, b) => (a.client.signal ?? 0) - (b.client.signal ?? 0)).slice(0, 20),
    [enriched],
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard label="Clientes ativos" value={formatNumber(rows.length)} />
        <KpiCard label="Saudáveis" value={formatNumber(counts.ok)} tone="ok" />
        <KpiCard label="Em atenção" value={formatNumber(counts.warning)} tone="warning" />
        <KpiCard label="Críticos" value={formatNumber(counts.critical)} tone="critical" />
      </div>

      <Card
        title="Distribuição de RSSI"
        actions={<FilterBar value={filter} onChange={setFilter} />}
      >
        <RssiHistogram cells={histogram} />
      </Card>

      <Card title="Top 20 clientes com pior cobertura">
        <QueryState
          isLoading={coverage.isLoading}
          isError={coverage.isError}
          error={coverage.error}
          isEmpty={top20Worst.length === 0}
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Cliente</th>
                  <th className="py-2 pr-3">AP</th>
                  <th className="py-2 pr-3">SSID</th>
                  <th className="py-2 pr-3">Banda</th>
                  <th className="py-2 pr-3">Sinal</th>
                  <th className="py-2 pr-3">Taxa TX</th>
                  <th className="py-2 pr-3">Roams</th>
                  <th className="py-2 pr-3">Visto</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Diagnóstico</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {top20Worst.map(({ client, diagnosis }) => (
                  <tr key={client.clientMac}>
                    <td className="py-2 pr-3 font-mono text-xs">{client.clientMac}</td>
                    <td className="py-2 pr-3 text-xs">
                      {client.apAlias ?? client.apName ?? client.apMac ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-xs">{client.essid ?? '—'}</td>
                    <td className="py-2 pr-3 text-xs uppercase">{client.radio ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {client.signal !== null ? `${client.signal.toFixed(0)} dBm` : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      {client.txRateKbps !== null
                        ? `${(client.txRateKbps / 1000).toFixed(0)} Mbps`
                        : '—'}
                    </td>
                    <td className="py-2 pr-3">{client.roamCount ?? '—'}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">
                      {formatRelative(client.ts * 1000)}
                    </td>
                    <td className="py-2 pr-3">
                      <SeverityBadge severity={diagnosis?.severity ?? 'ok'} />
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {diagnosis && diagnosis.severity !== 'ok' ? (
                        <div className="space-y-1">
                          <div className="text-slate-700 dark:text-slate-300">
                            {diagnosis.message}
                          </div>
                          <div className="italic text-slate-500">💡 {diagnosis.recommendation}</div>
                        </div>
                      ) : (
                        <span className="text-slate-400">OK</span>
                      )}
                    </td>
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

/** Histograma horizontal simples (sem ECharts) — bins de -100 a -30 dBm. */
function RssiHistogram({ cells }: { cells: Array<{ bin: number; count: number }> }) {
  const maxCount = Math.max(1, ...cells.map((c) => c.count));
  // Garante todos os bins de -30 até -100, mesmo os zerados.
  const allBins: number[] = [];
  for (let b = -30; b >= -100; b -= 5) allBins.push(b);
  const map = new Map(cells.map((c) => [c.bin, c.count]));
  return (
    <div className="space-y-1">
      {allBins.map((b) => {
        const count = map.get(b) ?? 0;
        const pct = (count / maxCount) * 100;
        const tone = b >= -65 ? 'bg-emerald-400' : b >= -75 ? 'bg-amber-400' : 'bg-red-500';
        return (
          <div key={b} className="flex items-center gap-2 text-xs">
            <div className="w-20 text-right font-mono text-slate-500">
              {b === -100 ? 'sem sinal' : `${b} dBm`}
            </div>
            <div className="flex h-5 flex-1 items-center overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-5 ${tone}`}
                style={{ width: `${Math.max(pct, count > 0 ? 1 : 0)}%` }}
              />
              <span className="ml-2 text-slate-600 dark:text-slate-300">{count}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warning' | 'critical';
}) {
  const toneClass =
    tone === 'critical'
      ? 'border-red-300 dark:border-red-900'
      : tone === 'warning'
        ? 'border-amber-300 dark:border-amber-900'
        : tone === 'ok'
          ? 'border-emerald-300 dark:border-emerald-900'
          : 'border-slate-200 dark:border-slate-800';
  return (
    <div className={`rounded-2xl border bg-white px-5 py-4 dark:bg-slate-900 ${toneClass}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
