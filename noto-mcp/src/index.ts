#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createNotoClient } from "./notoClient.js";
import { detectScope } from "./scope.js";
import { makeHandlers } from "./tools.js";

const NOTO_URL = process.env.NOTO_URL;
const NOTO_TOKEN = process.env.NOTO_TOKEN;
if (!NOTO_URL || !NOTO_TOKEN) {
  console.error("noto-mcp: NOTO_URL and NOTO_TOKEN env vars are required.");
  process.exit(1);
}
const client = createNotoClient({
  baseUrl: NOTO_URL,
  token: NOTO_TOKEN,
  client: process.env.NOTO_CLIENT || "claude-code",
});
const scope = detectScope(process.cwd());
const h = makeHandlers(client, { scope });

const server = new McpServer({ name: "noto-mcp", version: "0.1.0" });

server.tool("search_notes", "Search the user's Noto notes; returns heading-addressable refs + snippets. Prefer this over reading whole notes.",
  { query: z.string(), scope: z.string().optional(), tag: z.string().optional(), limit: z.number().int().optional() },
  async (a) => h.search_notes(a));

server.tool("list_notes", "List recent notes as references (no bodies).",
  { by: z.enum(["recent"]).optional(), limit: z.number().int().optional() },
  async (a) => h.list_notes(a));

server.tool("get_note", "Fetch one whole note by id. Prefer get_section when you only need part of it.",
  { fileId: z.string() },
  async (a) => h.get_note(a));

server.tool("get_section", "Fetch one section of a note by heading path (e.g. 'Parent/Child').",
  { fileId: z.string(), heading: z.string() },
  async (a) => h.get_section(a));

server.tool("remember", "Persist a durable decision/preference/fact to shared memory for this project. Store durable things only.",
  { text: z.string(), type: z.enum(["decision", "preference", "fact", "glossary"]).optional(), scope: z.string().optional(), supersedes: z.string().optional() },
  async (a) => h.remember(a));

server.tool("recall", "Recall prior decisions/preferences/facts relevant to a query before acting.",
  { query: z.string(), scope: z.string().optional(), type: z.string().optional(), limit: z.number().int().optional() },
  async (a) => h.recall(a));

server.tool("create_note", "Create a note. Agent writes must live under Memory/ (e.g. 'Memory/decisions.md').",
  { path: z.string(), title: z.string(), content: z.string().optional() },
  async (a) => h.create_note(a));

server.tool("append_note", "Append text to a note (optionally under a heading). Memory/ notes only.",
  { fileId: z.string(), text: z.string(), underHeading: z.string().optional(), expectUpdatedAt: z.number().int().optional() },
  async (a) => h.append_note(a));

server.tool("update_section", "Replace one section of a Memory/ note by heading path. Prefer this over rewriting a whole note.",
  { fileId: z.string(), heading: z.string(), content: z.string(), expectUpdatedAt: z.number().int().optional() },
  async (a) => h.update_section(a));

await server.connect(new StdioServerTransport());
console.error(`noto-mcp ready (scope: ${scope})`);
