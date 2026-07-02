/**
 * GitHub SourceProvider — enumerate a repo's PROSE into RawItems for the pipeline.
 *
 * Prose only (README*, *.md, /docs/**, + optional glob); code/binaries excluded.
 * The repo tree is read at the default-branch head, filtered, sorted by path
 * (deterministic), and truncated at ctx.cap BEFORE any content fetch (over-cap
 * items never cost a blob read / LLM call). Per-item failures are skipped so the
 * rest of the dump proceeds. All GitHub HTTP is behind an injectable GhClient.
 */
import { mintInstallationToken, ghFetch } from "../../connectors/githubApp.ts";
import { getConnectorToken } from "../../db.ts";
import type { RawItem, SourceProvider, FetchCtx } from "../types.ts";

const GITHUB_API = "https://api.github.com";

interface TreeEntry { path: string; type: string; sha: string }
interface IssueEntry { number: number; title: string; body: string | null; html_url: string; updated_at: string }

/** Injectable GitHub REST surface. Default impl uses ghFetch (SSRF-checked + installation token). */
export interface GhClient {
  mintToken(userId: string): Promise<string>;
  getRepo(token: string, repo: string): Promise<{ default_branch: string }>;
  getTree(token: string, repo: string, ref: string): Promise<{ tree: TreeEntry[]; truncated: boolean }>;
  getBlob(token: string, repo: string, path: string, ref: string): Promise<{ contentB64: string }>;
  listIssues(token: string, repo: string, cap: number): Promise<IssueEntry[]>;
}

const PROSE_NAME = /^(readme(\.(md|markdown|mdx|txt))?|.*\.(md|markdown|mdx))$/i;

/** Glob → RegExp for a leading directory scope like `docs/**` or `notes/**`. */
function globToDirRe(glob: string): RegExp | null {
  const cleaned = glob.trim().replace(/\/\*\*?$/, "");
  if (!cleaned || /[\\]/.test(cleaned)) return null;
  const esc = cleaned.replace(/[.*+?^${}()|[\]]/g, "\\$&");
  return new RegExp(`^${esc}/`, "i");
}

/**
 * Pure prose filter. A path is prose when it is a README / *.md(x) / under docs/,
 * OR (when `glob` is given) under that glob's directory AND still a prose file
 * type. The glob widens the *path scope*, not the allowed file types — so a
 * `notes/**` glob will not pull `notes/data.csv`.
 */
export function isProsePath(path: string, glob?: string): boolean {
  if (path.split("/").some((seg) => seg.startsWith("."))) return false; // skip dotfiles/dirs (.github, .git…)
  const base = path.split("/").pop() ?? path;
  const isProseFile = PROSE_NAME.test(base);
  if (!isProseFile) return false;
  if (/^docs\//i.test(path) || !path.includes("/")) return true; // /docs/** or top-level prose
  if (glob) {
    const dirRe = globToDirRe(glob);
    if (dirRe && dirRe.test(path)) return true;
  }
  return /\.(md|markdown|mdx)$/i.test(path) && /^docs\//i.test(path);
}

function parseRef(ref: unknown): { repo: string; includeIssues: boolean; glob?: string } {
  const r = (ref ?? {}) as { repo?: unknown; includeIssues?: unknown; glob?: unknown };
  const repo = typeof r.repo === "string" ? r.repo : "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Invalid GitHub repo (expected owner/name)");
  return { repo, includeIssues: r.includeIssues === true, glob: typeof r.glob === "string" ? r.glob : undefined };
}

/** Default GhClient over the SSRF-checked authenticated ghFetch. */
function defaultClient(): GhClient {
  async function getJson<T>(token: string, url: string): Promise<T> {
    const resp = await ghFetch(url, { token, tokenType: "Bearer" });
    if (!resp.ok) throw new Error(`GitHub ${url} → ${resp.status}`);
    return (await resp.json()) as T;
  }
  return {
    async mintToken(userId) {
      const row = getConnectorToken(userId, "github");
      if (!row?.installation_id) throw new Error("GitHub is not connected");
      return (await mintInstallationToken(row.installation_id)).token;
    },
    getRepo: (token, repo) => getJson(token, `${GITHUB_API}/repos/${repo}`),
    getTree: (token, repo, ref) => getJson(token, `${GITHUB_API}/repos/${repo}/git/trees/${ref}?recursive=1`),
    async getBlob(token, repo, path, ref) {
      const json = await getJson<{ content?: string }>(
        token,
        `${GITHUB_API}/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
      );
      return { contentB64: json.content ?? "" };
    },
    async listIssues(token, repo, cap) {
      const out: IssueEntry[] = [];
      for (let page = 1; out.length < cap && page <= 10; page++) {
        const batch = await getJson<(IssueEntry & { pull_request?: unknown })[]>(
          token,
          `${GITHUB_API}/repos/${repo}/issues?state=all&per_page=100&page=${page}`,
        );
        if (batch.length === 0) break;
        for (const i of batch) if (!i.pull_request) out.push(i); // exclude PRs
        if (batch.length < 100) break;
      }
      return out.slice(0, cap);
    },
  };
}

/** Build a github provider over a (possibly fake) client. */
export function makeGithubProvider(client: GhClient = defaultClient()): SourceProvider {
  return {
    async fetch(ctx: FetchCtx): Promise<RawItem[]> {
      const { repo, includeIssues, glob } = parseRef(ctx.sourceRef);
      const token = await client.mintToken(ctx.userId);
      const { default_branch } = await client.getRepo(token, repo);
      const { tree } = await client.getTree(token, repo, default_branch);

      // Deterministic order: path-sorted prose blobs, truncated at cap. Sort by
      // codepoint (not localeCompare) so the order is locale-independent and
      // stable across environments (e.g. README.md before docs/…).
      const prose = tree
        .filter((e) => e.type === "blob" && isProsePath(e.path, glob))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .slice(0, ctx.cap);

      const items: RawItem[] = [];
      let fetched = 0;
      for (const entry of prose) {
        try {
          const { contentB64 } = await client.getBlob(token, repo, entry.path, default_branch);
          const body = Buffer.from(contentB64, "base64").toString("utf8");
          items.push({
            // Stable identity (no sha/updated_at) so re-dump detects content change
            // via content_hash and updates in place (design D6).
            sourceKey: `github:${repo}:${entry.path}`,
            title: entry.path.split("/").pop() ?? entry.path,
            body,
            origin: {
              type: "github",
              repo,
              path: entry.path,
              ref: entry.sha,
              url: `https://github.com/${repo}/blob/${entry.sha}/${entry.path}`,
            },
          });
          ctx.onProgress(++fetched);
        } catch {
          // Partial failure: skip this file, keep the rest.
        }
      }

      if (includeIssues && items.length < ctx.cap) {
        try {
          const issues = await client.listIssues(token, repo, ctx.cap - items.length);
          for (const issue of issues) {
            items.push({
              // Stable identity (no sha/updated_at) so re-dump detects content change
              // via content_hash and updates in place (design D6).
              sourceKey: `github:${repo}#${issue.number}`,
              title: `Issue #${issue.number}: ${issue.title}`,
              body: issue.body ?? "",
              origin: { type: "github", repo, path: `issues/${issue.number}`, ref: issue.updated_at, url: issue.html_url },
            });
            ctx.onProgress(++fetched);
          }
        } catch {
          // Issues are best-effort; a listing failure does not fail the dump.
        }
      }

      return items;
    },
  };
}
