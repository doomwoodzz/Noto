// Deterministic, light cleanup of a raw dumped body (Global Constraints §4 hidden-text,
// design §7 body fidelity + §10.3 L1). The LLM never edits the body; this is the ONLY
// transform between the raw source and the stored note (after secret redaction).
//
// Order: neutralize hidden-text injection vectors → strip HTML comments → collapse
// excess blank lines. Idempotent on already-clean text.

// Zero-width + BOM: ZWSP (U+200B), ZWNJ (U+200C), ZWJ (U+200D),
// word-joiner (U+2060), BOM/ZWNBSP (U+FEFF). Written as alternation (not a
// character class) so eslint's no-misleading-character-class does not flag the
// joining ZWJ code point. Behaviour is identical: each code point is stripped.
const ZERO_WIDTH_RE = /\u{200B}|\u{200C}|\u{200D}|\u{2060}|\u{FEFF}/gu;
// Unicode tag characters U+E0000–U+E007F (used to smuggle invisible instructions).
const TAG_CHARS_RE = /[\u{E0000}-\u{E007F}]/gu;
// Bidi overrides/isolates: LRE LRO RLE RLO PDF (U+202A–U+202E), and
// LRI RLI FSI PDI (U+2066–U+2069).
const BIDI_RE = /[\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;
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
