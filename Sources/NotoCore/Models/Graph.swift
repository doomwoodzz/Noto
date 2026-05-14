public enum GraphFilter: String, CaseIterable, Identifiable, Equatable {
    case all
    case local
    case lectureOnly
    case orphans

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .all: return "All Notes"
        case .local: return "Local Graph"
        case .lectureOnly: return "Lecture Notes"
        case .orphans: return "Orphans"
        }
    }
}

public struct GraphNode: Identifiable, Equatable {
    public let id: String
    public let title: String
    public let path: String
    public let backlinksCount: Int
    public let outgoingCount: Int

    public init(id: String, title: String, path: String, backlinksCount: Int, outgoingCount: Int) {
        self.id = id
        self.title = title
        self.path = path
        self.backlinksCount = backlinksCount
        self.outgoingCount = outgoingCount
    }

    public var degree: Int {
        backlinksCount + outgoingCount
    }
}

public struct GraphEdge: Identifiable, Equatable {
    public let id: String
    public let source: String
    public let target: String
    public let weight: Double

    public init(id: String, source: String, target: String, weight: Double) {
        self.id = id
        self.source = source
        self.target = target
        self.weight = weight
    }
}

public struct KnowledgeGraph: Equatable {
    public let nodes: [GraphNode]
    public let edges: [GraphEdge]

    public init(nodes: [GraphNode], edges: [GraphEdge]) {
        self.nodes = nodes
        self.edges = edges
    }
}
