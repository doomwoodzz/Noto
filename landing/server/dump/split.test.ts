import { describe, it, expect } from "vitest";
import { splitIntoNotes } from "./split.ts";
import type { RawItem } from "./types.ts";

function item(body: string): RawItem {
  return { sourceKey: "raw:abc", title: "Doc", body, origin: { type: "raw" } };
}

describe("splitIntoNotes", () => {
  it("returns a single note for a small single-section doc", () => {
    const out = splitIntoNotes(item("# Only Section\n\nShort body."));
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Doc");
    expect(out[0].sourceKey).toBe("raw:abc");
  });

  it("returns a single note for a multi-section doc UNDER the size threshold", () => {
    const out = splitIntoNotes(item("## A\n\nshort\n\n## B\n\nshort"));
    expect(out).toHaveLength(1);
  });

  it("splits a large multi-H2 doc into one note per section, titled by heading", () => {
    const big = "x".repeat(7000);
    const body = `## Alpha\n\n${big}\n\n## Beta\n\n${big}\n\n## Gamma\n\n${big}`;
    const out = splitIntoNotes(item(body));
    expect(out).toHaveLength(3);
    expect(out.map((n) => n.title)).toEqual(["Alpha", "Beta", "Gamma"]);
    // Each split note's sourceKey is suffixed with #<n>.
    expect(out.map((n) => n.sourceKey)).toEqual(["raw:abc#0", "raw:abc#1", "raw:abc#2"]);
    // Bodies keep their own heading and do not bleed into the next section.
    expect(out[0].body.startsWith("## Alpha")).toBe(true);
    expect(out[0].body).not.toContain("## Beta");
  });

  it("keeps leading content before the first heading with the first note", () => {
    const big = "y".repeat(7000);
    const body = `Intro paragraph.\n\n## One\n\n${big}\n\n## Two\n\n${big}`;
    const out = splitIntoNotes(item(body));
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0].body).toContain("Intro paragraph.");
  });

  it("does not split when there is only ONE top-level heading even if large", () => {
    const big = "z".repeat(9000);
    const out = splitIntoNotes(item(`# Single\n\n${big}`));
    expect(out).toHaveLength(1);
  });
});
