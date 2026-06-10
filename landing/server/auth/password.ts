/**
 * Password hashing using Node's built-in scrypt (no third-party dependency).
 *
 * scrypt is a memory-hard KDF recommended by OWASP. Each hash embeds its own
 * random 16-byte salt and the parameters used, so we can verify old hashes even
 * if we tune the cost later. Verification is constant-time (timingSafeEqual) to
 * avoid leaking information through timing.
 *
 * Stored format: scrypt$N$r$p$<saltB64>$<hashB64>
 */
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

// OWASP-aligned cost parameters. N=2^16 with r=8 ⇒ ~64 MB of memory per hash,
// which is expensive for an attacker but fine for interactive login latency.
const N = 1 << 16;
const r = 8;
const p = 1;
const KEYLEN = 64;
const MAXMEM = 128 * 1024 * 1024; // headroom above N*r*128

// Defence-in-depth: never feed unbounded input to the KDF (memory DoS). The
// route layer also enforces this, but the primitive guards itself too.
const MAX_PASSWORD_BYTES = 4096;

export async function hashPassword(password: string): Promise<string> {
  if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
    throw new Error("Password too long");
  }
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const n = Number(nStr);
  const rr = Number(rStr);
  const pp = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(rr) || !Number.isInteger(pp)) return false;

  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  let derived: Buffer;
  try {
    derived = await scrypt(password, salt, expected.length, { N: n, r: rr, p: pp, maxmem: MAXMEM });
  } catch {
    return false;
  }
  // Lengths match by construction, but guard timingSafeEqual which throws on mismatch.
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}
