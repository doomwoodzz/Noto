import { afterEach, beforeEach, expect, it, vi } from "vitest";
import crypto from "node:crypto";

const KEY = crypto.randomBytes(32).toString("base64");

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VAULT_KEY_SECRET", KEY);
});
afterEach(() => vi.unstubAllEnvs());

it("encrypts then decrypts back to the original plaintext", async () => {
  const { encryptKey, decryptKey, keyvaultConfigured } = await import("./keyvault.ts");
  expect(keyvaultConfigured()).toBe(true);
  const blob = encryptKey("sk-secret-123");
  expect(Buffer.from(blob).toString("utf8")).not.toContain("sk-secret-123"); // ciphertext
  expect(decryptKey(blob)).toBe("sk-secret-123");
});

it("rejects a tampered ciphertext", async () => {
  const { encryptKey, decryptKey } = await import("./keyvault.ts");
  const blob = encryptKey("sk-secret-123");
  blob[blob.length - 1] ^= 0xff; // corrupt the last ciphertext byte — GCM rejects any modification
  expect(() => decryptKey(blob)).toThrow();
});

it("reports not-configured when the master key is absent", async () => {
  vi.stubEnv("VAULT_KEY_SECRET", "");
  vi.resetModules();
  const { keyvaultConfigured, encryptKey } = await import("./keyvault.ts");
  expect(keyvaultConfigured()).toBe(false);
  expect(() => encryptKey("x")).toThrow();
});
