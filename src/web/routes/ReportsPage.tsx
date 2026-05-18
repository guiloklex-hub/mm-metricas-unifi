import { useMemo, useState } from 'react';
import { useControllers } from '../api/queries/controllers.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Input } from '../components/ui/Input.tsx';

type Preset = '24h' | '7d' | '30d' | '90d' | 'custom';

const PRESET_SECONDS: Record<Exclude<Preset, 'custom'>, number> = {
  '24h': 24 * 3600,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
  '90d': 90 * 86400,
};

function defaultIsoDate(offsetSec: number): string {
  return new Date((Math.floor(Date.now() / 1000) + offsetSec) * 1000).toISOString().slice(0, 16);
}

export function ReportsPage() {
  const controllers = useControllers();
  const [preset, setPreset] = useState<Preset>('30d');
  const [controllerId, setControllerId] = useState<string>('');
  const [siteId, setSiteId] = useState<string>('');
  const [fromCustom, setFromCustom] = useState<string>(defaultIsoDate(-7 * 86400));
  const [toCustom, setToCustom] = useState<string>(defaultIsoDate(0));
  const [pdfLoading, setPdfLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { from, to } = useMemo(() => {
    if (preset === 'custom') {
      const f = Math.floor(new Date(fromCustom).getTime() / 1000);
      const t = Math.floor(new Date(toCustom).getTime() / 1000);
      return { from: f, to: t };
    }
    const now = Math.floor(Date.now() / 1000);
    return { from: now - PRESET_SECONDS[preset], to: now };
  }, [preset, fromCustom, toCustom]);

  async function downloadFile(path: string, init?: RequestInit) {
    setError(null);
    const res = await fetch(path, { credentials: 'include', ...init });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const cd = res.headers.get('content-disposition') ?? '';
    const filenameMatch = /filename="([^"]+)"/.exec(cd);
    const filename = filenameMatch?.[1] ?? `download-${Date.now()}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportCsv() {
    setCsvLoading(true);
    try {
      const qs = new URLSearchParams({ from: String(from), to: String(to) });
      if (controllerId) qs.set('controllerId', controllerId);
      if (siteId) qs.set('siteId', siteId);
      await downloadFile(`/api/v1/export/metrics.csv?${qs.toString()}`);
    } catch (e) {
      setError(`CSV: ${(e as Error).message}`);
    } finally {
      setCsvLoading(false);
    }
  }

  async function exportPdf() {
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

  return (
    <div className="space-y-6">
      <Card title="Exportar relatório">
        <p className="mb-4 text-sm text-slate-500">
          CSV inclui todas as amostras crus da janela. PDF traz resumo executivo (totais + tabela
          por AP). Granularidade é escolhida automaticamente conforme o tamanho da janela.
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

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <span className="mb-1 block text-sm font-medium">Controller</span>
              <select
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                value={controllerId}
                onChange={(e) => setControllerId(e.target.value)}
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
              <span className="mb-1 block text-sm font-medium">Site ID (opcional)</span>
              <Input
                placeholder="deixe vazio para todos"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button onClick={exportCsv} loading={csvLoading}>
              Exportar CSV
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
