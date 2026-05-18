import { useQuery } from '@tanstack/react-query';

interface HealthResponse {
  ok: boolean;
  name: string;
  version: string;
  uptime: number;
  timestamp: string;
}

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/healthz');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth });

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight">mm-metricas-unifi</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          Coleta e BI de métricas UniFi · self-hosted · open-source
        </p>
      </header>

      <section className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Status do servidor</h2>
        {health.isLoading && <p className="text-slate-500">Carregando…</p>}
        {health.isError && (
          <p className="text-red-600 dark:text-red-400">Falha ao conectar com a API.</p>
        )}
        {health.data && (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Versão</dt>
              <dd className="font-mono">{health.data.version}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Uptime</dt>
              <dd className="font-mono">{health.data.uptime}s</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Timestamp</dt>
              <dd className="font-mono text-xs">{health.data.timestamp}</dd>
            </div>
          </dl>
        )}
      </section>

      <p className="mt-8 text-xs text-slate-500">
        Setup wizard, dashboard e BI chegam nos próximos milestones (M1+).
      </p>
    </main>
  );
}
