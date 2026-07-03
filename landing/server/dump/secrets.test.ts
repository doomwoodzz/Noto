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

  it("redacts opaque secrets named api_key / access_token / clientSecret (not just bare keywords)", () => {
    for (const line of [
      `api_key = "Zk9Qw3eRt7yUi1oP2aSdFgHjKlMnBvCx"`,
      `access_token: "aBcD1234eFgH5678iJkL9012mNoP3456"`,
      `clientSecret="Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6"`,
      `PRIVATE_KEY = "kJhGfDsApOiUyTrEwQ0918273645Mnbv"`,
    ]) {
      const { body, count } = redactSecrets(line);
      expect(count).toBe(1);
      expect(body).toContain("‹redacted:high-entropy›");
    }
  });

  it("redacts a hex/base32 token whose entropy sits just under the 4.0 gate", () => {
    // 40 hex chars → entropy ~3.97 (< 4.0), but it is an opaque credential value.
    const hex = "abcdef0123456789abcdef0123456789abcdef01";
    const { body, count } = redactSecrets(`token = "${hex}"`);
    expect(count).toBe(1);
    expect(body).not.toContain(hex);
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
  }, 8000); // Bounded pattern runs ~1.3s in isolation (~2-3s under full-suite CPU
  // contention); a real super-linear regression on this 1.4MB input is ~28s+, so an
  // 8s ceiling catches any >3x blowup while absorbing parallel-run scheduler jitter.
});
