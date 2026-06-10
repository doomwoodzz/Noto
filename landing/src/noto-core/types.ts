// Canonical TypeScript port of the Swift NotoCore models.
// Source of truth shared by the web app (and tests). Mirrors:
//   Sources/NotoCore/Models/{Vault,Metadata,Graph,AI}.swift
//
// Timestamps are epoch milliseconds (the Swift models use `Date`); the UI layer
// formats them for display.

export interface VaultFile {
  id: string;
  path: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
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
  updatedAt: number;
}

export interface MetadataCache {
  filesById: Record<string, FileMetadata>;
  fileIdByTitle: Record<string, string>;
}

export interface GraphNode {
  id: string;
  title: string;
  path: string;
  backlinksCount: number;
  outgoingCount: number;
  /** backlinksCount + outgoingCount — mirrors GraphNode.degree in Swift. */
  degree: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type GraphFilter = "all" | "local" | "lectureOnly" | "orphans";

export interface ChecklistItem {
  id: string;
  text: string;
  isComplete: boolean;
}

/* ----------------------------- AI recorder ----------------------------- */

export type RecorderPhase =
  | { kind: "idle" }
  | { kind: "recording"; startedAt: number }
  | { kind: "processing" }
  | { kind: "complete"; targetNoteTitle: string };

export interface LectureDefinition {
  id: string;
  term: string;
  definition: string;
}

export interface LectureMemory {
  concepts: string[];
  definitions: LectureDefinition[];
  importantPoints: string[];
  possibleQuestions: string[];
  linkedNotes: string[];
}

export function emptyLectureMemory(): LectureMemory {
  return {
    concepts: [],
    definitions: [],
    importantPoints: [],
    possibleQuestions: [],
    linkedNotes: [],
  };
}
