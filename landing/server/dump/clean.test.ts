import { describe, it, expect } from "vitest";
import { cleanBody } from "./clean.ts";

describe("cleanBody", () => {
  it("strips zero-width characters", () => {
    const raw = "hel​lo‌ wor﻿ld‍"; // ZWSP, ZWNJ, BOM, ZWJ
    expect(cleanBody(raw)).toBe("hello world");
  });

  it("strips Unicode tag characters (U+E0000–U+E007F)", () => {
    const hidden = "visible\u{E0041}\u{E0042}\u{E007F}text";
    expect(cleanBody(hidden)).toBe("visibletext");
  });

  it("strips bidi override characters", () => {
    const raw = "a‭b‮c⁦d⁩e"; // LRO, RLO, LRI, PDI
    expect(cleanBody(raw)).toBe("abcde");
  });

  it("strips HTML comments", () => {
    expect(cleanBody("before <!-- secret instruction --> after")).toBe("before  after");
    expect(cleanBody("a\n<!--\nmulti\nline\n-->\nb")).toBe("a\n\nb");
  });

  it("collapses 3+ blank lines to a single blank line", () => {
    expect(cleanBody("a\n\n\n\n\nb")).toBe("a\n\nb");
    expect(cleanBody("a\n\nb")).toBe("a\n\nb"); // two newlines preserved
  });

  it("leaves clean prose untouched", () => {
    const prose = "# Title\n\nA normal paragraph.\n\n- a\n- b\n";
    expect(cleanBody(prose)).toBe(prose);
  });
});
