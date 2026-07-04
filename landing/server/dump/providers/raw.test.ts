import { describe, it, expect } from "vitest";
import { rawProvider } from "./raw.ts";
import { getProvider } from "./index.ts";
import type { FetchCtx } from "../types.ts";

function ctx(sourceRef: unknown, cap = 100): FetchCtx & { seen: number[] } {
  const seen: number[] = [];
  return { userId: "u1", sourceRef, cap, onProgress: (n) => seen.push(n), seen };
}

describe("rawProvider", () => {
  it("turns pasted text into one RawItem (sha256 sourceKey, raw origin)", async () => {
    const c = ctx({ type: "raw", text: "# Title\n\nbody" });
    const items = await rawProvider.fetch(c);
    expect(items).toHaveLength(1);
    expect(items[0].body).toBe("# Title\n\nbody");
    expect(items[0].title).toBe("Title"); // first heading
    expect(items[0].sourceKey).toMatch(/^raw:[0-9a-f]{64}$/);
    expect(items[0].origin.type).toBe("raw");
    expect(c.seen.at(-1)).toBe(1);
  });

  it("emits one item per file, titled by filename stem", async () => {
    const c = ctx({ type: "raw", files: [
      { name: "Notes On Cells.md", content: "Cells are units of life." },
      { name: "Energy.txt", content: "# Energy\n\nATP." },
    ] });
    const items = await rawProvider.fetch(c);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Notes On Cells");        // filename stem
    expect(items[1].title).toBe("Energy");                // first heading wins over stem
    expect(items.map((i) => i.origin.type)).toEqual(["raw", "raw"]);
  });

  it("combines files AND pasted text in one fetch", async () => {
    const c = ctx({ type: "raw", text: "pasted body", files: [{ name: "a.md", content: "file body" }] });
    const items = await rawProvider.fetch(c);
    expect(items).toHaveLength(2);
  });

  it("respects ctx.cap (stops after cap items)", async () => {
    const c = ctx({ type: "raw", files: [
      { name: "a.md", content: "a" }, { name: "b.md", content: "b" }, { name: "c.md", content: "c" },
    ] }, 2);
    const items = await rawProvider.fetch(c);
    expect(items).toHaveLength(2);
  });

  it("ignores empty/whitespace text and files", async () => {
    const c = ctx({ type: "raw", text: "   ", files: [{ name: "x.md", content: "" }] });
    const items = await rawProvider.fetch(c);
    expect(items).toHaveLength(0);
  });
});

describe("getProvider", () => {
  it("returns the raw provider for 'raw'", () => {
    expect(getProvider("raw")).toBe(rawProvider);
  });
  it("returns providers for github and notion (registered in P4/P5)", () => {
    expect(getProvider("github")).toBeTruthy();
    expect(getProvider("notion")).toBeTruthy();
  });
});
