import { describe, it, expect } from "vitest";
import { env } from "../env.ts";

describe("notion env", () => {
  it("exposes a notionConfigured boolean (false under test — no creds)", () => {
    expect(typeof env.notionConfigured).toBe("boolean");
    expect(env.notionConfigured).toBe(false);
  });
});
