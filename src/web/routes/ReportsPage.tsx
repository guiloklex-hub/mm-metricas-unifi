import { useMemo, useState } from 'react';
import { useControllers } from '../api/queries/controllers.ts';
import { useDevices } from '../api/queries/devices.ts';
import { useSites } from '../api/queries/sites.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Input } from '../components/ui/Input.tsx';
import { deviceLabelWithMac } from '../lib/device-label.ts';

type Preset = '24h' | '7d' | '30d' | '90d' | 'custom';

const PRESET_SECONDS: Record<Exclude<Preset, 'custom'>, number> = {
  '24h': 24 * 3600,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
  '90d': 90 * 86400,
};

type Level = 'site' | 'device' | 'radio' | 'client';

const LEVEL_LABELS: Record<Level, string> = {
  site: 'Por site',
  device: 'Por antena',
  radio: 'Por rádio',
  client: 'Por cliente',
};

const ALL_LEVELS: Level[] = ['site', 'device', 'radio', 'client'];

function defaultIsoDate(offsetSec: number): string {
  return new Date((Math.floor(Date.now() / 1000) + offsetSec) * 1000).toISOString().slice(0, 16);
}

export function ReportsPage() {
  const controllers = useControllers();
  const [preset, setPreset] = useState<Preset>('30d');
  const [controllerId, setControllerId] = useState<string>('');
  const [siteId, setSiteId] = useState<string>('');
  const [deviceId, setDeviceId] = useState<string>('');
  const [levels, setLevels] = useState<Set<Level>>(new Set(ALL_LEVELS));
  const [fromCustom, setFromCustom] = useState<string>(defaultIsoDate(-7 * 86400));
  const [toCustom, setToCustom] = useState<string>(defaultIsoDate(0));
  const [pdfLoading, setPdfLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sites = useSites(controllerId ? { controllerId } : {});
  const devices = useDevices(
    controllerId || siteId
      ? { controllerId: controllerId || undefined, siteId: siteId || undefined }
      : {},
  );

  const { from, to } = useMemo(() => {
    if (preset === 'custom') {
      const f = Math.floor(new Date(fromCustom).getTime() / 1000);
      const t = Math.floor(new Date(toCustom).getTime() / 1000);
      return { from: f, to: t };
    }
    const now = Math.floor(Date.now() / 1000);
    return { from: now - PRESET_SECONDS[preset], to: now };
  }, [preset, fromCustom, toCustom]);

  function toggleLevel(level: Level): void {
    const next = new Set(levels);
    if (next.has(level)) next.delete(level);
    else next.add(level);
    setLevels(next);
  }

  async function downloadFile(path: string, init?: RequestInit): Promise<void> {
    setError(null);
    const res = await fetch(path, { credentials: 'include', ...init });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
      const cd = res.headers.get('content-disposition') ?? '';
      const filenameMatch = /filename="([^"]+)"/.exec(cd);
      const filename = filenameMatch?.[1] ?? `download-${Date.now()}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
    } finally {
      // Garante revoke mesmo se algo der errado na manipulação do <a>.
      URL.revokeObjectURL(url);
    }
  }

  async function exportData(): Promise<void> {
    if (levels.size === 0) {
      setError('Selecione pelo menos um nível de detalhamento.');
      return;
    }
    setCsvLoading(true);
    try {
      const qs = new URLSearchParams({ from: String(from), to: String(to) });
      if (controllerId) qs.set('controllerId', controllerId);
      if (siteId) qs.set('siteId', siteId);
      if (deviceId) qs.set('deviceId', deviceId);
      const selected = [...levels];
      qs.set('levels', selected.join(','));
      const endpoint =
        selected.length === 1 ? '/api/v1/export/metrics.csv' : '/api/v1/export/metrics.zip';
      await downloadFile(`${endpoint}?${qs.toString()}`);
    } catch (e) {
      setError(`Exportação: ${(e as Error).message}`);
    } finally {
      setCsvLoading(false);
    }
  }

  async function exportPdf(): Promise<void> {
    if (to - from > 90 * 86400) {
      setError('PDF: janela máxima de 90 dias. Use CSV para exportar mais.');
      return;
    }
    setPdfLoading(true);
    try {
      await downloadFile('/api/v1/reports/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to,
          controllerId: controllerId || undefined,
          siteId: siteId || undefined,
        }),
      });
    } catch (e) {
      setError(`PDF: ${(e as Error).message}`);
    } finally {
      setPdfLoading(false);
    }
  }

  const exportLabel = levels.size === 1 ? 'Exportar CSV' : `Exportar ZIP (${levels.size} arquivos)`;

  return (
    <div className="space-y-6">
      <Card title="Exportar relatório">
        <p className="mb-4 text-sm text-slate-500">
          Escolha quais níveis de detalhamento incluir. Quando mais de um é selecionado, o download
          vem como ZIP contendo um CSV por nível. Cada CSV inclui colunas legíveis (nome do
          controller, nome do site, label da antena, MAC). PDF traz resumo executivo com totais por
          antena.
        </p>

        <div className="space-y-4">
          <div>
            <span className="mb-1 block text-sm font-medium">Período</span>
            <div className="flex flex-wrap items-center gap-2">
              {(['24h', '7d', '30d', '90d', 'custom'] as Preset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    preset === p
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {p === 'custom' ? 'Personalizado' : p}
                </button>
              ))}
            </div>
          </div>

          {preset === 'custom' && (
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="De"
                type="datetime-local"
                value={fromCustom}
                onChange={(e) => setFromCustom(e.target.value)}
              />
              <Input
                label="Até"
                type="datetime-local"
                value={toCustom}
                onChange={(e) => setToCustom(e.target.value)}
              />
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <span className="mb-1 block text-sm font-medium">Controller</span>
              <select
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                value={controllerId}
                onChange={(e) => {
                  setControllerId(e.target.value);
                  setSiteId('');
                  setDeviceId('');
                }}
              >
                <option value="">Todos</option>
                {controllers.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium">Site</span>
              <select
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                value={siteId}
                onChange={(e) => {
                  setSiteId(e.target.value);
                  setDeviceId('');
                }}
              >
                <option value="">Todos</option>
                {sites.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium">Antena (opcional)</span>
              <select
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
              >
                <option value="">Todas</option>
                {devices.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {deviceLabelWithMac(d)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium">Detalhamento</span>
            <div className="flex flex-wrap gap-2">
              {ALL_LEVELS.map((level) => {
                const active = levels.has(level);
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => toggleLevel(level)}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      active
                        ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                        : 'border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    {LEVEL_LABELS[level]}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Cada nível gera um CSV separado. Selecione um para CSV puro, vários para ZIP.
            </p>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button onClick={exportData} loading={csvLoading}>
              {exportLabel}
            </Button>
            <Button variant="secondary" onClick={exportPdf} loading={pdfLoading}>
              Gerar PDF
            </Button>
            <span className="text-xs text-slate-500">
              Janela: {Math.round((to - from) / 86400)} dias
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
