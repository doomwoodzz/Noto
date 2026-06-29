import { describe, it, expect } from "vitest";
import { floatsToBlob, blobToFloats } from "./db.ts";

describe("embedding BLOB round-trip", () => {
  it("survives floats → blob → floats", () => {
    const v = new Float32Array([0.1, -0.2, 0.333, 1, -1]);
    const back = blobToFloats(floatsToBlob(v));
    expect(Array.from(back)).toEqual(Array.from(v));
    expect(floatsToBlob(v).byteLength).toBe(v.length * 4);
  });

  it("handles a non-zero byteOffset (subarray) input", () => {
    const base = new Float32Array([9, 0.1, -0.2, 0.333, 9]);
    const view = base.subarray(1, 4); // byteOffset = 4 bytes, 3 floats
    const back = blobToFloats(floatsToBlob(view));
    expect(Array.from(back)).toEqual(Array.from(view));
    expect(floatsToBlob(view).byteLength).toBe(12);
  });
});
