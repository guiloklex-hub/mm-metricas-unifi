import { csvField, csvRow, metricRowToCsv } from '@server/reports/csv.ts';
import { describe, expect, it } from 'vitest';

describe('csvField', () => {
  it('strings simples sem aspas', () => {
    expect(csvField('hello')).toBe('hello');
  });

  it('aspas duplas em volta quando há vírgula', () => {
    expect(csvField('a,b')).toBe('"a,b"');
  });

  it('aspas duplas em volta quando há aspas, com escape', () => {
    expect(csvField('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('aspas duplas em volta quando há newline', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('null/undefined viram string vazia', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('números viram string', () => {
    expect(csvField(42)).toBe('42');
    expect(csvField(0)).toBe('0');
  });
});

describe('csvRow', () => {
  it('junta campos com vírgula e adiciona newline', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('a,b,c\n');
  });

  it('escapa cada campo independentemente', () => {
    expect(csvRow(['a,b', 'c"d', null])).toBe('"a,b","c""d",\n');
  });
});

describe('metricRowToCsv', () => {
  it('formata uma amostra com timestamp ISO', () => {
    const out = metricRowToCsv({
      ts: 1_700_000_000,
      controllerId: 'ctrl-1',
      siteId: 'site-1',
      deviceId: null,
      radio: null,
      clientMac: null,
      clientCount: 24,
      dTxBytes: 1000,
      dTxPackets: 100,
      dTxDropped: 0,
      dTxErrors: 0,
      dTxRetries: 5,
      retryRate: 0.05,
      errorRate: 0,
      dropRate: 0,
    });
    expect(out).toContain('1700000000');
    expect(out).toContain('2023-11-14');
    expect(out).toContain('ctrl-1');
    expect(out).toContain('site-1');
    expect(out).toMatch(/,24,1000,100,0,0,5,0.05,0,0\n$/);
  });

  it('campos null viram vazio', () => {
    const out = metricRowToCsv({
      ts: 0,
      controllerId: 'c',
      siteId: 's',
      deviceId: null,
      radio: null,
      clientMac: null,
      clientCount: null,
      dTxBytes: null,
      dTxPackets: null,
      dTxDropped: null,
      dTxErrors: null,
      dTxRetries: null,
      retryRate: null,
      errorRate: null,
      dropRate: null,
    });
    expect(out).toMatch(/^0,1970-01-01T00:00:00\.000Z,c,s,,,,,,,,,,,,\n$/);
  });
});
