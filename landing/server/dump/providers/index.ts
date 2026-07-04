// Provider registry. raw is built here (P2); github (P4) and notion (P5) extend it.
import type { SourceProvider } from "../types.ts";
import { rawProvider } from "./raw.ts";

export function getProvider(type: "raw" | "github" | "notion"): SourceProvider {
  switch (type) {
    case "raw":
      return rawProvider;
    case "github":
    case "notion":
      throw new Error(`The ${type} connector is not yet available.`);
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown source type: ${String(_exhaustive)}`);
    }
  }
}
