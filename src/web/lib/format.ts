/** Formatadores comuns na UI. Mantêm output em pt-BR (separador `.`/`,`). */

const numberFmt = new Intl.NumberFormat('pt-BR');
const pctFmt = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });

export function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return numberFmt.format(value);
}

export function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0 B';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(abs) / Math.log(1024)));
  const v = abs / 1024 ** exp;
  return `${sign}${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[exp]}`;
}

export function formatRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return pctFmt.format(value);
}

export function formatTimestamp(epochSeconds: number | null | undefined): string {
  if (epochSeconds == null) return '—';
  return new Date(epochSeconds * 1000).toLocaleString('pt-BR', {
    hour12: false,
  });
}

export function formatRelative(epochMs: number | null | undefined): string {
  if (epochMs == null) return 'nunca';
  const diff = Date.now() - epochMs;
  if (diff < 0) return 'no futuro';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s atrás`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}
