import { Card } from '../components/ui/Card.tsx';

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <Card title="Configurações">
        <p className="text-sm text-slate-500">
          As configurações de retenção e intervalo padrão são definidas por variáveis de ambiente no
          servidor (<code className="font-mono">RETENTION_5M_DAYS</code>,{' '}
          <code className="font-mono">RETENTION_1H_DAYS</code>,{' '}
          <code className="font-mono">DEFAULT_POLL_SECONDS</code>). Os intervalos por controller
          podem ser ajustados na aba <b>Controllers</b>.
        </p>
        <p className="mt-4 text-sm text-slate-500">
          Mais opções (i18n, temas, rotação de master key) chegarão no M4.
        </p>
      </Card>
    </div>
  );
}
