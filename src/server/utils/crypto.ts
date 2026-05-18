import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class CryptoError extends Error {
  override readonly name = 'CryptoError';
}

function decodeMasterKey(masterKeyBase64: string): Buffer {
  const key = Buffer.from(masterKeyBase64, 'base64');
  if (key.length !== 32) {
    throw new CryptoError('MASTER_KEY deve ter exatamente 32 bytes após base64-decode');
  }
  return key;
}

/**
 * Cifra `plaintext` em AES-256-GCM. Retorna Buffer no layout:
 *   [12B iv][16B tag][ciphertext]
 * Pronto para ser persistido em uma coluna BLOB.
 */
export function encryptSecret(plaintext: string, masterKeyBase64: string): Buffer {
  const key = decodeMasterKey(masterKeyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function decryptSecret(blob: Buffer, masterKeyBase64: string): string {
  if (blob.length < IV_BYTES + TAG_BYTES + 1) {
    throw new CryptoError('Payload cifrado é muito curto');
  }
  const key = decodeMasterKey(masterKeyBase64);
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new CryptoError(
      'Falha ao decifrar — MASTER_KEY mudou ou payload está corrompido. Re-cadastre o segredo.',
    );
  }
}

/**
 * Compara dois segredos em tempo constante para evitar ataques de timing.
 * Aceita strings ou Buffers; tamanho diferente também é tratado seguramente.
 */
export function constantTimeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const ab = Buffer.isBuffer(a) ? a : Buffer.from(a, 'utf8');
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // mesma quantidade de trabalho independentemente
    return false;
  }
  return timingSafeEqual(ab, bb);
}
