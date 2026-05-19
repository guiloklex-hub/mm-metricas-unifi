import { parseAliasCsv } from '@server/http/routes/devices.ts';
import { describe, expect, it } from 'vitest';

describe('parseAliasCsv', () => {
  it('aceita cabeçalho mac,alias', () => {
    const r = parseAliasCsv('mac,alias\naa:bb:cc:dd:ee:ff,Recepção');
    expect(r.parseErrors).toHaveLength(0);
    expect(r.entries).toEqual([{ mac: 'aa:bb:cc:dd:ee:ff', alias: 'Recepção', line: 2 }]);
  });

  it('aceita CSV sem cabeçalho', () => {
    const r = parseAliasCsv('aa:bb:cc:dd:ee:ff,Recepção');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.mac).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('normaliza MAC com hífen e maiúsculas', () => {
    const r = parseAliasCsv('AA-BB-CC-DD-EE-FF,X');
    expect(r.entries[0]?.mac).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('aceita separador ponto-e-vírgula', () => {
    const r = parseAliasCsv('aa:bb:cc:dd:ee:ff;Sala A');
    expect(r.entries[0]?.alias).toBe('Sala A');
  });

  it('respeita aspas em alias com vírgula', () => {
    const r = parseAliasCsv('aa:bb:cc:dd:ee:ff,"Recepção, Térreo"');
    expect(r.entries[0]?.alias).toBe('Recepção, Térreo');
  });

  it('ignora linhas vazias e comentários', () => {
    const r = parseAliasCsv('# comentário\nmac,alias\n\naa:bb:cc:dd:ee:ff,X\n# outro');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.line).toBe(4);
  });

  it('alias vazio vira null (limpa apelido)', () => {
    const r = parseAliasCsv('aa:bb:cc:dd:ee:ff,');
    expect(r.entries[0]?.alias).toBeNull();
  });

  it('MAC inválido vai para parseErrors', () => {
    const r = parseAliasCsv('aa:bb:cc:dd:ee:ff,ok\nlixo-aqui,X');
    expect(r.entries).toHaveLength(1);
    expect(r.parseErrors).toEqual([{ line: 2, mac: 'lixo-aqui', reason: 'mac_invalid' }]);
  });

  it('alias > 120 chars vai para parseErrors', () => {
    const tooLong = 'x'.repeat(121);
    const r = parseAliasCsv(`aa:bb:cc:dd:ee:ff,${tooLong}`);
    expect(r.entries).toHaveLength(0);
    expect(r.parseErrors[0]?.reason).toBe('alias_too_long');
  });

  it('CSV vazio devolve resultado vazio', () => {
    expect(parseAliasCsv('')).toEqual({ entries: [], parseErrors: [] });
  });

  it('suporta CRLF', () => {
    const r = parseAliasCsv('mac,alias\r\naa:bb:cc:dd:ee:01,A\r\naa:bb:cc:dd:ee:02,B');
    expect(r.entries).toHaveLength(2);
  });
});
