import { afterEach, beforeEach, expect, it, vi } from "vitest";
import crypto from "node:crypto";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VAULT_KEY_SECRET", crypto.randomBytes(32).toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());

it("returns the decrypted key + model for an owned vault, {} otherwise", async () => {
  const db = await import("../db.ts");
  const { encryptKey } = await import("./keyvault.ts");
  const { resolveVaultAI } = await import("./vaultAI.ts");

  const user = db.createUser({ email: `vai-${crypto.randomUUID()}@x.io` });
  const vault = db.createVault(user.id, { name: "V" });
  db.setVaultAI(vault.id, { provider: "openai", model: "gpt-4o", apiKeyCipher: encryptKey("sk-live-xyz") });

  expect(resolveVaultAI(user.id, vault.id)).toEqual({ apiKey: "sk-live-xyz", model: "gpt-4o" });
  expect(resolveVaultAI(user.id, "not-a-vault")).toEqual({});
  expect(resolveVaultAI("someone-else", vault.id)).toEqual({}); // ownership enforced
  expect(resolveVaultAI(user.id, undefined)).toEqual({});
});
