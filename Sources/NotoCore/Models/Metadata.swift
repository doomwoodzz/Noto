import Foundation

public struct MetadataCache: Equatable {
    public var filesById: [String: FileMetadata]
    public var fileIdByTitle: [String: String]

    public init(filesById: [String: FileMetadata], fileIdByTitle: [String: String]) {
        self.filesById = filesById
        self.fileIdByTitle = fileIdByTitle
    }

    public func metadata(for fileId: String) -> FileMetadata? {
        filesById[fileId]
    }
}

public struct FileMetadata: Identifiable, Equatable {
    public var id: String { fileId }
    public let fileId: String
    public let path: String
    public let title: String
    public let headings: [String]
    public let outgoingLinks: [String]
    public let backlinks: [String]
    public let tags: [String]
    public let wordCount: Int
    public let updatedAt: Date

    public init(
        fileId: String,
        path: String,
        title: String,
        headings: [String],
        outgoingLinks: [String],
        backlinks: [String],
        tags: [String],
        wordCount: Int,
        updatedAt: Date
    ) {
        self.fileId = fileId
        self.path = path
        self.title = title
        self.headings = headings
        self.outgoingLinks = outgoingLinks
        self.backlinks = backlinks
        self.tags = tags
        self.wordCount = wordCount
        self.updatedAt = updatedAt
    }
}
