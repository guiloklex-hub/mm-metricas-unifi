import { useEffect, useState } from 'react';
import type { ThresholdConfig } from '../../shared/diagnostics.ts';
import { useAuditLog } from '../api/queries/audit.ts';
import { useChangePassword } from '../api/queries/auth.ts';
import { useSaveThresholds, useThresholds } from '../api/queries/health.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Input } from '../components/ui/Input.tsx';
import { formatRelative } from '../lib/format.ts';

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <ChangePasswordCard />
      <ThresholdsCard />
      <AuditLogCard />
      <EnvCard />
    </div>
  );
}

interface ThresholdMeta {
  key: keyof ThresholdConfig;
  label: string;
  unit: string;
  hint: string;
}

const THRESHOLD_META: ThresholdMeta[] = [
  {
    key: 'channelUtilization',
    label: 'Utilização do canal',
    unit: '%',
    hint: '% do tempo do canal ocupado. >70% indica congestionamento sério.',
  },
  {
    key: 'clientSignal',
    label: 'Sinal do cliente',
    unit: 'dBm',
    hint: 'RSSI. -65 ótimo, -75 ruim, -80 crítico. (valores negativos)',
  },
  {
    key: 'clientTxRate',
    label: 'Taxa de TX do cliente',
    unit: 'Mbps',
    hint: 'Taxa negociada. <24 Mbps indica problema de cobertura ou cliente legado.',
  },
  {
    key: 'retryRate',
    label: 'Retry rate (geral)',
    unit: '0-1',
    hint: 'Proporção de retransmissões. 0.05 = 5%.',
  },
  {
    key: 'errorRate',
    label: 'Error rate',
    unit: '0-1',
    hint: 'Proporção de erros de TX.',
  },
  {
    key: 'dropRate',
    label: 'Drop rate',
    unit: '0-1',
    hint: 'Proporção de pacotes descartados.',
  },
  { key: 'cpuPct', label: 'CPU do device', unit: '%', hint: 'Uso de CPU do AP/switch.' },
  { key: 'memPct', label: 'Memória do device', unit: '%', hint: 'Uso de RAM.' },
  {
    key: 'portErrors',
    label: 'Erros/dropped por porta',
    unit: '24h',
    hint: 'Soma de errors+dropped em RX/TX nas últimas 24h por porta.',
  },
  {
    key: 'temperature',
    label: 'Temperatura',
    unit: '°C',
    hint: 'Pico de CPU ou board do device.',
  },
  {
    key: 'roamCount',
    label: 'Roams por sessão',
    unit: 'qty',
    hint: 'Quantidade de roams na sessão do cliente.',
  },
];

function ThresholdsCard() {
  const query = useThresholds();
  const save = useSaveThresholds();
  const [draft, setDraft] = useState<ThresholdConfig | null>(null);

  useEffect(() => {
    if (query.data?.thresholds) setDraft(query.data.thresholds);
  }, [query.data]);

  if (!draft || !query.data) {
    return (
      <Card title="Limites de severidade">
        <p className="text-sm text-slate-500">Carregando…</p>
      </Card>
    );
  }

  const resetDefaults = () => setDraft({ ...query.data.defaults });

  return (
    <Card
      title="Limites de severidade"
      actions={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={resetDefaults}>
            Restaurar defaults
          </Button>
          <Button onClick={() => save.mutate(draft)} loading={save.isPending}>
            Salvar
          </Button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-slate-500">
        Os painéis de Saúde / Cobertura / Switches usam estes limites para colorir badges e gerar
        diagnósticos. Use os defaults como ponto de partida e ajuste conforme a sua rede.
      </p>
      <div className="grid gap-3">
        {THRESHOLD_META.map((meta) => {
          const v = draft[meta.key];
          return (
            <div
              key={meta.key}
              className="grid grid-cols-1 items-start gap-2 border-b border-slate-100 pb-3 last:border-0 dark:border-slate-800 md:grid-cols-[1fr_120px_120px]"
            >
              <div>
                <div className="text-sm font-medium">{meta.label}</div>
                <div className="text-xs text-slate-500">{meta.hint}</div>
              </div>
              <Input
                label={`Atenção (${meta.unit})`}
                type="number"
                step="any"
                value={String(v.warning)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [meta.key]: { ...v, warning: Number(e.target.value) },
                  })
                }
              />
              <Input
                label={`Crítico (${meta.unit})`}
                type="number"
                step="any"
                value={String(v.critical)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [meta.key]: { ...v, critical: Number(e.target.value) },
                  })
                }
              />
            </div>
          );
        })}
      </div>
      {save.isError && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">
          Falha ao salvar: {(save.error as Error).message}
        </p>
      )}
      {save.isSuccess && (
        <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">Limites atualizados.</p>
      )}
    </Card>
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
