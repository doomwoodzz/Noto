// Integration tests for the notes API: per-user persistence + isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../app.ts";
import { MAX_VAULTS_PER_USER } from "../db.ts";

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

afterAll(() => {
  server?.close();
});

/** A tiny cookie-jar HTTP client mirroring the browser's CSRF/session flow. */
function makeClient() {
  const cookies = new Map<string, string>();

  function cookieHeader(): string {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  function absorb(res: Response): void {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  async function req(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Origin: ORIGIN };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && method !== "HEAD") {
      headers["X-CSRF-Token"] = cookies.get("noto_csrf") ?? "";
    }
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

  return { req, cookies };
}

async function signup(email: string) {
  const client = makeClient();
  // Prime the CSRF cookie (any GET to /api issues it), then sign up.
  await client.req("GET", "/api/health");
  const res = await client.req("POST", "/api/auth/signup", { email, password: "password123" });
  expect(res.status).toBe(201);
  return client;
}

describe("notes API", () => {
  it("bootstraps a default vault with a Welcome note for a new user", async () => {
    const a = await signup("a@example.com");

    const vaultsRes = await a.req("GET", "/api/vaults");
    expect(vaultsRes.status).toBe(200);
    const { vaults } = await vaultsRes.json();
    expect(vaults).toHaveLength(1);
    expect(vaults[0].name).toBe("My Vault");

    const filesRes = await a.req("GET", `/api/vaults/${vaults[0].id}/files`);
    const { files } = await filesRes.json();
    expect(files).toHaveLength(1);
    expect(files[0].title).toBe("Welcome");
    expect(files[0].path).toBe("Getting Started/Welcome.md");
  });

  it("persists a created note and returns it on reload", async () => {
    const a = await signup("create@example.com");
    const { vaults } = await (await a.req("GET", "/api/vaults")).json();
    const vaultId = vaults[0].id;

    const created = await a.req("POST", `/api/vaults/${vaultId}/files`, {
      path: "Biology/Photosynthesis.md",
      title: "Photosynthesis",
      content: "# Photosynthesis\n\nLinks to [[Welcome]].",
    });
    expect(created.status).toBe(201);
    const { file } = await created.json();
    expect(file.id).toBeTruthy();

    const { files } = await (await a.req("GET", `/api/vaults/${vaultId}/files`)).json();
    const titles = files.map((f: { title: string }) => f.title).sort();
    expect(titles).toEqual(["Photosynthesis", "Welcome"]);

    // Update persists.
    const patched = await a.req("PATCH", `/api/files/${file.id}`, { content: "# Edited" });
    expect(patched.status).toBe(200);
    const reload = await (await a.req("GET", `/api/vaults/${vaultId}/files`)).json();
    const edited = reload.files.find((f: { id: string }) => f.id === file.id);
    expect(edited.content).toBe("# Edited");
  });

  it("isolates data between users (B cannot read or edit A's notes)", async () => {
    const a = await signup("owner@example.com");
    const { vaults: aVaults } = await (await a.req("GET", "/api/vaults")).json();
    const aVaultId = aVaults[0].id;
    const { files: aFiles } = await (await a.req("GET", `/api/vaults/${aVaultId}/files`)).json();
    const aFileId = aFiles[0].id;

    const b = await signup("intruder@example.com");
    // B's own vault is separate.
    const { vaults: bVaults } = await (await b.req("GET", "/api/vaults")).json();
    expect(bVaults[0].id).not.toBe(aVaultId);

    // B cannot list A's vault files, nor patch/delete A's file → 404 (not 403).
    expect((await b.req("GET", `/api/vaults/${aVaultId}/files`)).status).toBe(404);
    expect((await b.req("PATCH", `/api/files/${aFileId}`, { content: "hacked" })).status).toBe(404);
    expect((await b.req("DELETE", `/api/files/${aFileId}`)).status).toBe(404);

    // A's note is untouched.
    const { files: still } = await (await a.req("GET", `/api/vaults/${aVaultId}/files`)).json();
    expect(still[0].content).not.toBe("hacked");
  });

  it("rejects unauthenticated access and path traversal", async () => {
    const anon = makeClient();
    await anon.req("GET", "/api/health");
    expect((await anon.req("GET", "/api/vaults")).status).toBe(401);

    const a = await signup("validate@example.com");
    const { vaults } = await (await a.req("GET", "/api/vaults")).json();
    const vaultId = vaults[0].id;
    const bad = await a.req("POST", `/api/vaults/${vaultId}/files`, {
      path: "../escape.md",
      title: "Evil",
      content: "",
    });
    expect(bad.status).toBe(400);
  });

  it("creates a vault with icon/color and seeds a Welcome note", async () => {
    const a = await signup("mv-create@example.com");
    const res = await a.req("POST", "/api/vaults", { name: "Thesis", icon: "🎓", color: "blue" });
    expect(res.status).toBe(201);
    const { vault } = (await res.json()) as { vault: { id: string; name: string; icon: string; color: string } };
    expect(vault).toMatchObject({ name: "Thesis", icon: "🎓", color: "blue" });

    // It shows up in the list (alongside the bootstrapped default).
    const list = (await (await a.req("GET", "/api/vaults")).json()) as { vaults: { id: string }[] };
    expect(list.vaults.some((v) => v.id === vault.id)).toBe(true);

    // It has a Welcome note.
    const files = (await (await a.req("GET", `/api/vaults/${vault.id}/files`)).json()) as { files: { path: string }[] };
    expect(files.files.some((f) => f.path === "Getting Started/Welcome.md")).toBe(true);
  });

  it("rejects an empty vault name", async () => {
    const a = await signup("mv-empty@example.com");
    const res = await a.req("POST", "/api/vaults", { name: "   " });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const anon = makeClient();
    await anon.req("GET", "/api/health");
    const res = await anon.req("POST", "/api/vaults", { name: "Nope" });
    expect(res.status).toBe(401);
  });

  it("rejects creating beyond the per-user vault cap", async () => {
    const a = await signup("mv-cap@example.com");
    for (let i = 0; i < MAX_VAULTS_PER_USER; i++) {
      const res = await a.req("POST", "/api/vaults", { name: `Vault ${i}` });
      expect(res.status).toBe(201);
    }
    const over = await a.req("POST", "/api/vaults", { name: "One too many" });
    expect(over.status).toBe(409);
  });
});
