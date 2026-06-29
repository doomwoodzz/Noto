import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/** Normalize a git remote URL to a stable, lowercased "host/path" key, or null. */
export function normalizeRemote(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  let host = "", path = "";
  const ssh = u.match(/^[^@]+@([^:]+):(.+)$/); // git@github.com:Acme/Widgets.git
  if (ssh) { host = ssh[1]; path = ssh[2]; }
  else {
    const m = u.match(/^[a-z]+:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i); // https://user:tok@host/g/p
    if (!m) return null;
    host = m[1]; path = m[2];
  }
  path = path.replace(/\.git(?=\/|$)/, "").replace(/\/+$/, "");
  return `${host}/${path}`.toLowerCase();
}

type Exec = (cwd: string) => string;
const gitRemote: Exec = (cwd) =>
  execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd, encoding: "utf8" });

/** Derive the memory scope for `cwd`: git remote if present, else a stable cwd hash. */
export function detectScope(cwd: string, exec: Exec = gitRemote): string {
  try {
    const key = normalizeRemote(exec(cwd));
    if (key) return key;
  } catch { /* no git / no remote → fall through */ }
  return "cwd:" + createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}
