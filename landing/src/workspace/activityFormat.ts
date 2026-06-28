import type { ActivityEntry } from "./activityClient";

const VERB: Record<string, string> = {
  create_note: "created",
  append_note: "appended to",
  update_section: "edited a section of",
  remember: "remembered",
  supersede: "corrected a memory",
  revert: "reverted",
};

/** One-line human description, e.g. "cursor appended to Memory/decisions.md". */
export function describeActivity(e: ActivityEntry): string {
  const who = e.client ?? e.device ?? "An AI tool";
  const verb = VERB[e.tool] ?? e.tool;
  if (e.target.kind === "memory") {
    const txt = e.target.text ? `“${e.target.text.slice(0, 60)}”` : "a memory";
    return `${who} ${verb} ${txt}`;
  }
  const where = e.target.title ?? e.target.path ?? (e.target.exists ? "a note" : "a deleted note");
  return `${who} ${verb} ${where}`;
}
