// Provider registry. raw is built here (P2); github (P4) and notion (P5) extend it.
import type { SourceProvider } from "../types.ts";
import { rawProvider } from "./raw.ts";
import { makeGithubProvider } from "./github.ts";
import { notionProvider } from "./notion.ts";

export function getProvider(type: "raw" | "github" | "notion"): SourceProvider {
  switch (type) {
    case "raw":
      return rawProvider;
    case "github":
      return makeGithubProvider();
    case "notion":
      return notionProvider;
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown source type: ${String(_exhaustive)}`);
    }
  }
}
