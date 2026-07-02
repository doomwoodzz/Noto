import { describe, it, expect } from "vitest";
import { redactSecrets } from "./secrets.ts";

describe("redactSecrets", () => {
  it("redacts an AWS access key", () => {
    const { body, count } = redactSecrets("key is AKIAIOSFODNN7EXAMPLE in prod");
    expect(body).toContain("‹redacted:aws-access-key›");
    expect(body).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(count).toBe(1);
  });

  it("redacts a GitHub ghp_ token", () => {
    const tok = "ghp_" + "a".repeat(36);
    const { body, count } = redactSecrets(`token=${tok}`);
    expect(body).toContain("‹redacted:github-token›");
    expect(body).not.toContain(tok);
    expect(count).toBe(1);
  });

  it("redacts a PRIVATE KEY block as one unit", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA" + "x".repeat(40) + "\n-----END RSA PRIVATE KEY-----";
    const { body, count } = redactSecrets(`here:\n${pem}\nend`);
    expect(body).toContain("‹redacted:private-key›");
    expect(body).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(count).toBe(1);
  });

  it("redacts a high-entropy assignment value via the entropy pass", () => {
    // 40 random-looking base64 chars assigned to a `secret = "..."`.
    const secret = "Zk9Qw3eRt7yUi1oP2aSdFgHjKlMnBvCxZ0qWeRtY";
    const { body, count } = redactSecrets(`secret = "${secret}"`);
    expect(body).toContain("‹redacted:high-entropy›");
    expect(body).not.toContain(secret);
    expect(count).toBe(1);
  });

  it("leaves ordinary prose untouched and returns count 0", () => {
    const prose = "The quick brown fox writes notes about photosynthesis and mitochondria.";
    const { body, count } = redactSecrets(prose);
    expect(body).toBe(prose);
    expect(count).toBe(0);
  });

  it("does NOT redact a low-entropy quoted assignment (e.g. a sentence)", () => {
    const s = `password = "please change this later"`;
    const { body, count } = redactSecrets(s);
    expect(body).toBe(s);
    expect(count).toBe(0);
  });

  it("counts multiple distinct secrets", () => {
    const tok = "ghp_" + "b".repeat(36);
    const { count } = redactSecrets(`AKIAIOSFODNN7EXAMPLE and ${tok}`);
    expect(count).toBe(2);
  });

  it("does not catastrophically backtrack on many unterminated BEGIN markers (ReDoS guard)", () => {
    // ~1.4 MB of repeated BEGIN with no END. With an unbounded lazy quantifier this
    // takes ~30s+ (test would time out); the bounded pattern runs in single-digit ms.
    const evil = "-----BEGIN PRIVATE KEY-----\n".repeat(50000);
    const { body, count } = redactSecrets(evil);
    expect(count).toBe(0);        // no complete key block → nothing redacted
    expect(body).toBe(evil);      // body unchanged
  }, 3000); // 3s timeout: fails hard if the regex is still super-linear
});
