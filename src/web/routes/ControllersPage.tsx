import { useState } from 'react';
import {
  type ControllerCreateInput,
  type ControllerPublic,
  useBackfillStatus,
  useControllers,
  useCreateController,
  useDeleteController,
  useRequestBackfill,
  useUpdateController,
} from '../api/queries/controllers.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Input } from '../components/ui/Input.tsx';
import { formatRelative } from '../lib/format.ts';

export function ControllersPage() {
  const { data, isLoading } = useControllers();
  const create = useCreateController();
  const remove = useDeleteController();
  const update = useUpdateController();
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
              <ControllerRow
                key={c.id}
                controller={c}
                onToggle={() => update.mutate({ id: c.id, patch: { enabled: !c.enabled } })}
                onChangePoll={(pollSeconds) => update.mutate({ id: c.id, patch: { pollSeconds } })}
                onChangeVariant={(variant) => update.mutate({ id: c.id, patch: { variant } })}
                onDelete={() => {
                  if (confirm(`Excluir controller "${c.name}"?`)) remove.mutate(c.id);
                }}
              />
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

function ControllerRow({
  controller: c,
  onToggle,
  onChangePoll,
  onChangeVariant,
  onDelete,
}: {
  controller: ControllerPublic;
  onToggle: () => void;
  onChangePoll: (pollSeconds: number) => void;
  onChangeVariant: (variant: 'unifi-os' | 'classic' | null) => void;
  onDelete: () => void;
}) {
  const [editingPoll, setEditingPoll] = useState(false);
  const [pollDraft, setPollDraft] = useState(c.pollSeconds);
  const [editingVariant, setEditingVariant] = useState(false);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium">
          {c.name}{' '}
          {!c.enabled && (
            <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              pausado
            </span>
          )}
        </p>
        <p className="truncate text-xs text-slate-500">
          {c.baseUrl} ·{' '}
          {editingVariant ? (
            <>
              <select
                aria-label="Variant do controller"
                defaultValue={c.variant ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  const next = v === '' ? null : (v as 'unifi-os' | 'classic');
                  onChangeVariant(next);
                  setEditingVariant(false);
                }}
                className="rounded border border-slate-300 px-1 py-0 text-xs dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">auto-detect</option>
                <option value="classic">classic</option>
                <option value="unifi-os">unifi-os</option>
              </select>{' '}
              <button
                type="button"
                onClick={() => setEditingVariant(false)}
                className="text-slate-500 hover:underline"
              >
                cancelar
              </button>
            </>
          ) : (
            <>
              {c.variant ?? 'auto-detect'}{' '}
              <button
                type="button"
                onClick={() => setEditingVariant(true)}
                className="text-slate-500 hover:underline"
              >
                editar
              </button>
            </>
          )}
          {' · '}
          {editingPoll ? (
            <>
              <label htmlFor={`poll-${c.id}`}>poll </label>
              <input
                id={`poll-${c.id}`}
                type="number"
                min={60}
                max={3600}
                value={pollDraft}
                onChange={(e) => setPollDraft(Number(e.target.value))}
                aria-label="Intervalo de polling em segundos"
                className="w-20 rounded border border-slate-300 px-1 py-0 text-xs dark:border-slate-700 dark:bg-slate-950"
              />
              s{' '}
              <button
                type="button"
                onClick={() => {
                  onChangePoll(pollDraft);
                  setEditingPoll(false);
                }}
                className="text-blue-600 hover:underline"
              >
                salvar
              </button>{' '}
              <button
                type="button"
                onClick={() => {
                  setEditingPoll(false);
                  setPollDraft(c.pollSeconds);
                }}
                className="text-slate-500 hover:underline"
              >
                cancelar
              </button>
            </>
          ) : (
            <>
              poll {c.pollSeconds}s{' '}
              <button
                type="button"
                onClick={() => setEditingPoll(true)}
                className="text-slate-500 hover:underline"
              >
                editar
              </button>
            </>
          )}
        </p>
        {c.lastError && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">⚠ {c.lastError}</p>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span>Última coleta: {formatRelative(c.lastSeenAt)}</span>
        <BackfillButton controllerId={c.id} />
        <Button variant="secondary" onClick={onToggle}>
          {c.enabled ? 'Pausar' : 'Reativar'}
        </Button>
        <Button variant="danger" onClick={onDelete}>
          Excluir
        </Button>
      </div>
    </li>
  );
}

function BackfillButton({ controllerId }: { controllerId: string }) {
  const [showForm, setShowForm] = useState(false);
  const [days, setDays] = useState(30);
  const [includeDaily, setIncludeDaily] = useState(false);
  const request = useRequestBackfill();
  const status = useBackfillStatus(controllerId);
  const job = status.data?.job ?? null;
  const running = job?.status === 'pending' || job?.status === 'running';

  if (showForm) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700">
        <label className="inline-flex items-center gap-1">
          dias:
          <input
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-16 rounded border border-slate-300 px-1 py-0 text-xs dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={includeDaily}
            onChange={(e) => setIncludeDaily(e.target.checked)}
          />
          incluir granularidade diária (longo prazo)
        </label>
        <button
          type="button"
          disabled={request.isPending}
          onClick={() => {
            request.mutate(
              { id: controllerId, days, includeDaily },
              { onSuccess: () => setShowForm(false) },
            );
          }}
          className="text-blue-600 hover:underline disabled:opacity-50"
        >
          {request.isPending ? 'enviando…' : 'iniciar'}
        </button>
        <button
          type="button"
          onClick={() => setShowForm(false)}
          className="text-slate-500 hover:underline"
        >
          cancelar
        </button>
      </div>
    );
  }

  return (
    <span className="flex items-center gap-2">
      {job && (
        <span
          className={
            running
              ? 'text-amber-600 dark:text-amber-400'
              : job.status === 'failed'
                ? 'text-red-600 dark:text-red-400'
                : 'text-emerald-600 dark:text-emerald-400'
          }
        >
          backfill: {job.status}
          {running ? '…' : ''}
        </span>
      )}
      <Button variant="secondary" onClick={() => setShowForm(true)} disabled={running}>
        {running ? 'Importando…' : 'Importar histórico'}
      </Button>
    </span>
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
  const [variant, setVariant] = useState<'auto' | 'classic' | 'unifi-os'>('auto');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const variantValue = variant === 'auto' ? null : variant;
    const common = {
      name,
      baseUrl,
      insecureTls,
      pollSeconds,
      enabled: true,
      variant: variantValue,
    };
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
        <div>
          <label
            htmlFor="controller-variant"
            className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Variant
          </label>
          <select
            id="controller-variant"
            value={variant}
            onChange={(e) => setVariant(e.target.value as 'auto' | 'classic' | 'unifi-os')}
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="auto">auto-detect (recomendado)</option>
            <option value="classic">classic — Network App self-hosted (porta 8443)</option>
            <option value="unifi-os">unifi-os — UDM/UCK/Cloud Key Gen2+ (porta 443)</option>
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Force quando o auto-detect falhar (raro, ocorre atrás de proxy/SSO).
          </p>
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={insecureTls}
          onChange={(e) => setInsecureTls(e.target.checked)}
        />
        Aceitar certificado TLS auto-assinado (UDM/UCK padrão)
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Button type="submit" loading={submitting}>
        Cadastrar e disparar primeira coleta
      </Button>
    </form>
  );
}
