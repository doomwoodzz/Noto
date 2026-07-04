import { describe, it, expect } from "vitest";
import { manifestToRows, countsLabel, selectableItemIds, phaseLabel } from "./dumpView.ts";
import type { ManifestItem, DumpCounts } from "./dumpTypes.ts";

const items: ManifestItem[] = [
  { itemId: "a", title: "Alpha", summary: "s", tags: ["x"], linkCount: 2, notePath: "Dump/s/Alpha.md", redactionCount: 1, status: "new" },
  { itemId: "b", title: "Beta", summary: "", tags: [], linkCount: 0, notePath: "Dump/s/Beta.md", redactionCount: 0, status: "duplicate", dedupOf: "f1" },
  { itemId: "c", title: "Gamma", summary: "g", tags: [], linkCount: 1, notePath: "Dump/s/Gamma.md", redactionCount: 0, status: "update", dedupOf: "f2" },
];

describe("manifestToRows", () => {
  it("flags redactions and maps a badge per status", () => {
    const rows = manifestToRows(items);
    expect(rows[0].redacted).toBe(true);
    expect(rows[0].badge).toBeNull();           // "new" has no badge
    expect(rows[1].badge).toBe("Duplicate");
    expect(rows[2].badge).toBe("Update");
    expect(rows[1].redacted).toBe(false);
  });
  it("defaults selection: new + update selected, duplicate deselected", () => {
    const rows = manifestToRows(items);
    expect(rows.find((r) => r.itemId === "a")!.defaultSelected).toBe(true);
    expect(rows.find((r) => r.itemId === "c")!.defaultSelected).toBe(true);
    expect(rows.find((r) => r.itemId === "b")!.defaultSelected).toBe(false);
  });
});

describe("selectableItemIds", () => {
  it("returns only non-duplicate ids (the ones a user can commit)", () => {
    expect(selectableItemIds(items).sort()).toEqual(["a", "c"]);
  });
});

describe("countsLabel", () => {
  it("summarizes the progress counters compactly", () => {
    const c: DumpCounts = { fetched: 5, shaped: 3, redacted: 2 };
    expect(countsLabel(c)).toContain("5 fetched");
    expect(countsLabel(c)).toContain("3 shaped");
    expect(countsLabel(c)).toContain("2 redacted");
  });
  it("renders an em dash when there is nothing to report", () => {
    expect(countsLabel({})).toBe("—");
  });
});

describe("phaseLabel", () => {
  it("maps a status to human copy", () => {
    expect(phaseLabel("fetching")).toBe("Fetching…");
    expect(phaseLabel("awaiting_review")).toBe("Ready to review");
    expect(phaseLabel("done")).toBe("Done");
  });
});
