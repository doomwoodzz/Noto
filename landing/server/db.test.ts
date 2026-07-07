// landing/server/db.test.ts
import { describe, expect, it } from "vitest";
import { ensureLocalOwner, getUserById, setUserTheme, toPublicUser } from "./db.ts";

describe("local owner", () => {
  it("creates exactly one user row on first call and reuses it thereafter", () => {
    const first = ensureLocalOwner();
    const second = ensureLocalOwner();
    expect(second.id).toBe(first.id);
  });

  it("exposes only the local-first fields on the public shape", () => {
    const owner = ensureLocalOwner();
    setUserTheme(owner.id, "dark");
    const reloaded = getUserById(owner.id)!;
    const pub = toPublicUser(reloaded);
    expect(pub).toEqual({
      id: owner.id,
      displayName: reloaded.display_name,
      avatarUrl: reloaded.avatar_url,
      theme: "dark",
    });
    expect(pub).not.toHaveProperty("email");
    expect(pub).not.toHaveProperty("emailVerified");
  });
});
