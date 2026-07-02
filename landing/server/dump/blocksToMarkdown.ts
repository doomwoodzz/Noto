/**
 * Pure Notion-block → Markdown mapping. No I/O, no clock — deterministic.
 *
 * Maps the common block types; unsupported blocks become a labeled placeholder
 * so content is never silently dropped. Rich-text is flattened to plain text
 * (concatenated `plain_text`). Tables render from `table_row` children that the
 * caller inlines immediately after the `table` block.
 */
import type { NotionBlock, NotionRichText } from "../connectors/notion.ts";

/** Flatten a Notion rich-text array to plain text. */
function richText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return (value as NotionRichText[]).map((r) => r?.plain_text ?? "").join("");
}

/** Read the `<type>` payload object off a block. */
function payload(b: NotionBlock): Record<string, unknown> {
  const p = b[b.type];
  return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
}

function tableRowCells(b: NotionBlock): string[] {
  const cells = payload(b).cells;
  if (!Array.isArray(cells)) return [];
  // Each cell is itself a rich-text array.
  return (cells as unknown[]).map((cell) => richText(cell).replace(/\|/g, "\\|").trim());
}

export function blocksToMarkdown(blocks: NotionBlock[]): string {
  const out: string[] = [];
  let numberRun = 0; // running counter for numbered_list_item sequences

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const type = b.type;
    if (type !== "numbered_list_item") numberRun = 0;

    switch (type) {
      case "heading_1":
        out.push(`# ${richText(payload(b).rich_text)}`);
        break;
      case "heading_2":
        out.push(`## ${richText(payload(b).rich_text)}`);
        break;
      case "heading_3":
        out.push(`### ${richText(payload(b).rich_text)}`);
        break;
      case "paragraph": {
        const text = richText(payload(b).rich_text);
        out.push(text); // empty paragraphs become blank lines (spacing)
        break;
      }
      case "bulleted_list_item":
        out.push(`- ${richText(payload(b).rich_text)}`);
        break;
      case "numbered_list_item":
        numberRun += 1;
        out.push(`${numberRun}. ${richText(payload(b).rich_text)}`);
        break;
      case "to_do": {
        const checked = payload(b).checked === true;
        out.push(`- [${checked ? "x" : " "}] ${richText(payload(b).rich_text)}`);
        break;
      }
      case "quote":
        out.push(`> ${richText(payload(b).rich_text)}`);
        break;
      case "callout":
        out.push(`> ${richText(payload(b).rich_text)}`);
        break;
      case "code": {
        const lang = typeof payload(b).language === "string" ? (payload(b).language as string) : "";
        out.push("```" + lang + "\n" + richText(payload(b).rich_text) + "\n```");
        break;
      }
      case "child_page": {
        const title = typeof payload(b).title === "string" ? (payload(b).title as string) : "Untitled";
        out.push(`> [child page: ${title}]`);
        break;
      }
      case "child_database": {
        const title = typeof payload(b).title === "string" ? (payload(b).title as string) : "Untitled";
        out.push(`> [child database: ${title}]`);
        break;
      }
      case "divider":
        out.push("---");
        break;
      case "table": {
        // Consume the immediately-following table_row blocks the caller inlined.
        const rows: string[][] = [];
        let j = i + 1;
        while (j < blocks.length && blocks[j].type === "table_row") {
          rows.push(tableRowCells(blocks[j]));
          j++;
        }
        if (rows.length === 0) {
          out.push("> [unsupported: table]");
          break;
        }
        const width = Math.max(...rows.map((r) => r.length));
        const pad = (r: string[]) => {
          const cells = r.slice();
          while (cells.length < width) cells.push("");
          return `| ${cells.join(" | ")} |`;
        };
        out.push(pad(rows[0]));
        out.push(`| ${Array(width).fill("---").join(" | ")} |`);
        for (let k = 1; k < rows.length; k++) out.push(pad(rows[k]));
        i = j - 1; // skip the consumed rows
        break;
      }
      case "table_row":
        // Consumed by the preceding `table` case; a stray row is ignored.
        break;
      default:
        out.push(`> [unsupported: ${type}]`);
        break;
    }
  }

  // Join with blank lines, then collapse 3+ newlines to a single blank line.
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
