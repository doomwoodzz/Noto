// Faithful port of Sources/NotoCore/Lib/MetadataCacheBuilder.swift
import type { FileMetadata, MetadataCache, VaultFile } from "./types";
import { extractHeadings, extractTags, extractWikiLinks, wordCount } from "./parser";

export function buildMetadataCache(files: VaultFile[]): MetadataCache {
  const fileIdByTitle = titleLookup(files);

  const backlinksByFileId: Record<string, string[]> = {};
  for (const f of files) backlinksByFileId[f.id] = [];
  const outgoingByFileId: Record<string, string[]> = {};

  for (const file of files) {
    const outgoing = uniquePreservingOrder(extractWikiLinks(file.content));
    outgoingByFileId[file.id] = outgoing;

    for (const title of outgoing) {
      const targetId = fileIdByTitle[title];
      if (targetId === undefined || targetId === file.id) continue;
      (backlinksByFileId[targetId] ??= []).push(file.title);
    }
  }

  const filesById: Record<string, FileMetadata> = {};
  for (const file of files) {
    filesById[file.id] = {
      fileId: file.id,
      path: file.path,
      title: file.title,
      headings: extractHeadings(file.content),
      outgoingLinks: outgoingByFileId[file.id] ?? [],
      backlinks: uniquePreservingOrder(backlinksByFileId[file.id] ?? []),
      tags: extractTags(file.content),
      wordCount: wordCount(file.content),
      updatedAt: file.updatedAt,
    };
  }

  return { filesById, fileIdByTitle };
}

export function metadataFor(cache: MetadataCache, fileId: string): FileMetadata | undefined {
  return cache.filesById[fileId];
}

/** First file wins for a given title (matches the Swift dictionary build). */
function titleLookup(files: VaultFile[]): Record<string, string> {
  const lookup: Record<string, string> = {};
  for (const file of files) {
    if (lookup[file.title] === undefined) lookup[file.title] = file.id;
  }
  return lookup;
}

function uniquePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}
