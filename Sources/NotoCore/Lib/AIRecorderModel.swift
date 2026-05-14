import Foundation

public struct AIRecorderModel: Equatable {
    public private(set) var phase: RecorderPhase
    public private(set) var memory: LectureMemory
    public private(set) var elapsedSeconds: Int
    private var conceptIndex: Int

    public init(
        phase: RecorderPhase = .idle,
        memory: LectureMemory = LectureMemory(),
        elapsedSeconds: Int = 0,
        conceptIndex: Int = 0
    ) {
        self.phase = phase
        self.memory = memory
        self.elapsedSeconds = elapsedSeconds
        self.conceptIndex = conceptIndex
    }

    public mutating func start(now: Date) {
        phase = .recording(startedAt: now)
        memory = LectureMemory()
        elapsedSeconds = 0
        conceptIndex = 0
    }

    public mutating func tick() {
        guard phase.isRecording else {
            return
        }

        elapsedSeconds += 2
        let script = Self.script
        guard conceptIndex < script.count else {
            return
        }

        let item = script[conceptIndex]
        conceptIndex += 1

        var concepts = memory.concepts
        var definitions = memory.definitions
        var importantPoints = memory.importantPoints
        var possibleQuestions = memory.possibleQuestions
        var linkedNotes = memory.linkedNotes

        concepts.append(item.concept)
        if let definition = item.definition {
            definitions.append(definition)
        }
        importantPoints.append(item.importantPoint)
        if let question = item.question {
            possibleQuestions.append(question)
        }
        for note in item.linkedNotes where !linkedNotes.contains(note) {
            linkedNotes.append(note)
        }

        memory = LectureMemory(
            concepts: concepts,
            definitions: definitions,
            importantPoints: importantPoints,
            possibleQuestions: possibleQuestions,
            linkedNotes: linkedNotes
        )
    }

    public mutating func stop(targetNoteTitle: String) {
        guard phase.isRecording else {
            return
        }

        if memory.concepts.isEmpty {
            tick()
        }

        phase = .processing
    }

    public mutating func finishProcessing(targetNoteTitle: String) {
        phase = .complete(targetNoteTitle: targetNoteTitle)
    }

    public mutating func reset() {
        phase = .idle
        memory = LectureMemory()
        elapsedSeconds = 0
        conceptIndex = 0
    }

    private struct ScriptItem {
        let concept: String
        let definition: LectureDefinition?
        let importantPoint: String
        let question: String?
        let linkedNotes: [String]
    }

    private static var script: [ScriptItem] {
        [
            ScriptItem(
                concept: "chlorophyll absorbs light",
                definition: LectureDefinition(
                    id: "chlorophyll",
                    term: "Chlorophyll",
                    definition: "Pigment that absorbs light energy."
                ),
                importantPoint: "The teacher emphasized that light absorption starts the process.",
                question: "Why is chlorophyll important?",
                linkedNotes: ["Chloroplast", "Photosynthesis"]
            ),
            ScriptItem(
                concept: "glucose stores chemical energy",
                definition: LectureDefinition(
                    id: "glucose",
                    term: "Glucose",
                    definition: "Sugar molecule that stores chemical energy."
                ),
                importantPoint: "Glucose is the product students should connect to stored energy.",
                question: "Why is glucose important for plant cells?",
                linkedNotes: ["Glucose", "Photosynthesis"]
            ),
            ScriptItem(
                concept: "carbon dioxide enters through stomata",
                definition: nil,
                importantPoint: "Carbon dioxide is a reactant in the photosynthesis process.",
                question: "What role does carbon dioxide play?",
                linkedNotes: ["Carbon Dioxide", "Photosynthesis"]
            ),
            ScriptItem(
                concept: "Calvin cycle produces sugar",
                definition: LectureDefinition(
                    id: "calvin-cycle",
                    term: "Calvin cycle",
                    definition: "Process that helps produce sugar from carbon dioxide."
                ),
                importantPoint: "The Calvin cycle should be compared with light-dependent reactions.",
                question: "Compare light reactions and the Calvin cycle.",
                linkedNotes: ["Photosynthesis", "Glucose"]
            )
        ]
    }
}
