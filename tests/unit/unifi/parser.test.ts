import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  computeSiteAggregate,
  normalizeMac,
  normalizeRadio,
  parseClientPayload,
  parseDevicePayload,
} from '@server/unifi/parser.ts';
import type { UnifiClientPayload, UnifiDevicePayload } from '@server/unifi/types.ts';
import { describe, expect, it } from 'vitest';

const fixturesDir = new URL('../../fixtures/', import.meta.url);

function loadFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(name, fixturesDir));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('normalizeMac', () => {
  it('lowercases e troca hífen por dois pontos', () => {
    expect(normalizeMac('AA-BB-CC-11-22-33')).toBe('aa:bb:cc:11:22:33');
    expect(normalizeMac('AA:BB:CC:11:22:33')).toBe('aa:bb:cc:11:22:33');
    expect(normalizeMac('  aa:BB:cc:11:22:33  ')).toBe('aa:bb:cc:11:22:33');
  });
});

describe('normalizeRadio', () => {
  it('mapeia nomes canônicos', () => {
    expect(normalizeRadio({ radio: 'ng' })).toBe('ng');
    expect(normalizeRadio({ radio: 'na' })).toBe('na');
    expect(normalizeRadio({ radio: '6e' })).toBe('6e');
  });

  it('aceita alias ax como 5GHz', () => {
    expect(normalizeRadio({ radio: 'ax' })).toBe('na');
  });

  it('classifica por canal quando nome é inconclusivo', () => {
    expect(normalizeRadio({ channel: 6 })).toBe('ng');
    expect(normalizeRadio({ channel: 36 })).toBe('na');
    expect(normalizeRadio({ channel: 149 })).toBe('na');
    expect(normalizeRadio({ channel: 11 })).toBe('ng');
  });

  it('retorna null quando não há sinal suficiente', () => {
    expect(normalizeRadio({})).toBeNull();
    expect(normalizeRadio({ radio: '' })).toBeNull();
    expect(normalizeRadio({ radio: 'desconhecido' })).toBeNull();
  });
});

describe('parseDevicePayload — fixture realista', () => {
  type DeviceFixture = { data: UnifiDevicePayload[] };
  const fixture = loadFixture<DeviceFixture>('unifi-stat-device.json');
  const ap1 = fixture.data[0]!;

  it('extrai catálogo do device', () => {
    const r = parseDevicePayload(ap1)!;
    expect(r.device).toEqual({
      mac: 'aa:bb:cc:11:22:33',
      name: 'AP-Loja-01',
      model: 'U6-Pro',
      type: 'uap',
    });
  });

  it('produz 4 amostras: 3 rádios + 1 device-aggregate', () => {
    const r = parseDevicePayload(ap1)!;
    expect(r.samples).toHaveLength(4);

    const radioSamples = r.samples.filter((s) => s.radio !== null);
    expect(radioSamples).toHaveLength(3);
    expect(radioSamples.map((s) => s.radio).sort()).toEqual(['6e', 'na', 'ng']);

    const aggregate = r.samples.find((s) => s.radio === null);
    expect(aggregate).toBeDefined();
    expect(aggregate!.deviceMac).toBe('aa:bb:cc:11:22:33');
  });

  it('amostra de rádio captura contadores específicos', () => {
    const r = parseDevicePayload(ap1)!;
    const radioNa = r.samples.find((s) => s.radio === 'na')!;
    expect(radioNa.clientCount).toBe(14);
    expect(radioNa.txBytes).toBe(7000000000);
    expect(radioNa.txPackets).toBe(60000000);
    expect(radioNa.txRetries).toBe(3500000);
    // dropped/errors ficam no nível do device, não do rádio
    expect(radioNa.txDropped).toBeNull();
    expect(radioNa.txErrors).toBeNull();
  });

  it('amostra de device-aggregate captura totais e drop/error/retry', () => {
    const r = parseDevicePayload(ap1)!;
    const agg = r.samples.find((s) => s.radio === null)!;
    expect(agg.clientCount).toBe(24);
    expect(agg.txBytes).toBe(12345678900);
    expect(agg.txPackets).toBe(100000000);
    expect(agg.txDropped).toBe(1234);
    expect(agg.txErrors).toBe(56);
    expect(agg.txRetries).toBe(5400000);
    expect(agg.clientMac).toBeNull();
  });

  it('lida com device sem alguns campos opcionais', () => {
    const minimal: UnifiDevicePayload = {
      mac: 'aa:bb:cc:99:88:77',
      type: 'uap',
    };
    const r = parseDevicePayload(minimal)!;
    expect(r.device.name).toBeNull();
    expect(r.device.model).toBeNull();
    expect(r.samples).toHaveLength(1);
    expect(r.samples[0]!.txBytes).toBeNull();
    expect(r.samples[0]!.clientCount).toBeNull();
  });

  it('retorna null quando MAC ausente', () => {
    expect(parseDevicePayload({ mac: undefined as unknown as string, type: 'uap' })).toBeNull();
  });

  it('snapshot — payload completo do AP de loja', () => {
    expect(parseDevicePayload(ap1)).toMatchSnapshot();
  });

  it('agrega tx_packets/tx_retries dos rádios quando device não os expõe', () => {
    // Firmware visto em campo (UniFi OS 9.x + Wave 1/2): controller só envia
    // tx_bytes no nível do device; tx_packets/tx_retries vêm só por rádio.
    const payload: UnifiDevicePayload = {
      mac: 'f4:92:bf:13:a9:58',
      type: 'uap',
      name: 'BUBA-AP-01',
      tx_bytes: 524343528,
      // tx_packets/tx_dropped/tx_errors/tx_retries ausentes intencionalmente
      radio_table_stats: [
        { radio: 'ng', tx_packets: 100, tx_retries: 30 },
        { radio: 'na', tx_packets: 400, tx_retries: 70 },
      ],
    };
    const r = parseDevicePayload(payload)!;
    const agg = r.samples.find((s) => s.radio === null)!;
    expect(agg.txBytes).toBe(524343528);
    expect(agg.txPackets).toBe(500); // 100 + 400
    expect(agg.txRetries).toBe(100); // 30 + 70
    // controller não expõe → ficam null mesmo
    expect(agg.txDropped).toBeNull();
    expect(agg.txErrors).toBeNull();
  });

  it('prefere valor do device-level quando ambos vêm preenchidos', () => {
    // Evita salto de counter se o firmware passar a expor o campo no futuro:
    // sempre que o controller declara, respeitamos o número dele.
    const payload: UnifiDevicePayload = {
      mac: 'f4:92:bf:13:a9:58',
      type: 'uap',
      tx_packets: 999_999,
      tx_retries: 888,
      radio_table_stats: [
        { radio: 'ng', tx_packets: 100, tx_retries: 30 },
        { radio: 'na', tx_packets: 400, tx_retries: 70 },
      ],
    };
    const r = parseDevicePayload(payload)!;
    const agg = r.samples.find((s) => s.radio === null)!;
    expect(agg.txPackets).toBe(999_999);
    expect(agg.txRetries).toBe(888);
  });

  it('mantém null quando nem device nem rádios reportam o campo', () => {
    const payload: UnifiDevicePayload = {
      mac: 'f4:92:bf:13:a9:58',
      type: 'uap',
      radio_table_stats: [{ radio: 'ng' }, { radio: 'na' }],
    };
    const r = parseDevicePayload(payload)!;
    const agg = r.samples.find((s) => s.radio === null)!;
    expect(agg.txPackets).toBeNull();
    expect(agg.txRetries).toBeNull();
  });
});

describe('computeSiteAggregate', () => {
  type DeviceFixture = { data: UnifiDevicePayload[] };
  const fixture = loadFixture<DeviceFixture>('unifi-stat-device.json');

  it('soma device-aggregates ignorando rádios e clientes', () => {
    const allSamples = fixture.data
      .map((d) => parseDevicePayload(d))
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .flatMap((r) => r.samples);

    const site = computeSiteAggregate(allSamples);
    expect(site.deviceMac).toBeNull();
    expect(site.radio).toBeNull();
    expect(site.clientMac).toBeNull();
    expect(site.clientCount).toBe(36); // 24 + 12
    expect(site.txBytes).toBe(12345678900 + 5432109876);
    expect(site.txPackets).toBe(100000000 + 50000000);
    expect(site.txDropped).toBe(1234 + 500);
    expect(site.txErrors).toBe(56 + 22);
    expect(site.txRetries).toBe(5400000 + 2200000);
  });

  it('vazio retorna null em todas as métricas', () => {
    const site = computeSiteAggregate([]);
    expect(site.txBytes).toBeNull();
    expect(site.clientCount).toBeNull();
  });
});

describe('parseClientPayload', () => {
  type ClientFixture = { data: UnifiClientPayload[] };
  const fixture = loadFixture<ClientFixture>('unifi-stat-sta.json');

  it('extrai amostra de cliente vinculada ao AP', () => {
    const c = fixture.data[0]!;
    const sample = parseClientPayload(c)!;
    expect(sample.clientMac).toBe('11:22:33:44:55:66');
    expect(sample.deviceMac).toBe('aa:bb:cc:11:22:33');
    expect(sample.clientCount).toBe(1);
    expect(sample.txBytes).toBe(800000000);
    expect(sample.radio).toBeNull();
    expect(sample.txDropped).toBeNull();
  });

  it('retorna null quando MAC ausente', () => {
    expect(parseClientPayload({ mac: undefined as unknown as string })).toBeNull();
  });

  it('cliente sem ap_mac (roaming/raro) tem deviceMac null', () => {
    const sample = parseClientPayload({ mac: 'aa:bb:cc:dd:ee:ff' });
    expect(sample!.deviceMac).toBeNull();
  });
});
