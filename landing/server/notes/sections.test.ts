// server/notes/sections.test.ts
import { describe, expect, it } from "vitest";
import { listHeadings, getSection, replaceSection, appendUnderHeading } from "./sections.ts";

const DOC = "# Cells\n\nIntro line.\n\n## Mitochondria\n\nMakes ATP.\n\n### Cristae\n\nFolded membrane.\n\n## Nucleus\n\nHolds DNA.\n";

describe("section utilities", () => {
  it("lists headings with level and path", () => {
    expect(listHeadings(DOC)).toEqual([
      { level: 1, text: "Cells", path: "Cells" },
      { level: 2, text: "Mitochondria", path: "Cells/Mitochondria" },
      { level: 3, text: "Cristae", path: "Cells/Mitochondria/Cristae" },
      { level: 2, text: "Nucleus", path: "Cells/Nucleus" },
    ]);
  });

  it("gets a section by heading path including nested subsections", () => {
    const sec = getSection(DOC, "Cells/Mitochondria");
    expect(sec).toBe("## Mitochondria\n\nMakes ATP.\n\n### Cristae\n\nFolded membrane.\n");
  });

  it("gets a leaf section bounded by the next same-or-higher heading", () => {
    expect(getSection(DOC, "Cells/Nucleus")).toBe("## Nucleus\n\nHolds DNA.\n");
  });

  it("returns null for a missing heading", () => {
    expect(getSection(DOC, "Cells/Golgi")).toBeNull();
  });

  it("replaces only the targeted section, leaving siblings intact", () => {
    const next = replaceSection(DOC, "Cells/Nucleus", "## Nucleus\n\nHolds the genome.\n");
    expect(next).toContain("Makes ATP.");
    expect(next).toContain("Holds the genome.");
    expect(next).not.toContain("Holds DNA.");
  });

  it("returns null when replacing a missing heading", () => {
    expect(replaceSection(DOC, "Cells/Golgi", "x")).toBeNull();
  });
});

const APPEND_DOC = "# Root\n\n## Log\n\n- one\n\n## Other\n\ntail";

it("appendUnderHeading adds text at the end of the section, before the next heading", () => {
  const out = appendUnderHeading(APPEND_DOC, "Root/Log", "- two");
  expect(out).not.toBeNull();
  expect(out).toContain("- one");
  expect(out).toContain("- two");
  // "- two" lands inside Log, before "## Other"
  expect(out!.indexOf("- two")).toBeLessThan(out!.indexOf("## Other"));
  expect(out).toContain("## Other");
});

it("appendUnderHeading returns null for a missing heading", () => {
  expect(appendUnderHeading(APPEND_DOC, "Root/Nope", "x")).toBeNull();
});
