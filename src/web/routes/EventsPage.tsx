import { useMemo, useState } from 'react';
import { useEventHistogram, useEvents } from '../api/queries/events.ts';
import { FilterBar, type FilterValue } from '../components/FilterBar.tsx';
import { SeverityBadge } from '../components/SeverityBadge.tsx';
import { Card } from '../components/ui/Card.tsx';
import { QueryState } from '../components/ui/QueryState.tsx';
import { formatTimestamp } from '../lib/format.ts';

type Window = '6h' | '24h' | '7d' | '30d';
const WINDOW_SECONDS: Record<Window, number> = {
  '6h': 6 * 3600,
  '24h': 86400,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
};

export function EventsPage() {
  const [filter, setFilter] = useState<FilterValue>({});
  const [window, setWindow] = useState<Window>('24h');
  const [severity, setSeverity] = useState<'all' | 'info' | 'warning' | 'critical'>('all');

  const to = useMemo(() => Math.floor(Date.now() / 1000), []);
  const from = to - WINDOW_SECONDS[window];

  const histogram = useEventHistogram({ from, to, ...filter });
  const events = useEvents({
    from,
    to,
    ...filter,
    severity: severity === 'all' ? undefined : severity,
    limit: 200,
  });

  const buckets = histogram.data?.buckets ?? [];
  const maxBucket = Math.max(1, ...buckets.map((b) => b.info + b.warning + b.critical));

  return (
    <div className="space-y-6">
      <Card
        title="Eventos por hora"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <FilterBar value={filter} onChange={setFilter} />
            <WindowPicker value={window} onChange={setWindow} />
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as typeof severity)}
            >
              <option value="all">Todas severidades</option>
              <option value="critical">Crítico</option>
              <option value="warning">Atenção</option>
              <option value="info">Info</option>
            </select>
          </div>
        }
      >
        <QueryState
          isLoading={histogram.isLoading}
          isError={histogram.isError}
          error={histogram.error}
          isEmpty={buckets.length === 0}
          emptyText="Nenhum evento registrado neste período."
        >
          <div className="flex h-32 items-end gap-1 overflow-x-auto">
            {buckets.map((b) => {
              const total = b.info + b.warning + b.critical;
              const height = (total / maxBucket) * 100;
              return (
                <div
                  key={b.ts}
                  className="flex w-3 flex-col-reverse"
                  style={{ height: `${Math.max(height, total > 0 ? 2 : 0)}%` }}
                  title={`${formatTimestamp(b.ts)} · info ${b.info} · warn ${b.warning} · crit ${b.critical}`}
                >
                  <div
                    className="bg-emerald-400"
                    style={{ height: `${(b.info / Math.max(total, 1)) * 100}%` }}
                  />
                  <div
                    className="bg-amber-400"
                    style={{ height: `${(b.warning / Math.max(total, 1)) * 100}%` }}
                  />
                  <div
                    className="bg-red-500"
                    style={{ height: `${(b.critical / Math.max(total, 1)) * 100}%` }}
                  />
                </div>
              );
            })}
          </div>
        </QueryState>
      </Card>

      <Card title="Lista de eventos">
        <QueryState
          isLoading={events.isLoading}
          isError={events.isError}
          error={events.error}
          isEmpty={(events.data?.rows ?? []).length === 0}
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Quando</th>
                  <th className="py-2 pr-3">Severidade</th>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Device</th>
                  <th className="py-2 pr-3">Cliente / SSID</th>
                  <th className="py-2 pr-3">Mensagem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(events.data?.rows ?? []).map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-3 text-xs">{formatTimestamp(e.ts)}</td>
                    <td className="py-2 pr-3">
                      <SeverityBadge severity={e.severity} />
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{e.eventType}</td>
                    <td className="py-2 pr-3 text-xs">
                      {e.deviceAlias ?? e.deviceName ?? e.deviceMac ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {e.clientMac && <div className="font-mono">{e.clientMac}</div>}
                      {e.ssid && <div className="text-slate-500">{e.ssid}</div>}
                      {!e.clientMac && !e.ssid && '—'}
                    </td>
                    <td className="py-2 pr-3 text-xs">{e.message ?? '—'}</td>
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

function WindowPicker({ value, onChange }: { value: Window; onChange: (v: Window) => void }) {
  return (
    <div className="flex gap-1 rounded-md border border-slate-300 p-0.5 text-xs dark:border-slate-700">
      {(['6h', '24h', '7d', '30d'] as const).map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => onChange(w)}
          className={`rounded px-2 py-0.5 ${
            value === w
              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          {w}
        </button>
      ))}
    </div>
  );
}
