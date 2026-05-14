import Foundation

public struct Vault: Identifiable, Equatable {
    public let id: String
    public private(set) var name: String
    public private(set) var files: [VaultFile]

    public init(id: String, name: String, files: [VaultFile]) {
        self.id = id
        self.name = name
        self.files = files
    }
}

public struct VaultFile: Identifiable, Equatable {
    public let id: String
    public private(set) var path: String
    public private(set) var title: String
    public private(set) var content: String
    public private(set) var createdAt: Date
    public private(set) var updatedAt: Date

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
