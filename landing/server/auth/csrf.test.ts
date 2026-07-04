// Unit tests for the CSRF origin/referer pinning. The double-submit token half
// is exercised end-to-end by the route integration tests; here we pin down the
// origin check itself — in particular that a lookalike Referer host that merely
// starts with APP_ORIGIN (https://our-origin.evil.com) is rejected.
import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import crypto from "node:crypto";
import { csrfProtection } from "./csrf.ts";
import { env } from "../env.ts";

const APP = env.APP_ORIGIN; // http://localhost:5173 in tests

function run(headers: Record<string, string>, cookies: Record<string, string> = {}) {
  const token = crypto.randomBytes(16).toString("base64url");
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = {
    method: "POST",
    apiUser: undefined,
    cookies: { noto_csrf: token, ...cookies },
    get: (name: string) =>
      name.toLowerCase() === "x-csrf-token" ? token : lower[name.toLowerCase()],
  } as unknown as Request;
  let status = 0;
  let nextCalled = false;
  const res = {
    status: (s: number) => {
      status = s;
      return { json: () => undefined };
    },
  } as unknown as Response;
  csrfProtection(req, res, () => {
    nextCalled = true;
  });
  return { status, nextCalled };
}

describe("csrfProtection origin pinning", () => {
  it("allows a matching Origin", () => {
    expect(run({ origin: APP }).nextCalled).toBe(true);
  });

  it("rejects a foreign Origin", () => {
    expect(run({ origin: "https://evil.example" }).status).toBe(403);
  });

  it("allows a same-origin Referer when Origin is absent", () => {
    expect(run({ referer: `${APP}/app` }).nextCalled).toBe(true);
  });

  it("rejects a lookalike Referer host that merely starts with APP_ORIGIN", () => {
    // e.g. APP_ORIGIN http://localhost:5173 vs http://localhost:51731
    expect(run({ referer: `${APP}1/app` }).status).toBe(403);
  });

  it("rejects a Referer whose host embeds the app origin as a prefix label", () => {
    const host = new URL(APP).host;
    expect(run({ referer: `http://${host}.evil.example/x` }).status).toBe(403);
  });

  it("rejects an unparseable Referer", () => {
    expect(run({ referer: "not a url" }).status).toBe(403);
  });

  it("rejects when both Origin and Referer are absent", () => {
    expect(run({}).status).toBe(403);
  });
});
