import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { Semaphore } from '../util/semaphore.js';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const MAX_MEM = 64 * 1024 * 1024;

/** scrypt is deliberately expensive; cap how many run at once (AGENTS.md §7). */
const hashSlots = new Semaphore(config.limits.loginConcurrentHashes);

/**
 * A valid hash of a value nobody knows, used for unknown usernames so the
 * login response time does not reveal whether the account exists.
 */
const DUMMY_HASH =
  'scrypt$32768$8$1$92HBvM2+a5qUbW6kwT/Jrg==$bnKw2gpafFj22OA5/uORy5TmdLGbMgplgqexMK16Csg=';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  // Refuse absurd parameters from a tampered database: they would be a DoS.
  if (!Number.isInteger(N) || N < 1024 || N > 1 << 20 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 32) return null;
  if (!Number.isInteger(p) || p < 1 || p > 16) return null;
  let salt: Buffer;
  let key: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64');
    key = Buffer.from(parts[5], 'base64');
  } catch {
    return null;
  }
  if (salt.length < 8 || salt.length > 64 || key.length < 16 || key.length > 64) return null;
  return { N, r, p, salt, key };
}

async function derive(password: string, salt: Buffer, keylen: number, N: number, r: number, p: number): Promise<Buffer> {
  const release = await hashSlots.acquire();
  try {
    return await scryptAsync(password, salt, keylen, {
      N,
      r,
      p,
      maxmem: Math.max(MAX_MEM, 128 * N * r + 1024 * 1024),
    });
  } finally {
    release();
  }
}

/** Self-describing format: scrypt$N$r$p$salt-b64$hash-b64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_LENGTH, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) {
    // A damaged hash must fail closed, but still cost roughly one scrypt run.
    await derive(password, randomBytes(16), KEY_LENGTH, SCRYPT_N, SCRYPT_R, SCRYPT_P);
    return false;
  }
  const actual = await derive(password, parsed.salt, parsed.key.length, parsed.N, parsed.r, parsed.p);
  return actual.length === parsed.key.length && timingSafeEqual(actual, parsed.key);
}

/**
 * Run a verification against the dummy hash. Login calls this when the
 * username is unknown so both paths spend the same CPU time.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}

/** True when the stored hash uses parameters older than the current policy. */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return parsed.N !== SCRYPT_N || parsed.r !== SCRYPT_R || parsed.p !== SCRYPT_P || parsed.key.length !== KEY_LENGTH;
}

export interface PasswordPolicyResult {
  ok: boolean;
  reason?: 'too_short' | 'too_long';
}

/** Length first: 10–128 characters, spaces are allowed and not trimmed. */
export function checkPasswordPolicy(password: unknown): PasswordPolicyResult {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'too_short' };
  if (password.length > PASSWORD_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  return { ok: true };
}

/** One-time password for admin resets. Base64url keeps it copy-paste friendly. */
export function generateOneTimePassword(): string {
  return randomBytes(18).toString('base64url');
}
