// The agent-writable boundary. PAT-authed note writes must stay under Memory/
// so an AI can never clobber a human-authored note elsewhere in the vault.
export const MEMORY_PREFIX = "Memory/";

/** True if a vault-relative path is inside the agent-writable Memory/ folder.
 *  Assumes `path` already passed pathSchema validation (routes validate first). */
export function isMemoryPath(path: string): boolean {
  return path.startsWith(MEMORY_PREFIX) && !path.slice(MEMORY_PREFIX.length).includes("..");
}
