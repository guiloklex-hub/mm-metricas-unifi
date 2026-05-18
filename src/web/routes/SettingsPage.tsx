import { useState } from 'react';
import { useAuditLog } from '../api/queries/audit.ts';
import { useChangePassword } from '../api/queries/auth.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Input } from '../components/ui/Input.tsx';
import { formatRelative } from '../lib/format.ts';

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <ChangePasswordCard />
      <AuditLogCard />
      <EnvCard />
    </div>
  );
}

function ChangePasswordCard() {
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSuccess(false);
    if (next.length < 8) {
      setLocalError('Nova senha precisa ter ao menos 8 caracteres.');
      return;
    }
    if (next !== confirm) {
      setLocalError('As senhas não coincidem.');
      return;
    }
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setCurrent('');
          setNext('');
          setConfirm('');
          setSuccess(true);
        },
      },
    );
  };

  return (
    <Card title="Trocar senha do administrador">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Input
          label="Senha atual"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
        <span />
        <Input
          label="Nova senha"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          required
        />
        <Input
          label="Confirme a nova senha"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          error={localError ?? undefined}
        />
        <div className="md:col-span-2">
          {change.error && (
            <p className="mb-2 text-sm text-red-600 dark:text-red-400">
              {(change.error as Error).message === 'invalid_credentials'
                ? 'Senha atual incorreta.'
                : (change.error as Error).message}
            </p>
          )}
          {success && (
            <p className="mb-2 text-sm text-emerald-600 dark:text-emerald-400">Senha atualizada.</p>
          )}
          <Button type="submit" loading={change.isPending}>
            Salvar nova senha
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AuditLogCard() {
  const audit = useAuditLog(100);
  return (
    <Card title="Audit log">
      {audit.isLoading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : !audit.data || audit.data.rows.length === 0 ? (
        <p className="text-sm text-slate-500">Sem eventos registrados.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Quando</th>
                <th className="px-3 py-2">Ator</th>
                <th className="px-3 py-2">Ação</th>
                <th className="px-3 py-2">Alvo</th>
                <th className="px-3 py-2">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {audit.data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {formatRelative(r.ts * 1000)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.actor ?? '—'}</td>
                  <td className="px-3 py-2 font-medium">{r.action}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.target ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.metadata ? JSON.stringify(r.metadata) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function EnvCard() {
  return (
    <Card title="Configurações de ambiente">
      <p className="text-sm text-slate-500">
        Retenção e intervalo padrão são definidos por variáveis de ambiente no servidor (
        <code className="font-mono">RETENTION_5M_DAYS</code>,{' '}
        <code className="font-mono">RETENTION_1H_DAYS</code>,{' '}
        <code className="font-mono">DEFAULT_POLL_SECONDS</code>). Por controller, ajuste o intervalo
        em <b>Controllers</b>.
      </p>
    </Card>
  );
}
