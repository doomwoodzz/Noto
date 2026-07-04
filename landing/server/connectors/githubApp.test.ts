import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { signAppJwt, mintInstallationToken } from "./githubApp.ts";

// A throwaway RSA keypair stands in for the GitHub App private key.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

let savedId: string | undefined;
let savedKey: string | undefined;
beforeEach(() => {
  savedId = process.env.GITHUB_APP_ID;
  savedKey = process.env.GITHUB_APP_PRIVATE_KEY;
  process.env.GITHUB_APP_ID = "123456";
  // Exercise the literal-\n path: store the PEM with escaped newlines.
  process.env.GITHUB_APP_PRIVATE_KEY = PEM.replace(/\n/g, "\\n");
});
afterEach(() => {
  if (savedId === undefined) delete process.env.GITHUB_APP_ID; else process.env.GITHUB_APP_ID = savedId;
  if (savedKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY; else process.env.GITHUB_APP_PRIVATE_KEY = savedKey;
});

describe("signAppJwt", () => {
  it("produces a verifiable RS256 JWT with iss/iat/exp", () => {
    const now = 1_700_000_000;
    const jwt = signAppJwt(now);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toEqual({ iat: now - 60, exp: now + 540, iss: "123456" });

    // The signature verifies against the matching public key over `${h}.${p}`.
    const ok = crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("mintInstallationToken", () => {
  it("POSTs to the installation access_tokens endpoint with a Bearer app JWT", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ token: "ghs_installtoken", expires_at: "2026-01-01T00:00:00Z" }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    };
    const out = await mintInstallationToken("42", fakeFetch);
    expect(out.token).toBe("ghs_installtoken");
    expect(out.expiresAt).toBe(Date.parse("2026-01-01T00:00:00Z"));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.github.com/app/installations/42/access_tokens");
    expect(calls[0].init.method).toBe("POST");
    const headers = new Headers(calls[0].init.headers as HeadersInit);
    expect(headers.get("authorization")).toMatch(/^Bearer eyJ/); // an app JWT
    expect(headers.get("accept")).toBe("application/vnd.github+json");
  });

  it("throws on a non-2xx response", async () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
    await expect(mintInstallationToken("42", fakeFetch)).rejects.toThrow(/GitHub installation token/);
  });
});
