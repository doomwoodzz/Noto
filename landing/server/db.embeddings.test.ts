import { describe, it, expect } from "vitest";
import { floatsToBlob, blobToFloats } from "./db.ts";

describe("embedding BLOB round-trip", () => {
  it("survives floats → blob → floats", () => {
    const v = new Float32Array([0.1, -0.2, 0.333, 1, -1]);
    const back = blobToFloats(floatsToBlob(v));
    expect(Array.from(back)).toEqual(Array.from(v));
    expect(floatsToBlob(v).byteLength).toBe(v.length * 4);
  });
});
