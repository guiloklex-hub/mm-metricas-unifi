import type { Severity } from '../../shared/diagnostics.ts';

/** Inclui 'info' (vindo de eventos UniFi) além das Severities padrão. */
export type BadgeKind = Severity | 'info';

const STYLES: Record<BadgeKind, string> = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  info: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const LABELS: Record<BadgeKind, string> = {
  ok: 'OK',
  info: 'Info',
  warning: 'Atenção',
  critical: 'Crítico',
};

export function SeverityBadge({ severity, label }: { severity: BadgeKind; label?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STYLES[severity]}`}
    >
      {label ?? LABELS[severity]}
    </span>
  );
}
