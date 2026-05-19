interface DeviceLike {
  displayAlias?: string | null;
  name?: string | null;
  mac: string;
}

/**
 * Label preferida da antena. Ordem: apelido custom → nome do controller → MAC.
 * Nunca cai em ULID — se o MAC estiver vazio (impossível em produção), retorna
 * `'?'`.
 */
export function deviceLabel(d: DeviceLike): string {
  return d.displayAlias?.trim() || d.name?.trim() || d.mac || '?';
}

/**
 * "Nome (MAC)" quando houver nome/apelido; só MAC caso contrário.
 * Usado em tabelas/legendas para o operador enxergar nome E identificador.
 */
export function deviceLabelWithMac(d: DeviceLike): string {
  const main = d.displayAlias?.trim() || d.name?.trim();
  return main ? `${main} (${d.mac})` : d.mac;
}
