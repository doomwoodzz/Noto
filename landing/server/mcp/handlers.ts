import type { NotoBridgeClient } from "./bridge.ts";
import { markUntrustedResults } from "./markUntrusted.ts";

export interface ToolResult { [key: string]: unknown; content: { type: "text"; text: string }[]; isError?: boolean }
const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const fail = (e: unknown): ToolResult => ({ content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });

/** The 9 tool handlers. `scope` is the X-Noto-Scope default; read tools + remember fall back to it. */
export function makeHandlers(client: NotoBridgeClient, ctx: { scope: string }) {
  return {
    async search_notes(a: { query: string; scope?: string; tag?: string; limit?: number }) {
      try {
        const { results } = await client.searchNotes({ query: a.query, scope: a.scope ?? ctx.scope, tag: a.tag, limit: a.limit });
        // Belt-and-suspenders: /api/search already tags results, but re-tag here so a
        // future non-loopback (direct in-process) client is still covered. Idempotent.
        return ok({ results: markUntrustedResults(results) });
      } catch (e) { return fail(e); }
    },
    async list_notes(a: { by?: string; limit?: number }) {
      try { return ok(await client.listNotes({ by: a.by, limit: a.limit })); } catch (e) { return fail(e); }
    },
    async get_note(a: { fileId: string }) {
      try { return ok(await client.getNote({ fileId: a.fileId })); } catch (e) { return fail(e); }
    },
    async get_section(a: { fileId: string; heading: string }) {
      try { return ok(await client.getSection({ fileId: a.fileId, heading: a.heading })); } catch (e) { return fail(e); }
    },
    async remember(a: { text: string; type?: string; scope?: string; supersedes?: string }) {
      try { return ok(await client.remember({ text: a.text, type: a.type, scope: a.scope ?? ctx.scope, supersedes: a.supersedes })); } catch (e) { return fail(e); }
    },
    async recall(a: { query: string; scope?: string; type?: string; limit?: number }) {
      try { return ok(await client.recall({ query: a.query, scope: a.scope ?? ctx.scope, type: a.type, limit: a.limit })); } catch (e) { return fail(e); }
    },
    async create_note(a: { path: string; title: string; content?: string }) {
      try { return ok(await client.createNote(a)); } catch (e) { return fail(e); }
    },
    async append_note(a: { fileId: string; text: string; underHeading?: string; expectUpdatedAt?: number }) {
      try { return ok(await client.appendNote(a)); } catch (e) { return fail(e); }
    },
    async update_section(a: { fileId: string; heading: string; content: string; expectUpdatedAt?: number }) {
      try { return ok(await client.updateSection(a)); } catch (e) { return fail(e); }
    },
  };
}
export type Handlers = ReturnType<typeof makeHandlers>;
