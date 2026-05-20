interface ClientLike {
  displayAlias?: string | null;
  name?: string | null;
  hostname?: string | null;
  mac: string;
}

/**
 * Label preferida para cliente. Ordem: alias custom → name (UniFi) → hostname
 * técnico → MAC. Espelha o helper de devices em [device-label.ts].
 */
export function clientLabel(c: ClientLike): string {
  return c.displayAlias?.trim() || c.name?.trim() || c.hostname?.trim() || c.mac || '?';
}

/**
 * "Nome (MAC)" quando há nome; senão só MAC. Usado em tabelas onde o operador
 * quer ver nome E identificador. Os MACs continuam visíveis para troubleshoot.
 */
export function clientLabelWithMac(c: ClientLike): string {
  const main = c.displayAlias?.trim() || c.name?.trim() || c.hostname?.trim();
  return main ? `${main} (${c.mac})` : c.mac;
}
