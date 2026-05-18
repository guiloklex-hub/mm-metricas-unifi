import argon2 from 'argon2';

const ARGON_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024, // 64MB
  timeCost: 3,
  parallelism: 1,
};

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON_OPTS);
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
