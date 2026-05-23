// Noto mock vault — ported from Sources/NotoCore/Data/MockVault.swift
import type { VaultFile, FileMetadata, Graph } from "./types";

const FILES: VaultFile[] = [
  {
    id: "biology-photosynthesis",
    path: "Biology/Photosynthesis.md",
    title: "Photosynthesis",
    updatedAt: "May 13, 2026 at 3:42 PM",
    content: `# Biology Lecture - Photosynthesis

## Key idea
Photosynthesis is the process where plants convert light energy into chemical energy.

## Important terms
- [[Chloroplast]]
- [[Glucose]]
- [[Carbon Dioxide]]
- [[Cell Structure]]

## Summary
The lecture explained how light-dependent reactions and the Calvin cycle work together.

## Questions to review
- [ ] How does chlorophyll absorb light?
- [ ] Why is glucose important for plant cells?
- [ ] What is the role of carbon dioxide?`
  },
  {
    id: "biology-cell-structure",
    path: "Biology/Cell Structure.md",
    title: "Cell Structure",
    updatedAt: "May 12, 2026 at 11:08 AM",
    content: `# Cell Structure

Organelles work together in plant and animal cells.

## Links
- [[Photosynthesis]]
- [[Chloroplast]]`
  },
  {
    id: "biology-enzymes",
    path: "Biology/Enzymes.md",
    title: "Enzymes",
    updatedAt: "May 10, 2026 at 9:14 AM",
    content: `# Enzymes

Enzymes speed up reactions in cells and help metabolic pathways.

## Related
- [[Photosynthesis]]
- [[Glucose]]`
  },
  {
    id: "biology-chloroplast",
    path: "Biology/Chloroplast.md",
    title: "Chloroplast",
    updatedAt: "May 9, 2026 at 2:30 PM",
    content: `# Chloroplast

Chloroplasts are organelles where [[Photosynthesis]] occurs.
#biology`
  },
  {
    id: "biology-glucose",
    path: "Biology/Glucose.md",
    title: "Glucose",
    updatedAt: "May 9, 2026 at 2:30 PM",
    content: `# Glucose

Glucose stores chemical energy produced by [[Photosynthesis]].`
  },
  {
    id: "biology-carbon-dioxide",
    path: "Biology/Carbon Dioxide.md",
    title: "Carbon Dioxide",
    updatedAt: "May 9, 2026 at 2:30 PM",
    content: `# Carbon Dioxide

Carbon dioxide enters leaves through stomata and is used in [[Photosynthesis]].`
  },
  {
    id: "history-cold-war",
    path: "History/Cold War.md",
    title: "Cold War",
    updatedAt: "May 4, 2026 at 4:50 PM",
    content: `# Cold War

A period of geopolitical tension after World War II.
#history`
  },
  {
    id: "history-industrial-revolution",
    path: "History/Industrial Revolution.md",
    title: "Industrial Revolution",
    updatedAt: "May 2, 2026 at 10:11 AM",
    content: `# Industrial Revolution

A major shift from hand production to machine production.`
  },
  {
    id: "math-logarithms",
    path: "Mathematics/Logarithms.md",
    title: "Logarithms",
    updatedAt: "April 28, 2026 at 8:00 AM",
    content: `# Logarithms

Logarithms answer exponent questions.`
  },
  {
    id: "literature-macbeth",
    path: "Literature/Macbeth.md",
    title: "Macbeth",
    updatedAt: "April 26, 2026 at 7:30 PM",
    content: `# Macbeth

A tragedy about ambition, guilt, and prophecy.`
  },
  {
    id: "ai-biology-lecture-may-13",
    path: "AI Lecture Notes/Biology Lecture - May 13.md",
    title: "Biology Lecture - May 13",
    updatedAt: "May 13, 2026 at 4:02 PM",
    content: `# Biology Lecture - May 13

## Today
The teacher connected [[Photosynthesis]], [[Chloroplast]], [[Glucose]], and [[Cell Structure]].

> Important: compare light-dependent reactions with the Calvin cycle.

#lecture #biology`
  }
];

const FOLDER_ORDER = ["Biology", "History", "Mathematics", "Literature", "AI Lecture Notes"];

function buildMetadata(files: VaultFile[]): Omit<FileMetadata, "backlinks">[] {
  return files.map(f => {
    const lines = f.content.split("\n");
    const headings = lines
      .filter(l => /^#{1,6}\s+/.test(l))
      .map(l => l.replace(/^#+\s+/, ""));
    const outgoing: string[] = [];
    const re = /\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content)) !== null) outgoing.push(m[1]);
    const tags = (f.content.match(/#[A-Za-z][A-Za-z0-9_-]*/g) || [])
      .filter(t => !/^#{2,6}\s?/.test(t))
      .map(t => t.slice(1));
    const words = f.content.split(/\s+/).filter(Boolean).length;

    return {
      fileId: f.id,
      path: f.path,
      title: f.title,
      headings,
      outgoingLinks: [...new Set(outgoing)],
      tags: [...new Set(tags)],
      wordCount: words,
      updatedAt: f.updatedAt,
    };
  });
}

function buildBacklinks(metadata: Omit<FileMetadata, "backlinks">[]): FileMetadata[] {
  return metadata.map(m => {
    const backlinks: string[] = [];
    for (const other of metadata) {
      if (other.fileId === m.fileId) continue;
      if (other.outgoingLinks.includes(m.title)) backlinks.push(other.title);
    }
    return { ...m, backlinks };
  });
}

function buildGraph(metadata: FileMetadata[], files: VaultFile[]): Graph {
  const fileIdByTitle: Record<string, string> = {};
  for (const f of files) fileIdByTitle[f.title] = f.id;
  const nodes = metadata.map(m => ({
    id: m.fileId,
    title: m.title,
    degree: m.outgoingLinks.length + m.backlinks.length,
  }));
  const edges: { source: string; target: string }[] = [];
  for (const m of metadata) {
    for (const link of m.outgoingLinks) {
      const targetId = fileIdByTitle[link];
      if (!targetId) continue;
      edges.push({ source: m.fileId, target: targetId });
    }
  }
  return { nodes, edges };
}

const META = buildBacklinks(buildMetadata(FILES));
const GRAPH = buildGraph(META, FILES);

export const NotoData = {
  files: FILES,
  folderOrder: FOLDER_ORDER,
  metadata: META,
  graph: GRAPH,
  metaByFileId: (id: string) => META.find(m => m.fileId === id),
  fileById: (id: string) => FILES.find(f => f.id === id),
  fileIdByTitle: (t: string) => FILES.find(f => f.title === t)?.id,
};
