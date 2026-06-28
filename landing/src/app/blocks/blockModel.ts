// The note document as an ordered list of typed blocks.
//
// Markdown stays the source of truth: `parseBlocks` turns a note's Markdown
// string into blocks, `serializeBlocks` turns blocks back into Markdown. Text
// and task blocks are normal Markdown; the six rich widget families are encoded
// as compact `<!--noto:…-->` directives (see directives.ts) whose heavy data
// lives in the client-side widget store, keyed by `refId`.
//
// Round-trip invariant: for canonical Markdown (the forms the app itself emits)
// `serializeBlocks(parseBlocks(md)) === md`.

import { encodeDirective, parseDirectiveAtStart, stripTaskToken } from "./directives";

export type WidgetKind =
  | "database"
  | "linked-database"
  | "button"
  | "embed"
  | "form"
  | "chart";

export type BlockType =
  | "paragraph"
  | "heading"
  | "bulleted"
  | "numbered"
  | "quote"
  | "divider"
  | "code"
  | "callout"
  | "toggle"
  | "task"
  | WidgetKind;

export const WIDGET_KINDS: WidgetKind[] = [
  "database",
  "linked-database",
  "button",
  "embed",
  "form",
  "chart",
];

interface Base {
  id: string;
}

export interface ParagraphBlock extends Base { type: "paragraph"; text: string; }
export interface HeadingBlock extends Base { type: "heading"; level: number; text: string; }
export interface BulletedBlock extends Base { type: "bulleted"; text: string; indent: number; }
export interface NumberedBlock extends Base { type: "numbered"; text: string; indent: number; number: number; }
export interface QuoteBlock extends Base { type: "quote"; text: string; }
export interface DividerBlock extends Base { type: "divider"; }
export interface CodeBlock extends Base { type: "code"; lang: string; code: string; }
export interface CalloutBlock extends Base { type: "callout"; icon: string; text: string; }
export interface ToggleBlock extends Base { type: "toggle"; text: string; body: string; open: boolean; }
export interface TaskBlock extends Base { type: "task"; checked: boolean; text: string; taskId?: string; }
export interface WidgetBlock extends Base { type: WidgetKind; refId: string; config: Record<string, string>; }

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | BulletedBlock
  | NumberedBlock
  | QuoteBlock
  | DividerBlock
  | CodeBlock
  | CalloutBlock
  | ToggleBlock
  | TaskBlock
  | WidgetBlock;

/* ------------------------------- identity ------------------------------ */

let seq = 0;
/** A fresh block id — ephemeral, used for React keys and drag; not serialized. */
export function newBlockId(): string {
  seq += 1;
  return `b${Date.now().toString(36)}${seq.toString(36)}`;
}

/** A short, stable id that DOES serialize (widget refs, task tokens). */
export function newRefId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------ predicates ----------------------------- */

const TEXT_BEARING = new Set<BlockType>([
  "paragraph",
  "heading",
  "bulleted",
  "numbered",
  "quote",
  "callout",
  "toggle",
  "task",
]);

export function isTextBearing(b: Block): boolean {
  return TEXT_BEARING.has(b.type);
}

export function isWidget(b: Block): b is WidgetBlock {
  return (WIDGET_KINDS as string[]).includes(b.type);
}

function isWidgetKind(kind: string): kind is WidgetKind {
  return (WIDGET_KINDS as string[]).includes(kind);
}

/** Read a block's editable text, or null for blocks without text. */
export function blockText(b: Block): string | null {
  switch (b.type) {
    case "paragraph":
    case "heading":
    case "bulleted":
    case "numbered":
    case "quote":
    case "callout":
    case "toggle":
    case "task":
      return b.text;
    default:
      return null;
  }
}

/** Return a copy of the block with new text (no-op for textless blocks). */
export function withText(b: Block, text: string): Block {
  if (blockText(b) === null) return b;
  return { ...b, text } as Block;
}

/* ------------------------------- parsing ------------------------------- */

export function parseBlocks(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block ``` … ```
    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      const lang = fence[1].trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // consume the closing ```
      blocks.push({ id: newBlockId(), type: "code", lang, code: body.join("\n") });
      continue;
    }

    // Directive comment <!--noto:KIND …-->
    const parsed = parseDirectiveAtStart(line);
    if (parsed) {
      const { kind, attrs } = parsed.dir;
      if (kind === "callout") {
        blocks.push({
          id: newBlockId(),
          type: "callout",
          icon: attrs.icon || "💡",
          text: parsed.rest,
        });
        i += 1;
        continue;
      }
      if (kind === "toggle") {
        const body: string[] = [];
        i += 1;
        while (i < lines.length && lines[i].startsWith("    ")) {
          body.push(lines[i].slice(4));
          i += 1;
        }
        blocks.push({
          id: newBlockId(),
          type: "toggle",
          text: parsed.rest,
          body: body.join("\n"),
          open: attrs.open === "1",
        });
        continue;
      }
      if (isWidgetKind(kind)) {
        const { id, ...config } = attrs;
        blocks.push({
          id: newBlockId(),
          type: kind,
          refId: id || newRefId(kind.slice(0, 2)),
          config,
        });
        i += 1;
        continue;
      }
      // Unknown directive: fall through and keep it as literal paragraph text.
    }

    blocks.push(parseLine(line));
    i += 1;
  }

  if (blocks.length === 0) {
    blocks.push({ id: newBlockId(), type: "paragraph", text: "" });
  }
  return blocks;
}

function parseLine(line: string): Block {
  const trimmed = line.trim();
  if (trimmed === "---" || trimmed === "***") {
    return { id: newBlockId(), type: "divider" };
  }

  let m = /^(#{1,6})\s+(.*)$/.exec(line);
  if (m) {
    return { id: newBlockId(), type: "heading", level: m[1].length, text: m[2] };
  }

  m = /^(\s*)- \[([ xX])\] (.*)$/.exec(line);
  if (m) {
    const { text, taskId } = stripTaskToken(m[3]);
    return {
      id: newBlockId(),
      type: "task",
      checked: m[2].toLowerCase() === "x",
      text,
      taskId,
    };
  }

  m = /^(\s*)- (.*)$/.exec(line);
  if (m) {
    return { id: newBlockId(), type: "bulleted", indent: m[1].length, text: m[2] };
  }

  m = /^(\s*)(\d+)\. (.*)$/.exec(line);
  if (m) {
    return {
      id: newBlockId(),
      type: "numbered",
      indent: m[1].length,
      number: parseInt(m[2], 10),
      text: m[3],
    };
  }

  m = /^>\s?(.*)$/.exec(line);
  if (m) {
    return { id: newBlockId(), type: "quote", text: m[1] };
  }

  return { id: newBlockId(), type: "paragraph", text: line };
}

/* ----------------------------- serializing ----------------------------- */

export function serializeBlocks(blocks: Block[]): string {
  return blocks.map(serializeBlock).join("\n");
}

function serializeBlock(b: Block): string {
  switch (b.type) {
    case "paragraph":
      return b.text;
    case "heading":
      return "#".repeat(clamp(b.level, 1, 6)) + " " + b.text;
    case "bulleted":
      return " ".repeat(b.indent) + "- " + b.text;
    case "numbered":
      return " ".repeat(b.indent) + b.number + ". " + b.text;
    case "quote":
      return "> " + b.text;
    case "divider":
      return "---";
    case "code":
      return "```" + b.lang + "\n" + b.code + "\n```";
    case "callout":
      return encodeDirective("callout", { icon: b.icon }) + b.text;
    case "toggle": {
      const head = encodeDirective("toggle", { open: b.open ? "1" : undefined }) + b.text;
      const body = b.body
        ? "\n" + b.body.split("\n").map((l) => "    " + l).join("\n")
        : "";
      return head + body;
    }
    case "task": {
      const token = b.taskId ? " " + encodeDirective("task", { id: b.taskId }) : "";
      return "- [" + (b.checked ? "x" : " ") + "] " + b.text + token;
    }
    default:
      return encodeDirective(b.type, { id: b.refId, ...b.config });
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/** Renumber each contiguous run of numbered list items (per indent level). */
export function renumberLists(blocks: Block[]): Block[] {
  let run = 0;
  let prevNumbered = false;
  let prevIndent = -1;
  return blocks.map((b) => {
    if (b.type === "numbered") {
      run = prevNumbered && b.indent === prevIndent ? run + 1 : 1;
      prevNumbered = true;
      prevIndent = b.indent;
      return b.number === run ? b : { ...b, number: run };
    }
    prevNumbered = false;
    prevIndent = -1;
    return b;
  });
}

/* ---------------------------- block factory ---------------------------- */

/** Create a blank block of a given type with sensible defaults. */
export function createBlock(type: BlockType, init: Partial<Block> = {}): Block {
  const id = newBlockId();
  switch (type) {
    case "heading":
      return { id, type, level: 1, text: "", ...init } as HeadingBlock;
    case "bulleted":
      return { id, type, text: "", indent: 0, ...init } as BulletedBlock;
    case "numbered":
      return { id, type, text: "", indent: 0, number: 1, ...init } as NumberedBlock;
    case "quote":
      return { id, type, text: "", ...init } as QuoteBlock;
    case "divider":
      return { id, type, ...init } as DividerBlock;
    case "code":
      return { id, type, lang: "", code: "", ...init } as CodeBlock;
    case "callout":
      return { id, type, icon: "💡", text: "", ...init } as CalloutBlock;
    case "toggle":
      return { id, type, text: "", body: "", open: true, ...init } as ToggleBlock;
    case "task":
      return { id, type, checked: false, text: "", ...init } as TaskBlock;
    case "paragraph":
      return { id, type, text: "", ...init } as ParagraphBlock;
    default:
      // widget
      return {
        id,
        type,
        refId: newRefId(type.slice(0, 2)),
        config: {},
        ...init,
      } as WidgetBlock;
  }
}
