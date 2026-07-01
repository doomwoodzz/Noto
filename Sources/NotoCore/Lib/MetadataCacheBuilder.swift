import Foundation

public enum MetadataCacheBuilder {
    public static func build(files: [VaultFile]) -> MetadataCache {
        let fileIdByTitle = titleLookup(for: files)
        var backlinksByFileId = Dictionary(uniqueKeysWithValues: files.map { ($0.id, [String]()) })
        var outgoingByFileId: [String: [String]] = [:]

        for file in files {
            let outgoingLinks = uniquePreservingOrder(MarkdownParser.extractWikiLinks(from: file.content))
            outgoingByFileId[file.id] = outgoingLinks

            for title in outgoingLinks {
                guard let targetId = fileIdByTitle[title], targetId != file.id else {
                    continue
                }

                backlinksByFileId[targetId, default: []].append(file.title)
            }
        }

        let metadata = Dictionary(
            uniqueKeysWithValues: files.map { file in
                (
                    file.id,
                    FileMetadata(
                        fileId: file.id,
                        path: file.path,
                        title: file.title,
                        headings: MarkdownParser.extractHeadings(from: file.content),
                        outgoingLinks: outgoingByFileId[file.id, default: []],
                        backlinks: uniquePreservingOrder(backlinksByFileId[file.id, default: []]),
                        tags: MarkdownParser.extractTags(from: file.content),
                        wordCount: MarkdownParser.wordCount(in: file.content),
                        updatedAt: file.updatedAt
                    )
                )
            }
        )

        return MetadataCache(filesById: metadata, fileIdByTitle: fileIdByTitle)
    }

    private static func titleLookup(for files: [VaultFile]) -> [String: String] {
        var lookup: [String: String] = [:]

        for file in files where lookup[file.title] == nil {
            lookup[file.title] = file.id
        }

        return lookup
    }

    private static func uniquePreservingOrder(_ values: [String]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []

        for value in values where !seen.contains(value) {
            seen.insert(value)
            result.append(value)
        }

        return result
    }
}
