import { randomBytes } from 'node:crypto';
import {
  CryptoError,
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
} from '@server/utils/crypto.ts';
import { describe, expect, it } from 'vitest';

function randomKey(): string {
  return randomBytes(32).toString('base64');
}

describe('encryptSecret / decryptSecret', () => {
  it('round-trip de string ASCII simples', () => {
    const key = randomKey();
    const ct = encryptSecret('hello-world', key);
    expect(decryptSecret(ct, key)).toBe('hello-world');
  });

  it('preserva acentos e bytes multi-byte', () => {
    const key = randomKey();
    const text = 'senha-do-controlador-123-áéíóú-✅';
    const ct = encryptSecret(text, key);
    expect(decryptSecret(ct, key)).toBe(text);
  });

  it('produz ciphertexts diferentes para mesmo plaintext (IV aleatório)', () => {
    const key = randomKey();
    const a = encryptSecret('abc', key);
    const b = encryptSecret('abc', key);
    expect(a.equals(b)).toBe(false);
  });

  it('chave errada lança CryptoError', () => {
    const ct = encryptSecret('abc', randomKey());
    expect(() => decryptSecret(ct, randomKey())).toThrow(CryptoError);
  });

  it('payload corrompido lança CryptoError', () => {
    const key = randomKey();
    const ct = encryptSecret('abc', key);
    ct[5] ^= 0xff;
    expect(() => decryptSecret(ct, key)).toThrow(CryptoError);
  });

  it('rejeita MASTER_KEY de tamanho incorreto', () => {
    expect(() => encryptSecret('x', Buffer.alloc(16).toString('base64'))).toThrow(CryptoError);
  });
});

describe('constantTimeEqual', () => {
  it('iguais retornam true', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
  });
  it('diferentes (mesmo tamanho) retornam false', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });
  it('tamanhos diferentes retornam false', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
  it('aceita Buffer', () => {
    expect(constantTimeEqual(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
  });
});
