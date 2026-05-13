import Foundation

public enum RecorderPhase: Equatable {
    case idle
    case recording(startedAt: Date)
    case processing
    case complete(targetNoteTitle: String)

    public var isRecording: Bool {
        if case .recording = self { return true }
        return false
    }
}

public struct LectureDefinition: Identifiable, Equatable {
    public let id: String
    public var term: String
    public var definition: String

    public init(id: String, term: String, definition: String) {
        self.id = id
        self.term = term
        self.definition = definition
    }
}

public struct LectureMemory: Equatable {
    public var concepts: [String]
    public var definitions: [LectureDefinition]
    public var importantPoints: [String]
    public var possibleQuestions: [String]
    public var linkedNotes: [String]

    public init(
        concepts: [String] = [],
        definitions: [LectureDefinition] = [],
        importantPoints: [String] = [],
        possibleQuestions: [String] = [],
        linkedNotes: [String] = []
    ) {
        self.concepts = concepts
        self.definitions = definitions
        self.importantPoints = importantPoints
        self.possibleQuestions = possibleQuestions
        self.linkedNotes = linkedNotes
    }
}
