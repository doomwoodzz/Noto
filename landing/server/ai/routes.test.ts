// Integration tests for the AI API: auth gating + happy paths.
//
// The OpenAI module is mocked so these run offline and for free — we're testing
// the route wiring (auth, validation, response shape), not the model.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";

// Mock the OpenAI wrapper before importing the app (which transitively imports it).
vi.mock("./openai.ts", () => ({
  TEXT_MODEL: "mock-text",
  TRANSCRIBE_MODEL: "mock-transcribe",
  MAX_TOKENS: { chat: 1, summarize: 1, flashcards: 1, findLinks: 1, lecture: 1 },
  complete: vi.fn(async () => ({ text: "MOCK_REPLY", inputTokens: 10, outputTokens: 5 })),
  transcribe: vi.fn(async () => "mock transcript text"),
  clientFor: vi.fn(() => ({})),
  AINotConfiguredError: class extends Error {},
}));

import { complete } from "./openai.ts";
import { createApp } from "../app.ts";

const ORIGIN = "http://localhost:5173";
let server: Server;
let baseURL = "";

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseURL = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => server?.close());

function makeClient() {
  const cookies = new Map<string, string>();
  const cookieHeader = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  function absorb(res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  async function req(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Origin: ORIGIN };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && method !== "HEAD") headers["X-CSRF-Token"] = cookies.get("noto_csrf") ?? "";
    if (cookies.size > 0) headers["Cookie"] = cookieHeader();
    const res = await fetch(baseURL + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    absorb(res);
    return res;
  }
  return { req };
}

async function signup(email: string) {
  const client = makeClient();
  await client.req("GET", "/api/health");
  const res = await client.req("POST", "/api/auth/signup", { email, password: "password123" });
  expect(res.status).toBe(201);
  return client;
}

describe("ai API", () => {
  it("rejects unauthenticated AI calls with 401", async () => {
    const anon = makeClient();
    await anon.req("GET", "/api/health");
    const res = await anon.req("POST", "/api/ai/chat", { question: "hello" });
    expect(res.status).toBe(401);
  });

  it("validates the chat body", async () => {
    const a = await signup("ai-validate@example.com");
    const res = await a.req("POST", "/api/ai/chat", { question: "" });
    expect(res.status).toBe(400);
  });

  it("returns a chat reply for an authenticated user", async () => {
    const a = await signup("ai-chat@example.com");
    const res = await a.req("POST", "/api/ai/chat", {
      noteTitle: "Photosynthesis",
      noteContent: "Plants make glucose from light.",
      question: "What is this note about?",
    });
    expect(res.status).toBe(200);
    const { reply } = await res.json();
    expect(reply).toBe("MOCK_REPLY");
  });

  it("parses flashcards out of the model JSON reply", async () => {
    vi.mocked(complete).mockResolvedValueOnce(
      { text: '```json\n[{"q":"Q1","a":"A1"},{"q":"Q2","a":"A2"}]\n```', inputTokens: 20, outputTokens: 30 },
    );
    const a = await signup("ai-cards@example.com");
    const res = await a.req("POST", "/api/ai/flashcards", {
      noteTitle: "Bio",
      noteContent: "Some biology content about cells.",
    });
    expect(res.status).toBe(200);
    const { cards } = await res.json();
    expect(cards).toEqual([
      { q: "Q1", a: "A1" },
      { q: "Q2", a: "A2" },
    ]);
  });

  it("only returns find-links titles that were offered", async () => {
    vi.mocked(complete).mockResolvedValueOnce(
      { text: '["Chloroplast","Not In List"]', inputTokens: 15, outputTokens: 8 },
    );
    const a = await signup("ai-links@example.com");
    const res = await a.req("POST", "/api/ai/find-links", {
      noteTitle: "Photosynthesis",
      noteContent: "About chloroplasts.",
      titles: ["Chloroplast", "Glucose"],
    });
    expect(res.status).toBe(200);
    const { related } = await res.json();
    expect(related).toEqual(["Chloroplast"]); // hallucinated title dropped
  });

  it("structures a transcript into lecture-notes markdown", async () => {
    vi.mocked(complete).mockResolvedValueOnce(
      { text: "## AI Lecture Notes\n### Main explanation\nHi.", inputTokens: 50, outputTokens: 20 },
    );
    const a = await signup("ai-lecture@example.com");
    const res = await a.req("POST", "/api/ai/lecture-notes", {
      transcript: "Today we cover cells.",
      titles: ["Cell Structure"],
    });
    expect(res.status).toBe(200);
    const { markdown } = await res.json();
    expect(markdown).toContain("## AI Lecture Notes");
  });

  // §10.3 L2: the chat schema accepts an optional notePath (untrusted threading).
  it("accepts an optional notePath without a 400 (schema is additive)", async () => {
    const a = await signup("ai-notepath@example.com");
    const res = await a.req("POST", "/api/ai/chat", {
      noteTitle: "Readme",
      noteContent: "plain body",
      notePath: "Dump/acme/Readme.md",
      question: "what is this?",
    });
    // 200 with the mocked OpenAI wrapper — but the guarantee we lock is: never 400.
    expect(res.status).not.toBe(400);
  });
});
