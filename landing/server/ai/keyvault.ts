/**
 * Encryption for per-vault AI API keys.
 *
 * Keys are stored ONLY as AES-256-GCM ciphertext (iv ‖ tag ‖ ciphertext), under
 * a 32-byte master key from VAULT_KEY_SECRET. The plaintext key never leaves the
 * server, is never logged, and is never serialized into any Public* shape.
 */
import crypto from "node:crypto";
import { env } from "../env.ts";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function masterKey(): Buffer | null {
  if (!env.VAULT_KEY_SECRET) return null;
  const key = Buffer.from(env.VAULT_KEY_SECRET, "base64");
  return key.length === 32 ? key : null;
}

export function keyvaultConfigured(): boolean {
  return masterKey() !== null;
}

export function encryptKey(plaintext: string): Uint8Array {
  const key = masterKey();
  if (!key) throw new Error("VAULT_KEY_SECRET is not configured");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function decryptKey(blob: Uint8Array): string {
  const key = masterKey();
  if (!key) throw new Error("VAULT_KEY_SECRET is not configured");
  const buf = Buffer.from(blob);
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
