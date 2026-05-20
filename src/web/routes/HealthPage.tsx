import { useMemo, useState } from 'react';
import { classifyBand, diagnoseDevice, diagnoseRadio, worst } from '../../shared/diagnostics.ts';
import { useApHealth, useHealthSummary } from '../api/queries/health.ts';
import { FilterBar, type FilterValue } from '../components/FilterBar.tsx';
import { SeverityBadge } from '../components/SeverityBadge.tsx';
import { Card } from '../components/ui/Card.tsx';
import { QueryState } from '../components/ui/QueryState.tsx';
import { formatNumber, formatPercent, formatRelative } from '../lib/format.ts';

export function HealthPage() {
  const [filter, setFilter] = useState<FilterValue>({});
  const summary = useHealthSummary(filter);
  const aps = useApHealth({ ...filter, sinceSeconds: 900 });

  const thresholds = aps.data?.thresholds;
  const rows = aps.data?.rows ?? [];

  // Pre-calcula diagnóstico de cada AP para ordenar e contar severidades.
  const enriched = useMemo(() => {
    if (!thresholds) return [];
    return rows.map((ap) => {
      const radios = ap.radios.map((r) => {
        const band = classifyBand(r.channel, r.radio);
        const d = diagnoseRadio(
          {
            channel: r.channel,
            cuTotal: r.cuTotal,
            txPower: r.txPower,
            numSta: r.numSta,
            retryRate: ap.retryRate,
            band,
          },
          thresholds,
        );
        return { ...r, band, diagnosis: d };
      });
      const deviceDiag = diagnoseDevice(
        {
          cpuPct: ap.cpuPct,
          memPct: ap.memPct,
          tempCpu: ap.tempCpu,
          tempBoard: ap.tempBoard,
        },
        thresholds,
      );
      const severity = worst(
        deviceDiag?.severity ?? 'ok',
        ...radios.map((r) => r.diagnosis?.severity ?? 'ok'),
      );
      return { ap, radios, deviceDiag, severity };
    });
  }, [rows, thresholds]);

  const sorted = useMemo(
    () =>
      [...enriched].sort((a, b) => {
        const order = { critical: 0, warning: 1, ok: 2 };
        return order[a.severity] - order[b.severity];
      }),
    [enriched],
  );

  const counts = useMemo(() => {
    let critical = 0;
    let warning = 0;
    let ok = 0;
    for (const e of enriched) {
      if (e.severity === 'critical') critical += 1;
      else if (e.severity === 'warning') warning += 1;
      else ok += 1;
    }
    return { critical, warning, ok, total: enriched.length };
  }, [enriched]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard label="Total de APs" value={formatNumber(summary.data?.summary.apsTotal ?? 0)} />
        <KpiCard label="Saudáveis" value={formatNumber(counts.ok)} tone="ok" />
        <KpiCard label="Em atenção" value={formatNumber(counts.warning)} tone="warning" />
        <KpiCard label="Críticos" value={formatNumber(counts.critical)} tone="critical" />
      </div>

      <Card title="Saúde dos APs" actions={<FilterBar value={filter} onChange={setFilter} />}>
        <QueryState
          isLoading={aps.isLoading}
          isError={aps.isError}
          error={aps.error}
          isEmpty={(aps.data?.rows ?? []).length === 0}
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">AP</th>
                  <th className="py-2 pr-3">Site</th>
                  <th className="py-2 pr-3">Rádios</th>
                  <th className="py-2 pr-3">Clientes</th>
                  <th className="py-2 pr-3">CPU / Mem / Temp</th>
                  <th className="py-2 pr-3">Retry</th>
                  <th className="py-2 pr-3">Visto</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Diagnóstico</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sorted.map(({ ap, radios, deviceDiag, severity }) => {
                  const totalClients = radios.reduce((sum, r) => sum + (r.numSta ?? 0), 0);
                  const peakTemp = Math.max(ap.tempCpu ?? -Infinity, ap.tempBoard ?? -Infinity);
                  const tempStr = peakTemp > -Infinity ? `${peakTemp.toFixed(0)} °C` : '—';
                  const radioMsgs = radios
                    .filter((r) => r.diagnosis && r.diagnosis.severity !== 'ok')
                    .map((r) => `${r.radio.toUpperCase()}: ${r.diagnosis?.message}`);
                  const messages: string[] = [];
                  if (deviceDiag && deviceDiag.severity !== 'ok') {
                    messages.push(deviceDiag.message);
                  }
                  messages.push(...radioMsgs);
                  return (
                    <tr key={ap.deviceId}>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{ap.alias ?? ap.name ?? ap.mac}</div>
                        <div className="text-xs text-slate-500">
                          {ap.model ?? ''} · {ap.mac}
                        </div>
                      </td>
                      <td className="py-2 pr-3">{ap.siteName ?? '—'}</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-col gap-1">
                          {radios.map((r) => (
                            <div key={r.radio} className="text-xs">
                              <span className="font-medium uppercase">{r.radio}</span> ch{' '}
                              {r.channel ?? '?'} ·{' '}
                              {r.cuTotal !== null ? `util ${r.cuTotal.toFixed(0)}%` : 'util —'} ·{' '}
                              {r.txPower ?? '?'} dBm
                            </div>
                          ))}
                          {radios.length === 0 && (
                            <span className="text-xs text-slate-500">sem dados</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3">{formatNumber(totalClients)}</td>
                      <td className="py-2 pr-3 text-xs">
                        {formatPercent(ap.cpuPct)} / {formatPercent(ap.memPct)} / {tempStr}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {ap.retryRate !== null ? `${(ap.retryRate * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-500">
                        {ap.lastSeen ? formatRelative(ap.lastSeen) : 'nunca'}
                      </td>
                      <td className="py-2 pr-3">
                        <SeverityBadge severity={severity} />
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {messages.length > 0 ? (
                          <div className="space-y-1">
                            {messages.map((m) => (
                              <div key={m} className="text-slate-700 dark:text-slate-300">
                                {m}
                              </div>
                            ))}
                            {radios
                              .filter((r) => r.diagnosis && r.diagnosis.severity !== 'ok')
                              .map((r) => (
                                <div key={`rec-${r.radio}`} className="italic text-slate-500">
                                  💡 {r.diagnosis?.recommendation}
                                </div>
                              ))}
                            {deviceDiag && deviceDiag.severity !== 'ok' && (
                              <div className="italic text-slate-500">
                                💡 {deviceDiag.recommendation}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">Sem problemas detectados.</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-sm text-slate-500">
                      Nenhum AP encontrado nos últimos 15 minutos.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </QueryState>
      </Card>
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
