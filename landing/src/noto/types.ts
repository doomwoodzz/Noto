export interface VaultFile {
  id: string;
  path: string;
  title: string;
  updatedAt: string;
  content: string;
}

export interface FileMetadata {
  fileId: string;
  path: string;
  title: string;
  headings: string[];
  outgoingLinks: string[];
  backlinks: string[];
  tags: string[];
  wordCount: number;
  updatedAt: string;
}

export interface GraphNode {
  id: string;
  title: string;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type RecorderPhase = "idle" | "recording" | "processing" | "complete";

export interface RecorderState {
  phase: RecorderPhase;
  elapsed: number;
  concepts: string[];
  targetNoteTitle: string;
}

export interface AIMemory {
  concepts: string[];
  linked: string[];
}

export type GraphFilter = "all" | "local" | "lecture" | "orphan";
export type WorkspaceTab = "note" | "graph";
