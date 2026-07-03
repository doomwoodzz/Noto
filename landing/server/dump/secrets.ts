// Dependency-free secret detection + redaction. Runs FIRST in shapeJob, before
// the body is stored, embedded, or sent to the LLM (Global Constraints §14, design §10.2).
// Scope = credentials only; general PII (emails/phones) is deliberately NOT redacted.

export const SECRET_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "aws-access-key",   re: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "github-token",     re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { label: "github-pat-fine",  re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
  { label: "slack-token",      re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: "stripe-key",       re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { label: "google-api-key",   re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: "openai-key",       re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { label: "jwt",              re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { label: "private-key",      re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]{0,8000}?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
];

// Generic secret assignment: a variable whose name ENDS in a credential word —
// key, secret, token, password, passwd, pwd, credential(s), auth — assigned a
// quoted value. A bare `\b(?:key|…)\b` misses the common real-world names
// (`api_key`, `access_token`, `clientSecret`, `refreshToken`, `private_key`)
// because `_` is a word char and camelCase has no internal `\b`; the leading
// `(?<![\w-])[\w-]{0,40}?` consumes any such prefix up to the credential word.
const ASSIGNMENT_RE =
  /(?<![\w-])[\w-]{0,40}?(?:key|secret|token|password|passwd|pwd|credentials?|auth)\s*[:=]\s*["'`]([^"'`\n]{20,})["'`]/gi;

const ENTROPY_MIN = 4.0;
const ENTROPY_MIN_LEN = 20;

/** Shannon entropy (bits/char) of a string. */
function shannonEntropy(s: string): number {
  if (!s) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * Redact credentials in `body`, returning the redacted text and a hit count.
 * `private-key` blocks are matched first (multi-line), then the labeled
 * single-token patterns, then a high-entropy assignment-value pass. A single
 * accumulating pass; later passes operate on already-redacted text so they
 * never re-touch a `‹redacted:…›` placeholder.
 */
export function redactSecrets(body: string): { body: string; count: number } {
  let out = body;
  let count = 0;

  // Ordered: private-key block (last in the list but run first), then the rest.
  const ordered = [
    ...SECRET_PATTERNS.filter((p) => p.label === "private-key"),
    ...SECRET_PATTERNS.filter((p) => p.label !== "private-key"),
  ];
  for (const { label, re } of ordered) {
    out = out.replace(re, () => {
      count += 1;
      return `‹redacted:${label}›`;
    });
  }

  // Value pass: redact only the assignment VALUE, keep the key name.
  out = out.replace(ASSIGNMENT_RE, (match, value: string) => {
    if (value.includes("‹redacted:")) return match; // already handled above
    if (value.length < ENTROPY_MIN_LEN) return match;
    // An opaque token (no internal whitespace) assigned to a credential-named
    // variable is a secret regardless of entropy — this catches hex/base32 keys
    // whose entropy sits just under the 4.0 gate (e.g. a 40-char SHA-style token).
    // A value WITH whitespace still needs high entropy so a prose sentence like
    // `password = "please change this later"` is left untouched.
    const opaque = !/\s/.test(value);
    if (!opaque && shannonEntropy(value) < ENTROPY_MIN) return match;
    count += 1;
    const quote = match[match.length - 1];
    const prefix = match.slice(0, match.indexOf(value));
    return `${prefix}‹redacted:high-entropy›${quote}`;
  });

  return { body: out, count };
}
