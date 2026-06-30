import { describe, expect, it } from "vitest";
import { pickInitialVault } from "./vaultIcons";

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
