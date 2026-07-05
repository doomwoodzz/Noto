import { beforeEach, describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";

/*
 * Two kinds of tests live here:
 *
 *  1. Install-flow integration tests booting the real createApp() (unconfigured
 *     env → 503 / fail-closed).  These never touch the mocked modules below —
 *     they use the real env because they run against a freshly imported server.
 *
 *  2. Direct handler unit-tests for handleGithubCallback.  The GitHub callback's
 *     installation-ownership check can only be exercised when the connector is
 *     *configured*, so we mock the handler's direct dependencies (env, session,
 *     db, keyvault, githubApp) and stub global fetch for the code exchange.  This
 *     mirrors the vi.mock() style already used in server/ai/routes.test.ts and
 *     server/ai/cache.test.ts.
 */

// Constants + mock fns must be hoisted alongside the vi.mock() factories that
// close over them (vi.mock is lifted to the top of the module).
const { SESSION_SECRET, APP_ORIGIN, getCurrentUser, saveConnectorToken, ghFetch } = vi.hoisted(() => ({
  SESSION_SECRET: "test-session-secret-value-at-least-32-chars-long",
  APP_ORIGIN: "http://localhost:5173",
  getCurrentUser: vi.fn(),
  saveConnectorToken: vi.fn(),
  ghFetch: vi.fn(),
}));

// --- Mocks for the callback handler's direct dependencies -------------------
vi.mock("../env.ts", () => ({
  env: {
    githubConfigured: true,
    isProd: false,
    SESSION_SECRET,
    SESSION_COOKIE_NAME: "noto_session",
    APP_ORIGIN,
    GITHUB_APP_SLUG: "noto-app",
    GITHUB_CLIENT_ID: "gh-client-id",
    GITHUB_CLIENT_SECRET: "gh-client-secret",
    GITHUB_REDIRECT_URI: "http://localhost:5173/api/auth/github/callback",
  },
}));

vi.mock("./session.ts", () => ({ getCurrentUser: (...a: unknown[]) => getCurrentUser(...a) }));

vi.mock("../db.ts", () => ({ saveConnectorToken: (...a: unknown[]) => saveConnectorToken(...a) }));

vi.mock("../ai/keyvault.ts", () => ({
  keyvaultConfigured: () => true,
  encryptKey: (plain: string) => new Uint8Array(Buffer.from(`cipher:${plain}`)),
}));

vi.mock("../connectors/githubApp.ts", () => ({ ghFetch: (...a: unknown[]) => ghFetch(...a) }));

import { handleGithubCallback } from "./github.ts";

// --- Helpers ---------------------------------------------------------------

const STATE_COOKIE = "noto_gh_oauth";

/** Reproduce github.ts signState() so we can forge a valid transient cookie. */
function signState(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

interface FakeRes {
  redirectedTo: string | null;
  statusCode: number | null;
  jsonBody: unknown;
  clearCookie: ReturnType<typeof vi.fn>;
  redirect: (url: string) => void;
  status: (code: number) => FakeRes;
  json: (body: unknown) => void;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    redirectedTo: null,
    statusCode: null,
    jsonBody: undefined,
    clearCookie: vi.fn(),
    redirect(url: string) { this.redirectedTo = url; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.jsonBody = body; },
  };
  return res;
}

/** A callback request with a valid state cookie + session for `userId`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(query: Record<string, string>, userId = "user-1"): any {
  const state = "nonce-abc";
  return {
    query: { state, ...query },
    cookies: { [STATE_COOKIE]: signState({ state, userId }) },
  };
}

/** Read the `error` query param off the redirect URL. */
function errorOf(res: FakeRes): string | null {
  if (!res.redirectedTo) return null;
  return new URL(res.redirectedTo).searchParams.get("error");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default session: the same user who started the install.
  getCurrentUser.mockReturnValue({ id: "user-1" });
});

// --- Direct handler tests (the IDOR fix) -----------------------------------

describe("handleGithubCallback — installation ownership", () => {
  it("(a) rejects a callback with NO code and does not save", async () => {
    const req = makeReq({ installation_id: "42" }); // no `code`
    const res = makeRes();

    await handleGithubCallback(req, res as never);

    expect(errorOf(res)).toBe("github_code");
    expect(saveConnectorToken).not.toHaveBeenCalled();
    // No code means no ownership check runs at all.
    expect(ghFetch).not.toHaveBeenCalled();
  });

  it("(b) rejects when /user/installations does NOT include the installation_id", async () => {
    const req = makeReq({ installation_id: "42", code: "good-code" });
    const res = makeRes();

    // Code exchange succeeds.
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "user-token" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // The user token owns installation 99, NOT 42.
    ghFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ total_count: 1, installations: [{ id: 99 }] }), { status: 200 }),
    );

    await handleGithubCallback(req, res as never);

    expect(errorOf(res)).toBe("github_install_mismatch");
    expect(saveConnectorToken).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("(c) saves once when /user/installations includes the installation_id", async () => {
    const req = makeReq({ installation_id: "42", code: "good-code" });
    const res = makeRes();

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "user-token" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // First ghFetch → installations list (includes 42, as a number).
    ghFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ total_count: 2, installations: [{ id: 7 }, { id: 42 }] }), { status: 200 }),
    );
    // Second ghFetch → /user identity lookup.
    ghFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ login: "octocat" }), { status: 200 }),
    );

    await handleGithubCallback(req, res as never);

    expect(saveConnectorToken).toHaveBeenCalledTimes(1);
    expect(saveConnectorToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        provider: "github",
        installationId: "42",
        externalAccount: "octocat",
      }),
    );
    expect(res.redirectedTo).toContain("connected=1");
    vi.unstubAllGlobals();
  });

  it("fails closed when the code exchange returns no access_token", async () => {
    const req = makeReq({ installation_id: "42", code: "good-code" });
    const res = makeRes();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));

    await handleGithubCallback(req, res as never);

    expect(errorOf(res)).toBe("github_code");
    expect(saveConnectorToken).not.toHaveBeenCalled();
    expect(ghFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("fails closed when /user/installations is not ok", async () => {
    const req = makeReq({ installation_id: "42", code: "good-code" });
    const res = makeRes();

    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "user-token" }), { status: 200 })));
    ghFetch.mockResolvedValueOnce(new Response("nope", { status: 500 }));

    await handleGithubCallback(req, res as never);

    expect(errorOf(res)).toBe("github_install");
    expect(saveConnectorToken).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("preserves the state check — a forged state redirects to github_state and does not save", async () => {
    const res = makeRes();
    // Cookie is for state "nonce-abc" but the query claims a different state.
    const req = {
      query: { state: "attacker-state", installation_id: "42", code: "good-code" },
      cookies: { [STATE_COOKIE]: signState({ state: "nonce-abc", userId: "user-1" }) },
    };

    await handleGithubCallback(req as never, res as never);

    expect(errorOf(res)).toBe("github_state");
    expect(saveConnectorToken).not.toHaveBeenCalled();
  });

  it("preserves the session check — a mismatched session redirects to github_session and does not save", async () => {
    getCurrentUser.mockReturnValue({ id: "someone-else" });
    const req = makeReq({ installation_id: "42", code: "good-code" }, "user-1");
    const res = makeRes();

    await handleGithubCallback(req, res as never);

    expect(errorOf(res)).toBe("github_session");
    expect(saveConnectorToken).not.toHaveBeenCalled();
  });
});
