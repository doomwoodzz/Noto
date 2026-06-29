import { describe, it, expect } from "vitest";
import { dot, cosine } from "./vec.ts";

describe("vec", () => {
  it("dot of identical unit vectors is 1, orthogonal is 0", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(dot(a, a)).toBeCloseTo(1);
    expect(dot(a, b)).toBeCloseTo(0);
  });
  it("cosine normalizes un-normalized inputs", () => {
    expect(cosine([2, 0], [3, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 5])).toBeCloseTo(0);
  });
});
