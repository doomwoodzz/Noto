// Ported from Tests/NotoCoreTests/MarkdownEditorTests.swift
import { describe, expect, it } from "vitest";
import { applyInlineStyle, handleEnter, handleTab } from "./markdownEditor";

describe("markdownEditor", () => {
  it("bold wraps the selection and keeps the inner text selected", () => {
    const r = applyInlineStyle("bold", { content: "Study chlorophyll today", start: 6, end: 17 });
    expect(r.content).toBe("Study **chlorophyll** today");
    expect([r.start, r.end]).toEqual([8, 19]);
  });

  it("italic with an empty selection inserts markers around the cursor", () => {
    const r = applyInlineStyle("italic", { content: "Study today", start: 6, end: 6 });
    expect(r.content).toBe("Study **today");
    expect([r.start, r.end]).toEqual([7, 7]);
  });

  it("underline uses html underline markers", () => {
    const r = applyInlineStyle("underline", { content: "Remember osmosis", start: 9, end: 16 });
    expect(r.content).toBe("Remember <u>osmosis</u>");
    expect([r.start, r.end]).toEqual([12, 19]);
  });

  it("enter after a divider keeps it and moves to the next line", () => {
    const r = handleEnter({ content: "Before\n---", start: 10, end: 10 });
    expect(r.content).toBe("Before\n---\n");
    expect(r.start).toBe(11);
  });

  it("enter continues a non-empty bullet", () => {
    const r = handleEnter({ content: "- first", start: 7, end: 7 });
    expect(r.content).toBe("- first\n- ");
  });

  it("enter on an empty bullet clears it", () => {
    const r = handleEnter({ content: "- first\n-", start: 9, end: 9 });
    expect(r.content).toBe("- first\n");
    expect(r.start).toBe(8);
  });

  it("tab indents the current line", () => {
    const r = handleTab({ content: "First\nSecond", start: 8, end: 8 }, false);
    expect(r.content).toBe("First\n    Second");
    expect(r.start).toBe(12);
  });

  it("shift-tab outdents the current line", () => {
    const r = handleTab({ content: "First\n    Second", start: 10, end: 10 }, true);
    expect(r.content).toBe("First\nSecond");
    expect(r.start).toBe(6);
  });
});
