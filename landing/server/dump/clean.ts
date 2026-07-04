// Deterministic, light cleanup of a raw dumped body (Global Constraints §4 hidden-text,
// design §7 body fidelity + §10.3 L1). The LLM never edits the body; this is the ONLY
// transform between the raw source and the stored note (after secret redaction).
//
// Order: neutralize hidden-text injection vectors → strip HTML comments → collapse
// excess blank lines. Idempotent on already-clean text.

// Zero-width + BOM: ZWSP, ZWNJ, ZWJ, word-joiner, BOM/ZWNBSP.
// eslint-disable-next-line no-misleading-character-class -- stripping the individual code points (incl. ZWJ) IS the intent
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
// Unicode tag characters U+E0000–U+E007F (used to smuggle invisible instructions).
const TAG_CHARS_RE = /[\u{E0000}-\u{E007F}]/gu;
// Bidi overrides/isolates: LRE LRO RLE RLO PDF, and LRI RLI FSI PDI.
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/g;
// HTML comments (non-greedy, multi-line).
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
// 3+ consecutive newlines → exactly one blank line.
const EXCESS_BLANKS_RE = /\n{3,}/g;

/** Neutralize hidden-text injection vectors and lightly tidy a dumped body. */
export function cleanBody(raw: string): string {
  return raw
    .replace(ZERO_WIDTH_RE, "")
    .replace(TAG_CHARS_RE, "")
    .replace(BIDI_RE, "")
    .replace(HTML_COMMENT_RE, "")
    .replace(EXCESS_BLANKS_RE, "\n\n");
}
