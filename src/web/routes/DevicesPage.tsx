import { useMemo, useState } from 'react';
import { useControllers } from '../api/queries/controllers.ts';
import {
  type Device,
  useDevices,
  useImportDeviceAliases,
  useUpdateDeviceAlias,
} from '../api/queries/devices.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Input } from '../components/ui/Input.tsx';
import { formatRelative } from '../lib/format.ts';

export function DevicesPage() {
  const controllers = useControllers();
  const [controllerFilter, setControllerFilter] = useState<string | undefined>(undefined);
  const { data: devices, isLoading } = useDevices(
    controllerFilter ? { controllerId: controllerFilter } : {},
  );
  const update = useUpdateDeviceAlias();
  const [showImport, setShowImport] = useState(false);

  const controllerMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of controllers.data ?? []) map.set(c.id, c.name);
    return map;
  }, [controllers.data]);

  return (
    <div className="space-y-6">
      <Card
        title="Antenas (Access Points)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
              value={controllerFilter ?? ''}
              onChange={(e) => setControllerFilter(e.target.value || undefined)}
            >
              <option value="">Todos os controllers</option>
              {controllers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => downloadTemplate(devices ?? [])}>
              Baixar template CSV
            </Button>
            <Button variant="primary" onClick={() => setShowImport((v) => !v)}>
              {showImport ? 'Cancelar' : 'Importar CSV'}
            </Button>
          </div>
        }
      >
        {isLoading ? (
          <p className="text-sm text-slate-500">Carregando…</p>
        ) : !devices || devices.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhuma antena descoberta ainda. Cadastre um controller e aguarde a primeira coleta.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Controller</th>
                  <th className="px-3 py-2">MAC</th>
                  <th className="px-3 py-2">Nome (UniFi)</th>
                  <th className="px-3 py-2">Modelo</th>
                  <th className="px-3 py-2">Apelido</th>
                  <th className="px-3 py-2">Última vez visto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {devices.map((d) => (
                  <DeviceRow
                    key={d.id}
                    device={d}
                    controllerName={controllerMap.get(d.controllerId) ?? d.controllerId}
                    onSave={(alias) => update.mutateAsync({ id: d.id, alias })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showImport && (
        <ImportCsvCard controllerId={controllerFilter} onDone={() => setShowImport(false)} />
      )}
    </div>
  );
}

interface DeviceRowProps {
  device: Device;
  controllerName: string;
  onSave: (alias: string | null) => Promise<unknown>;
}

function DeviceRow({ device, controllerName, onSave }: DeviceRowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(device.displayAlias ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    setSaving(true);
    setError(null);
    try {
      const next = value.trim().length === 0 ? null : value.trim();
      await onSave(next);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td className="px-3 py-2 text-xs">{controllerName}</td>
      <td className="px-3 py-2 font-mono text-xs">{device.mac}</td>
      <td className="px-3 py-2">{device.name ?? <span className="text-slate-400">—</span>}</td>
      <td className="px-3 py-2 text-xs">{device.model ?? '—'}</td>
      <td className="px-3 py-2">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              ref={(el) => el?.focus()}
              type="text"
              maxLength={120}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') {
                  setValue(device.displayAlias ?? '');
                  setEditing(false);
                }
              }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <Button variant="primary" loading={saving} onClick={commit}>
              Salvar
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setValue(device.displayAlias ?? '');
                setEditing(false);
                setError(null);
              }}
            >
              Cancelar
            </Button>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-left text-sm hover:underline"
            title="Clique para editar"
          >
            {device.displayAlias ?? <span className="text-slate-400">Definir apelido…</span>}
          </button>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-slate-500">
        {device.lastSeen ? formatRelative(device.lastSeen * 1000) : 'nunca'}
      </td>
    </tr>
  );
}

interface ImportCsvCardProps {
  controllerId: string | undefined;
  onDone: () => void;
}

function ImportCsvCard({ controllerId, onDone }: ImportCsvCardProps) {
  const importer = useImportDeviceAliases();
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof importer.mutateAsync>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      setError('Arquivo maior que 2 MB.');
      return;
    }
    const text = await file.text();
    setCsv(text);
    setFilename(file.name);
    setError(null);
  }

  async function submit() {
    setError(null);
    setResult(null);
    try {
      const r = await importer.mutateAsync({ csv, controllerId });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao importar.');
    }
  }

  const preview = useMemo(() => {
    if (!csv) return [];
    return csv.split(/\r?\n/).slice(0, 10);
  }, [csv]);

  return (
    <Card
      title="Importar apelidos via CSV"
      actions={
        <Button variant="ghost" onClick={onDone}>
          Fechar
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600 dark:text-slate-300">
          Cabeçalho opcional <code>mac,alias</code>. Linhas que começam com <code>#</code> são
          ignoradas. Aliases até 120 caracteres. MAC pode estar com <code>:</code> ou <code>-</code>
          .
        </p>
        <Input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        {filename && (
          <p className="text-xs text-slate-500">
            Arquivo carregado: <b>{filename}</b> · {preview.length} linhas (preview)
          </p>
        )}
        {preview.length > 0 && (
          <pre className="max-h-48 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950">
            {preview.join('\n')}
            {csv.split(/\r?\n/).length > 10 ? '\n…' : ''}
          </pre>
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            loading={importer.isPending}
            disabled={csv.length === 0}
            onClick={submit}
          >
            Importar
          </Button>
          {controllerId && (
            <span className="text-xs text-slate-500">
              Aplicando apenas ao controller selecionado.
            </span>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-950">
            <p>
              <b>{result.updated}</b> apelidos aplicados · <b>{result.skipped}</b> linhas ignoradas
            </p>
            {result.errors.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-slate-600 dark:text-slate-300">
                  Ver detalhes ({result.errors.length} erros)
                </summary>
                <ul className="mt-2 list-disc pl-5">
                  {result.errors.slice(0, 50).map((e) => (
                    <li key={`${e.line}-${e.mac}`}>
                      linha {e.line} · {e.mac} → {translateError(e.reason)}
                    </li>
                  ))}
                  {result.errors.length > 50 && <li>… e mais {result.errors.length - 50}</li>}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function translateError(reason: 'mac_not_found' | 'mac_invalid' | 'alias_too_long'): string {
  if (reason === 'mac_not_found') return 'MAC não encontrado entre os devices descobertos';
  if (reason === 'mac_invalid') return 'MAC com formato inválido';
  return 'apelido excede 120 caracteres';
}

function downloadTemplate(devices: Device[]): void {
  const header = 'mac,alias';
  const lines = devices.map((d) => `${d.mac},${escapeCsv(d.displayAlias ?? d.name ?? '')}`);
  const csv = `${header}\n${lines.join('\n')}\n`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'antenas-template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
