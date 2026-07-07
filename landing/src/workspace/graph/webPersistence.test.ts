import { beforeEach, describe, expect, it } from "vitest";
import { loadWebSettings, saveWebSettings } from "./webPersistence";
import { DEFAULT_SLIDERS, type WebSettings } from "./webTypes";

// The suite runs under the `node` environment (vitest.config.ts), which has no
// localStorage. Provide a minimal in-memory implementation so these tests are
// deterministic and offline — matching the production Storage API this module uses.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  const mem: Storage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true });
}

const KEY = "vault-1";
const PREFIX = "noto:web:v1:";

beforeEach(() => localStorage.clear());

describe("webPersistence", () => {
  it("round-trips settings", () => {
    const settings: WebSettings = {
      sliders: { ...DEFAULT_SLIDERS, repel: 0.8 },
      groups: [{ query: "path:Biology", color: "#578FFA", visible: true }],
    };
    saveWebSettings(KEY, settings);
    expect(loadWebSettings(KEY)).toEqual(settings);
  });

  it("returns null when nothing is stored", () => {
    expect(loadWebSettings(KEY)).toBeNull();
  });

  it("returns null on corrupt JSON", () => {
    localStorage.setItem(PREFIX + KEY, "{not json");
    expect(loadWebSettings(KEY)).toBeNull();
  });

  it("returns null when the groups array is missing", () => {
    localStorage.setItem(PREFIX + KEY, JSON.stringify({ sliders: DEFAULT_SLIDERS }));
    expect(loadWebSettings(KEY)).toBeNull();
  });

  it("preserves an intentionally empty groups array", () => {
    saveWebSettings(KEY, { sliders: DEFAULT_SLIDERS, groups: [] });
    expect(loadWebSettings(KEY)).toEqual({ sliders: DEFAULT_SLIDERS, groups: [] });
  });

  it("clamps out-of-range sliders back to defaults", () => {
    localStorage.setItem(
      PREFIX + KEY,
      JSON.stringify({ sliders: { node: 5, repel: -1 }, groups: [] }),
    );
    const loaded = loadWebSettings(KEY)!;
    expect(loaded.sliders.node).toBe(DEFAULT_SLIDERS.node);
    expect(loaded.sliders.repel).toBe(DEFAULT_SLIDERS.repel);
  });

  it("drops malformed group entries", () => {
    localStorage.setItem(
      PREFIX + KEY,
      JSON.stringify({
        sliders: DEFAULT_SLIDERS,
        groups: [{ query: "path:Bio", color: "#111", visible: true }, { color: "#222" }, null],
      }),
    );
    expect(loadWebSettings(KEY)!.groups).toEqual([
      { query: "path:Bio", color: "#111", visible: true },
    ]);
  });
});
