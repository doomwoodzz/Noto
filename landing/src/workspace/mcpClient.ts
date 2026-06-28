export interface PatInfo { id: string; name: string; scopes: string[]; createdAt: number; lastUsedAt: number | null }
export interface MemoryInfo { id: string; text: string; type: string; scope: string; sourceClient: string; lastUsed: number }

/** Surface-agnostic contract the Settings panel needs; real impl wraps `api`. */
export interface McpClient {
  listTokens(): Promise<PatInfo[]>;
  mintToken(name: string, scopes: ("read" | "memory" | "write")[]): Promise<{ id: string; token: string }>;
  revokeToken(id: string): Promise<void>;
  listMemories(): Promise<MemoryInfo[]>;
  notoUrl: string;
}
