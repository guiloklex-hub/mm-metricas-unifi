import { useState } from 'react';
import {
  type ControllerCreateInput,
  useControllers,
  useCreateController,
  useDeleteController,
} from '../api/queries/controllers.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Input } from '../components/ui/Input.tsx';
import { formatRelative } from '../lib/format.ts';

export function ControllersPage() {
  const { data, isLoading } = useControllers();
  const create = useCreateController();
  const remove = useDeleteController();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      <Card
        title="Controllers UniFi"
        actions={
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancelar' : 'Adicionar'}
          </Button>
        }
      >
        {isLoading ? (
          <p className="text-sm text-slate-500">Carregando…</p>
        ) : data && data.length > 0 ? (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {c.baseUrl} · {c.variant ?? 'auto-detect'} · poll {c.pollSeconds}s
                  </p>
                  {c.lastError && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">⚠ {c.lastError}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>Última coleta: {formatRelative(c.lastSeenAt)}</span>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Excluir controller "${c.name}"?`)) remove.mutate(c.id);
                    }}
                  >
                    Excluir
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            Nenhum controller cadastrado. Clique em <b>Adicionar</b> para começar.
          </p>
        )}
      </Card>

      {showForm && (
        <Card title="Novo controller">
          <ControllerForm
            submitting={create.isPending}
            error={create.error ? (create.error as Error).message : null}
            onSubmit={(input) =>
              create.mutate(input, {
                onSuccess: () => setShowForm(false),
              })
            }
          />
        </Card>
      )}
    </div>
  );
}

function ControllerForm({
  onSubmit,
  submitting,
  error,
}: {
  onSubmit: (input: ControllerCreateInput) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://');
  const [authMode, setAuthMode] = useState<'local' | 'api-key'>('local');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [insecureTls, setInsecureTls] = useState(false);
  const [pollSeconds, setPollSeconds] = useState(300);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const common = { name, baseUrl, insecureTls, pollSeconds, enabled: true };
    if (authMode === 'local') {
      onSubmit({ ...common, authMode: 'local', username, password });
    } else {
      onSubmit({ ...common, authMode: 'api-key', apiKey });
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
        <Input
          label="URL base"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://udm.local"
          required
        />
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Tipo de autenticação
        </span>
        <div className="flex gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              checked={authMode === 'local'}
              onChange={() => setAuthMode('local')}
            />
            Usuário + senha
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              checked={authMode === 'api-key'}
              onChange={() => setAuthMode('api-key')}
            />
            API Key (UniFi Network 9.3+)
          </label>
        </div>
      </div>

      {authMode === 'local' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Usuário"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
          <Input
            label="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
      ) : (
        <Input
          label="API Key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          required
        />
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label="Intervalo de coleta (segundos)"
          type="number"
          min={60}
          max={3600}
          value={pollSeconds}
          onChange={(e) => setPollSeconds(Number(e.target.value))}
          required
        />
        <label className="mt-6 inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={insecureTls}
            onChange={(e) => setInsecureTls(e.target.checked)}
          />
          Aceitar certificado TLS auto-assinado (UDM/UCK padrão)
        </label>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Button type="submit" loading={submitting}>
        Cadastrar e disparar primeira coleta
      </Button>
    </form>
  );
}
