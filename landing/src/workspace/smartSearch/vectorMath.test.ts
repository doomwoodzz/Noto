import { describe, expect, it } from "vitest";
import { cosine, dot, l2normalize } from "./vectorMath";

describe("vectorMath", () => {
  it("normalizes to unit length", () => {
    const out = l2normalize(new Float32Array([3, 4]));
    expect(Math.hypot(out[0], out[1])).toBeCloseTo(1, 6);
    expect(out[0]).toBeCloseTo(0.6, 6);
    expect(out[1]).toBeCloseTo(0.8, 6);
  });

  it("dot of normalized vectors equals cosine", () => {
    const a = l2normalize(new Float32Array([1, 2, 3]));
    const b = l2normalize(new Float32Array([2, 1, 0]));
    expect(dot(a, b)).toBeCloseTo(cosine([1, 2, 3], [2, 1, 0]), 6);
  });

  it("cosine: identical=1, orthogonal=0, opposite=-1", () => {
    expect(cosine([1, 1], [2, 2])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it("handles zero vectors without NaN", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(l2normalize(new Float32Array([0, 0]))[0]).toBe(0);
  });
});
