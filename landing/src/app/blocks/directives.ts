// Compact, single-line directive tokens embedded in Markdown as HTML comments.
//
//   <!--noto:KIND key=val key=val-->
//
// HTML comments are invisible in any Markdown renderer, so a note that contains
// rich widgets still degrades to clean text if exported. Values are
// percent-encoded so they can never contain a space or the closing "-->".

export interface Directive {
  kind: string;
  attrs: Record<string, string>;
}

const OPEN = "<!--noto:";
const CLOSE = "-->";

/** Build a directive comment. Empty/undefined attrs are omitted. */
export function encodeDirective(
  kind: string,
  attrs: Record<string, string | number | boolean | undefined> = {},
): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === "") continue;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  return `${OPEN}${kind}${parts.length ? " " + parts.join(" ") : ""}${CLOSE}`;
}

/**
 * Parse a directive comment at the START of a line. Returns the parsed
 * directive plus any trailing text after the comment (callouts carry their
 * text immediately after the token).
 */
export function parseDirectiveAtStart(
  line: string,
): { dir: Directive; rest: string } | null {
  if (!line.startsWith(OPEN)) return null;
  const end = line.indexOf(CLOSE);
  if (end === -1) return null;
  const inner = line.slice(OPEN.length, end); // "KIND key=val ..."
  const rest = line.slice(end + CLOSE.length);
  const space = inner.indexOf(" ");
  const kind = space === -1 ? inner : inner.slice(0, space);
  const attrStr = space === -1 ? "" : inner.slice(space + 1);
  const attrs: Record<string, string> = {};
  for (const tok of attrStr.split(" ")) {
    if (!tok) continue;
    const eq = tok.indexOf("=");
    if (eq === -1) {
      attrs[tok] = "";
      continue;
    }
    const key = tok.slice(0, eq);
    const raw = tok.slice(eq + 1);
    try {
      attrs[key] = decodeURIComponent(raw);
    } catch {
      attrs[key] = raw;
    }
  }
  return { dir: { kind, attrs }, rest };
}

/** Match a trailing task-enrichment token: `… <!--noto:task id=tk_xx-->`. */
const TASK_TOKEN = /\s*<!--noto:task id=([^\s>]+)-->\s*$/;

export function stripTaskToken(text: string): { text: string; taskId?: string } {
  const m = TASK_TOKEN.exec(text);
  if (!m) return { text };
  let taskId = m[1];
  try {
    taskId = decodeURIComponent(m[1]);
  } catch {
    /* keep raw */
  }
  return { text: text.slice(0, m.index), taskId };
}
