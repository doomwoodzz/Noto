import { describe, expect, it } from "vitest";
import { pickInitialVault, VAULT_EMOJI, VAULT_COLORS, tintFor } from "./vaultIcons";

const vaults = [
  { id: "a", name: "A", icon: null, color: null },
  { id: "b", name: "B", icon: null, color: null },
];

describe("pickInitialVault", () => {
  it("prefers the persisted id when it still exists", () => {
    expect(pickInitialVault(vaults, "b")?.id).toBe("b");
  });
  it("falls back to the first vault when the persisted id is gone", () => {
    expect(pickInitialVault(vaults, "zzz")?.id).toBe("a");
  });
  it("falls back to the first vault when nothing is persisted", () => {
    expect(pickInitialVault(vaults, null)?.id).toBe("a");
  });
  it("returns null for an empty list", () => {
    expect(pickInitialVault([], "a")).toBeNull();
  });
});

describe("vault icon constants", () => {
  it("exposes non-empty curated emoji + color sets", () => {
    expect(VAULT_EMOJI.length).toBeGreaterThanOrEqual(8);
    expect(VAULT_COLORS.length).toBeGreaterThanOrEqual(6);
  });
  it("maps a known color token to a tint, and falls back for unknowns", () => {
    expect(tintFor("blue")).toMatch(/rgba|#/);
    expect(tintFor("not-a-color")).toBe(tintFor("blue")); // default = first/accent
    expect(tintFor(null)).toBe(tintFor("blue"));
  });
});
