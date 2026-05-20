import { useMemo, useState } from 'react';
import { diagnosePort } from '../../shared/diagnostics.ts';
import { useProblemPorts, useSwitchSummary } from '../api/queries/health.ts';
import { FilterBar, type FilterValue } from '../components/FilterBar.tsx';
import { SeverityBadge } from '../components/SeverityBadge.tsx';
import { Card } from '../components/ui/Card.tsx';
import { QueryState } from '../components/ui/QueryState.tsx';
import { formatNumber } from '../lib/format.ts';

export function SwitchesPage() {
  const [filter, setFilter] = useState<FilterValue>({});
  const summary = useSwitchSummary(filter);
  const ports = useProblemPorts({ ...filter, limit: 100 });
  const thresholds = ports.data?.thresholds;
  const portRows = ports.data?.rows ?? [];

  const enrichedPorts = useMemo(() => {
    if (!thresholds) return [];
    return portRows.map((p) => {
      const diagnosis = diagnosePort(
        {
          up: p.up === null ? null : p.up === 1,
          enable: p.enable === null ? null : p.enable === 1,
          speed: p.speed,
          fullDuplex: p.fullDuplex === null ? null : p.fullDuplex === 1,
          rxErrors24h: p.rxErrors24h,
          txErrors24h: p.txErrors24h,
          rxDropped24h: p.rxDropped24h,
          txDropped24h: p.txDropped24h,
        },
        thresholds,
      );
      return { port: p, diagnosis };
    });
  }, [portRows, thresholds]);

  return (
    <div className="space-y-6">
      <Card title="Switches" actions={<FilterBar value={filter} onChange={setFilter} />}>
        <QueryState
          isLoading={summary.isLoading}
          isError={summary.isError}
          error={summary.error}
          isEmpty={(summary.data?.rows ?? []).length === 0}
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Switch</th>
                  <th className="py-2 pr-3">Portas Up/Total</th>
                  <th className="py-2 pr-3">Erros 24h</th>
                  <th className="py-2 pr-3">Dropped 24h</th>
                  <th className="py-2 pr-3">PoE consumido</th>
                  <th className="py-2 pr-3">Temp pico</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(summary.data?.rows ?? []).map((s) => (
                  <tr key={s.deviceId}>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{s.alias ?? s.name ?? s.mac}</div>
                      <div className="text-xs text-slate-500">
                        {s.model ?? ''} · {s.mac}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {formatNumber(s.portsUp)}/{formatNumber(s.totalPorts)}
                      {s.portsDown > 0 ? (
                        <span className="ml-2 text-xs text-amber-600">
                          ({formatNumber(s.portsDown)} down)
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">{formatNumber(s.totalErrors24h)}</td>
                    <td className="py-2 pr-3">{formatNumber(s.totalDropped24h)}</td>
                    <td className="py-2 pr-3">
                      {s.totalPoeWatt !== null ? `${s.totalPoeWatt.toFixed(1)} W` : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      {s.tempPeak !== null ? `${s.tempPeak.toFixed(0)} °C` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </Card>

      <Card title="Portas com problemas (top 100)">
        <QueryState
          isLoading={ports.isLoading}
          isError={ports.isError}
          error={ports.error}
          isEmpty={enrichedPorts.filter((e) => e.diagnosis?.severity !== 'ok').length === 0}
          emptyText="Nenhuma porta com erros nas últimas 24h. 🎉"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Switch</th>
                  <th className="py-2 pr-3">Porta</th>
                  <th className="py-2 pr-3">Velocidade</th>
                  <th className="py-2 pr-3">Erros (RX/TX)</th>
                  <th className="py-2 pr-3">Dropped (RX/TX)</th>
                  <th className="py-2 pr-3">PoE</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Diagnóstico</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {enrichedPorts
                  .filter((e) => e.diagnosis?.severity !== 'ok' || e.port.up !== 1)
                  .map(({ port: p, diagnosis }) => (
                    <tr key={`${p.deviceId}-${p.portIdx}`}>
                      <td className="py-2 pr-3 text-xs">
                        {p.deviceAlias ?? p.deviceName ?? p.deviceId}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">#{p.portIdx}</div>
                        <div className="text-xs text-slate-500">{p.name ?? ''}</div>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {p.up
                          ? `${p.speed ?? '?'} Mbps ${p.fullDuplex ? 'FDX' : 'HDX'}`
                          : 'Desconectada'}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {formatNumber(p.rxErrors24h)}/{formatNumber(p.txErrors24h)}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {formatNumber(p.rxDropped24h)}/{formatNumber(p.txDropped24h)}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {p.poeWatt !== null ? `${p.poeWatt.toFixed(1)} W` : '—'}
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
                            <div className="italic text-slate-500">
                              💡 {diagnosis.recommendation}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
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
