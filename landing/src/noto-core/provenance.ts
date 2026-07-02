// Provenance marker for dumped (externally-sourced, untrusted) notes.
// Appended as the LAST line of a note body. Parsed from the note tail.
import type { ProvenanceOrigin } from "../../server/dump/types.ts";

export interface ParsedProvenance extends ProvenanceOrigin {
  untrusted: boolean;
  dumpedAt?: number;
}

const FIELDS = ["type", "ref", "url", "path", "repo"] as const;

function esc(v: string): string {
  // Escape the escape char first so a literal "%22"/"%" round-trips losslessly.
  return v.replace(/%/g, "%25").replace(/"/g, "%22").replace(/[\r\n]+/g, " ");
}
function unesc(v: string): string {
  // Reverse order of esc: decode %22 before %25 so "%2522" → "%22" (not '"').
  return v.replace(/%22/g, '"').replace(/%25/g, "%");
}

/** Build the single-line HTML-comment marker. `untrusted=1` is always present. */
export function buildProvenanceMarker(origin: ProvenanceOrigin, dumpedAt: number): string {
  const parts: string[] = ["v=1", `type=${origin.type}`, "untrusted=1"];
  for (const f of FIELDS) {
    if (f === "type") continue;
    const val = origin[f as keyof ProvenanceOrigin];
    if (val) parts.push(`${f}="${esc(String(val))}"`);
  }
  parts.push(`dumpedAt=${dumpedAt}`);
  return `<!-- noto:source ${parts.join(" ")} -->`;
}

/** Parse a marker from the LAST 4 non-empty lines of a note body. Returns null if absent. */
export function parseProvenanceMarker(noteBody: string): ParsedProvenance | null {
  const lines = noteBody.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  const tail = lines.slice(Math.max(0, lines.length - 4));
  const line = tail.find((l) => l.trim().startsWith("<!-- noto:source "));
  if (!line) return null;
  const inner = line.trim().replace(/^<!--\s*noto:source\s*/, "").replace(/-->\s*$/, "");
  // A marker is present ⇒ the note is externally sourced. Fail CLOSED: treat as
  // untrusted unless an explicit `untrusted=0` says otherwise.
  const out: ParsedProvenance = { type: "raw", untrusted: true };
  const re = /(\w+)=(?:"([^"]*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) {
    const key = m[1];
    const val = m[2] !== undefined ? unesc(m[2]) : m[3];
    if (key === "type" && (val === "raw" || val === "github" || val === "notion")) out.type = val;
    else if (key === "untrusted") out.untrusted = val === "1";
    else if (key === "dumpedAt") out.dumpedAt = Number(val);
    else if (key === "ref" || key === "url" || key === "path" || key === "repo") out[key] = val;
  }
  return out;
}
