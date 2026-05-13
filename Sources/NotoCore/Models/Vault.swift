import Foundation

public struct Vault: Identifiable, Equatable {
    public let id: String
    public var name: String
    public var files: [VaultFile]

    public init(id: String, name: String, files: [VaultFile]) {
        self.id = id
        self.name = name
        self.files = files
    }
}

public struct VaultFile: Identifiable, Equatable {
    public let id: String
    public var path: String
    public var title: String
    public var content: String
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: String,
        path: String,
        title: String,
        content: String,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.path = path
        self.title = title
        self.content = content
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
