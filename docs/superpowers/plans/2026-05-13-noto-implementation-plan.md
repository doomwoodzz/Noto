# Noto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Noto, a native SwiftUI/SwiftPM macOS visual prototype for a local-first Markdown notes workspace with generated wiki-link metadata, a Knowledge Web graph, and an explicit-consent AI lecture recorder simulation.

**Architecture:** Use a SwiftPM executable product named `Noto` for the SwiftUI app and a small `NotoCore` library target for testable models, parsing, metadata, graph building, note actions, and recorder state. The UI reads in-memory vault data from `AppState`, and all backlinks, outgoing links, graph edges, and AI note insertion behavior are derived from Markdown text.

**Tech Stack:** SwiftPM, Swift 6-compatible Swift, SwiftUI, AppKit for window-level macOS affordances where needed, XCTest for core utilities.

---

## Scope Check

This is one coherent prototype, not multiple products. Keep the first implementation in one SwiftPM package with these bounded layers:

- `NotoCore`: pure Swift models and deterministic utilities.
- `Noto`: SwiftUI views, keyboard shortcuts, app state, and visual prototype shell.
- `NotoCoreTests`: parser, metadata, graph, note action, recorder, and app-state tests.

No real microphone capture, file-system persistence, backend service, sync, or AI service call is in scope for this plan.

## File Map

Create these files:

- `Package.swift`: SwiftPM package definition with `Noto`, `NotoCore`, and `NotoCoreTests`.
- `Sources/Noto/NotoApp.swift`: `@main` SwiftUI app entry.
- `Sources/Noto/AppState.swift`: observable app state used by SwiftUI.
- `Sources/Noto/Views/MacWindowView.swift`: main three-pane desktop window and overlay container.
- `Sources/Noto/Views/TitleBarView.swift`: traffic-light style titlebar and command affordance.
- `Sources/Noto/Views/VaultSidebarView.swift`: vault name, search, new note, file tree, and graph button.
- `Sources/Noto/Views/FileTreeView.swift`: grouped file tree rows.
- `Sources/Noto/Views/MarkdownWorkspaceView.swift`: note and Knowledge Web tab shell.
- `Sources/Noto/Views/MarkdownPreviewView.swift`: Markdown-ish rendered content with clickable wiki links.
- `Sources/Noto/Views/RightContextPanelView.swift`: metadata, outline, backlinks, outgoing links, AI memory.
- `Sources/Noto/Views/KnowledgeGraphView.swift`: generated graph view and graph filters.
- `Sources/Noto/Views/CommandPaletteView.swift`: `Command + K` palette.
- `Sources/Noto/Views/AIRecorderPanelView.swift`: floating recorder controller.
- `Sources/Noto/Views/AudioWaveformView.swift`: animated waveform.
- `Sources/Noto/Views/DesignSystem.swift`: colors, materials, typography, and small shared modifiers.
- `Sources/NotoCore/Models/Vault.swift`: `Vault` and `VaultFile`.
- `Sources/NotoCore/Models/Metadata.swift`: metadata cache types.
- `Sources/NotoCore/Models/Graph.swift`: graph model types and filter enum.
- `Sources/NotoCore/Models/AI.swift`: recorder, lecture memory, and simulated concept types.
- `Sources/NotoCore/Data/MockVault.swift`: in-memory School Vault notes.
- `Sources/NotoCore/Lib/MarkdownParser.swift`: headings, wiki links, tags, word count, and checkbox parsing helpers.
- `Sources/NotoCore/Lib/MetadataCacheBuilder.swift`: derived metadata and backlinks.
- `Sources/NotoCore/Lib/GraphBuilder.swift`: generated graph nodes, edges, and filters.
- `Sources/NotoCore/Lib/NoteActions.swift`: note creation, wiki-link insertion, and AI note append.
- `Sources/NotoCore/Lib/AIRecorderModel.swift`: explicit recorder state machine and simulated memory updates.
- `Sources/NotoCore/Lib/WorkspaceStore.swift`: testable workspace reducer that coordinates vault, active note, metadata, graph, and recorder state.
- `Tests/NotoCoreTests/MarkdownParserTests.swift`
- `Tests/NotoCoreTests/MetadataCacheBuilderTests.swift`
- `Tests/NotoCoreTests/GraphBuilderTests.swift`
- `Tests/NotoCoreTests/NoteActionsTests.swift`
- `Tests/NotoCoreTests/AIRecorderModelTests.swift`
- `Tests/NotoCoreTests/MockVaultTests.swift`

Modify these existing files:

- `.gitignore`: keep `.superpowers/` ignored and add SwiftPM build output.

## Shared Type Signatures

Use these signatures consistently across tasks:

```swift
public struct Vault: Identifiable, Equatable {
    public let id: String
    public var name: String
    public var files: [VaultFile]
}

public struct VaultFile: Identifiable, Equatable {
    public let id: String
    public var path: String
    public var title: String
    public var content: String
    public var createdAt: Date
    public var updatedAt: Date
}

public struct MetadataCache: Equatable {
    public var filesById: [String: FileMetadata]
    public var fileIdByTitle: [String: String]
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
}

public enum GraphFilter: String, CaseIterable, Identifiable {
    case all
    case local
    case lectureOnly
    case orphans

    public var id: String { rawValue }
}
```

---

### Task 1: Scaffold The SwiftPM Package

**Files:**
- Create: `Package.swift`
- Create: `Sources/Noto/NotoApp.swift`
- Create: `Sources/NotoCore/NotoCore.swift`
- Create: `Tests/NotoCoreTests/PackageSmokeTests.swift`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing package smoke test**

Create `Tests/NotoCoreTests/PackageSmokeTests.swift`:

```swift
import XCTest
@testable import NotoCore

final class PackageSmokeTests: XCTestCase {
    func testCoreModuleLoads() {
        XCTAssertEqual(NotoCore.moduleName, "NotoCore")
    }
}
```

- [ ] **Step 2: Run the test to verify the package is not scaffolded**

Run:

```bash
swift test --filter PackageSmokeTests/testCoreModuleLoads
```

Expected: FAIL because `Package.swift` or the `NotoCore` module does not exist yet.

- [ ] **Step 3: Create `Package.swift`**

Create `Package.swift`:

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Noto",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "Noto", targets: ["Noto"]),
        .library(name: "NotoCore", targets: ["NotoCore"])
    ],
    targets: [
        .target(
            name: "NotoCore",
            path: "Sources/NotoCore"
        ),
        .executableTarget(
            name: "Noto",
            dependencies: ["NotoCore"],
            path: "Sources/Noto"
        ),
        .testTarget(
            name: "NotoCoreTests",
            dependencies: ["NotoCore"],
            path: "Tests/NotoCoreTests"
        )
    ]
)
```

- [ ] **Step 4: Create the minimal core module**

Create `Sources/NotoCore/NotoCore.swift`:

```swift
public enum NotoCore {
    public static let moduleName = "NotoCore"
}
```

- [ ] **Step 5: Create the minimal SwiftUI app entry**

Create `Sources/Noto/NotoApp.swift`:

```swift
import SwiftUI

@main
struct NotoApp: App {
    var body: some Scene {
        WindowGroup {
            Text("Noto")
                .frame(width: 960, height: 640)
        }
        .windowStyle(.hiddenTitleBar)
    }
}
```

- [ ] **Step 6: Update `.gitignore`**

Append these lines to `.gitignore` while keeping the existing `.superpowers/` entry:

```gitignore
.build/
.swiftpm/
DerivedData/
```

- [ ] **Step 7: Run the smoke test**

Run:

```bash
swift test --filter PackageSmokeTests/testCoreModuleLoads
```

Expected: PASS with `PackageSmokeTests.testCoreModuleLoads`.

- [ ] **Step 8: Build the executable product**

Run:

```bash
swift build
```

Expected: PASS with no Swift compiler errors.

- [ ] **Step 9: Commit**

Run:

```bash
git add Package.swift Sources/Noto Sources/NotoCore Tests/NotoCoreTests .gitignore
git commit -m "chore: scaffold Noto SwiftPM app"
```

---

### Task 2: Add Core Models And Mock Vault Data

**Files:**
- Create: `Sources/NotoCore/Models/Vault.swift`
- Create: `Sources/NotoCore/Models/Metadata.swift`
- Create: `Sources/NotoCore/Models/Graph.swift`
- Create: `Sources/NotoCore/Models/AI.swift`
- Create: `Sources/NotoCore/Data/MockVault.swift`
- Create: `Tests/NotoCoreTests/MockVaultTests.swift`

- [ ] **Step 1: Write the failing mock vault tests**

Create `Tests/NotoCoreTests/MockVaultTests.swift`:

```swift
import XCTest
@testable import NotoCore

final class MockVaultTests: XCTestCase {
    func testSchoolVaultContainsRequiredFoldersAndNotes() {
        let vault = MockVault.school

        XCTAssertEqual(vault.name, "School Vault")
        XCTAssertTrue(vault.files.contains { $0.path == "Biology/Photosynthesis.md" })
        XCTAssertTrue(vault.files.contains { $0.path == "Biology/Cell Structure.md" })
        XCTAssertTrue(vault.files.contains { $0.path == "Biology/Enzymes.md" })
        XCTAssertTrue(vault.files.contains { $0.path == "History/Cold War.md" })
        XCTAssertTrue(vault.files.contains { $0.path == "History/Industrial Revolution.md" })
        XCTAssertTrue(vault.files.contains { $0.path == "Mathematics/Logarithms.md" })
        XCTAssertTrue(vault.files.contains { $0.path == "AI Lecture Notes/Biology Lecture - May 13.md" })
    }

    func testBiologyLectureContainsWikiLinks() {
        let lecture = MockVault.school.files.first { $0.title == "Biology Lecture - May 13" }

        XCTAssertNotNil(lecture)
        XCTAssertTrue(lecture?.content.contains("[[Chloroplast]]") == true)
        XCTAssertTrue(lecture?.content.contains("[[Cell Structure]]") == true)
    }
}
```

- [ ] **Step 2: Run the tests to verify model files are missing**

Run:

```bash
swift test --filter MockVaultTests
```

Expected: FAIL because `MockVault`, `Vault`, and `VaultFile` are not defined.

- [ ] **Step 3: Create vault models**

Create `Sources/NotoCore/Models/Vault.swift`:

```swift
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
```

- [ ] **Step 4: Create metadata models**

Create `Sources/NotoCore/Models/Metadata.swift`:

```swift
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
```

- [ ] **Step 5: Create graph models**

Create `Sources/NotoCore/Models/Graph.swift`:

```swift
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
    public var nodes: [GraphNode]
    public var edges: [GraphEdge]

    public init(nodes: [GraphNode], edges: [GraphEdge]) {
        self.nodes = nodes
        self.edges = edges
    }
}
```

- [ ] **Step 6: Create AI models**

Create `Sources/NotoCore/Models/AI.swift`:

```swift
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
```

- [ ] **Step 7: Create mock vault data**

Create `Sources/NotoCore/Data/MockVault.swift` with fixed dates so tests are deterministic:

```swift
import Foundation

public enum MockVault {
    public static let baseDate = Date(timeIntervalSince1970: 1_715_587_200)

    public static var school: Vault {
        Vault(id: "school-vault", name: "School Vault", files: [
            note(
                id: "biology-photosynthesis",
                path: "Biology/Photosynthesis.md",
                title: "Photosynthesis",
                content: """
                # Biology Lecture - Photosynthesis

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
                - [ ] What is the role of carbon dioxide?
                """
            ),
            note(
                id: "biology-cell-structure",
                path: "Biology/Cell Structure.md",
                title: "Cell Structure",
                content: """
                # Cell Structure

                Organelles work together in plant and animal cells.

                ## Links
                - [[Photosynthesis]]
                - [[Chloroplast]]
                """
            ),
            note(
                id: "biology-enzymes",
                path: "Biology/Enzymes.md",
                title: "Enzymes",
                content: """
                # Enzymes

                Enzymes speed up reactions in cells and help metabolic pathways.

                ## Related
                - [[Photosynthesis]]
                - [[Glucose]]
                """
            ),
            note(
                id: "biology-chloroplast",
                path: "Biology/Chloroplast.md",
                title: "Chloroplast",
                content: """
                # Chloroplast

                Chloroplasts are organelles where [[Photosynthesis]] occurs.
                #biology
                """
            ),
            note(
                id: "biology-glucose",
                path: "Biology/Glucose.md",
                title: "Glucose",
                content: """
                # Glucose

                Glucose stores chemical energy produced by [[Photosynthesis]].
                """
            ),
            note(
                id: "biology-carbon-dioxide",
                path: "Biology/Carbon Dioxide.md",
                title: "Carbon Dioxide",
                content: """
                # Carbon Dioxide

                Carbon dioxide enters leaves through stomata and is used in [[Photosynthesis]].
                """
            ),
            note(
                id: "history-cold-war",
                path: "History/Cold War.md",
                title: "Cold War",
                content: """
                # Cold War

                A period of geopolitical tension after World War II.
                #history
                """
            ),
            note(
                id: "history-industrial-revolution",
                path: "History/Industrial Revolution.md",
                title: "Industrial Revolution",
                content: """
                # Industrial Revolution

                A major shift from hand production to machine production.
                """
            ),
            note(
                id: "math-logarithms",
                path: "Mathematics/Logarithms.md",
                title: "Logarithms",
                content: """
                # Logarithms

                Logarithms answer exponent questions.
                """
            ),
            note(
                id: "literature-macbeth",
                path: "Literature/Macbeth.md",
                title: "Macbeth",
                content: """
                # Macbeth

                A tragedy about ambition, guilt, and prophecy.
                """
            ),
            note(
                id: "ai-biology-lecture-may-13",
                path: "AI Lecture Notes/Biology Lecture - May 13.md",
                title: "Biology Lecture - May 13",
                content: """
                # Biology Lecture - May 13

                ## Today
                The teacher connected [[Photosynthesis]], [[Chloroplast]], [[Glucose]], and [[Cell Structure]].

                > Important: compare light-dependent reactions with the Calvin cycle.

                #lecture #biology
                """
            )
        ])
    }

    private static func note(id: String, path: String, title: String, content: String) -> VaultFile {
        VaultFile(
            id: id,
            path: path,
            title: title,
            content: content,
            createdAt: baseDate,
            updatedAt: baseDate
        )
    }
}
```

- [ ] **Step 8: Run the mock vault tests**

Run:

```bash
swift test --filter MockVaultTests
```

Expected: PASS with both mock vault tests.

- [ ] **Step 9: Commit**

Run:

```bash
git add Sources/NotoCore Tests/NotoCoreTests
git commit -m "feat: add Noto core models and mock vault"
```

---

### Task 3: Implement Markdown Parsing

**Files:**
- Create: `Sources/NotoCore/Lib/MarkdownParser.swift`
- Create: `Tests/NotoCoreTests/MarkdownParserTests.swift`

- [ ] **Step 1: Write parser tests**

Create `Tests/NotoCoreTests/MarkdownParserTests.swift`:

```swift
import XCTest
@testable import NotoCore

final class MarkdownParserTests: XCTestCase {
    func testExtractsWikiLinksInOrderWithoutBrackets() {
        let content = "Study [[Photosynthesis]], [[Cell Structure]], and [[Cold War]]."

        XCTAssertEqual(
            MarkdownParser.extractWikiLinks(from: content),
            ["Photosynthesis", "Cell Structure", "Cold War"]
        )
    }

    func testExtractsMarkdownHeadingsWithoutHashMarkers() {
        let content = """
        # Title
        Paragraph
        ## Key idea
        ### Details
        """

        XCTAssertEqual(
            MarkdownParser.extractHeadings(from: content),
            ["Title", "Key idea", "Details"]
        )
    }

    func testExtractsTagsWithoutTreatingHeadingsAsTags() {
        let content = """
        # Biology
        This line has #biology and #lecture tags.
        """

        XCTAssertEqual(MarkdownParser.extractTags(from: content), ["biology", "lecture"])
    }

    func testCountsWordsFromMarkdownText() {
        let content = """
        # Biology Lecture
        Photosynthesis converts light energy into chemical energy stored in glucose.
        - [[Chloroplast]]
        """

        XCTAssertEqual(MarkdownParser.wordCount(in: content), 13)
    }

    func testExtractsChecklistItems() {
        let content = """
        - [ ] Review chlorophyll
        - [x] Compare Calvin cycle
        """

        XCTAssertEqual(
            MarkdownParser.extractChecklistItems(from: content),
            [
                ChecklistItem(text: "Review chlorophyll", isComplete: false),
                ChecklistItem(text: "Compare Calvin cycle", isComplete: true)
            ]
        )
    }
}
```

- [ ] **Step 2: Run parser tests to verify failure**

Run:

```bash
swift test --filter MarkdownParserTests
```

Expected: FAIL because `MarkdownParser` and `ChecklistItem` are missing.

- [ ] **Step 3: Implement parser utility**

Create `Sources/NotoCore/Lib/MarkdownParser.swift`:

```swift
import Foundation

public struct ChecklistItem: Equatable, Identifiable {
    public let id: String
    public let text: String
    public let isComplete: Bool

    public init(text: String, isComplete: Bool) {
        self.id = "\(isComplete)-\(text)"
        self.text = text
        self.isComplete = isComplete
    }
}

public enum MarkdownParser {
    public static func extractWikiLinks(from content: String) -> [String] {
        let pattern = #"\[\[([^\[\]]+)\]\]"#
        return matches(for: pattern, in: content).map { normalizeTitle($0) }
    }

    public static func extractHeadings(from content: String) -> [String] {
        content
            .split(whereSeparator: \.isNewline)
            .compactMap { line -> String? in
                let text = String(line).trimmingCharacters(in: .whitespaces)
                guard text.hasPrefix("#") else { return nil }
                let trimmed = text.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)
                return trimmed.isEmpty ? nil : trimmed
            }
    }

    public static func extractTags(from content: String) -> [String] {
        var tags: [String] = []
        let lines = content.split(whereSeparator: \.isNewline)

        for line in lines {
            let text = String(line).trimmingCharacters(in: .whitespaces)
            if text.hasPrefix("# ") || text.hasPrefix("##") {
                continue
            }

            let found = matches(for: #"(?<!\w)#([A-Za-z][A-Za-z0-9_-]*)"#, in: text)
            for tag in found where !tags.contains(tag) {
                tags.append(tag)
            }
        }

        return tags
    }

    public static func wordCount(in content: String) -> Int {
        var text = content
        text = text.replacingOccurrences(of: #"\[\[([^\[\]]+)\]\]"#, with: "$1", options: .regularExpression)
        text = text.replacingOccurrences(of: #"(?m)^#{1,6}\s+"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"(?m)^-\s+\[[ xX]\]\s+"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"(?m)^[-*]\s+"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"#([A-Za-z][A-Za-z0-9_-]*)"#, with: "", options: .regularExpression)

        return text
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .count
    }

    public static func extractChecklistItems(from content: String) -> [ChecklistItem] {
        content
            .split(whereSeparator: \.isNewline)
            .compactMap { line -> ChecklistItem? in
                let text = String(line).trimmingCharacters(in: .whitespaces)
                if text.hasPrefix("- [ ] ") {
                    return ChecklistItem(text: String(text.dropFirst(6)), isComplete: false)
                }
                if text.hasPrefix("- [x] ") || text.hasPrefix("- [X] ") {
                    return ChecklistItem(text: String(text.dropFirst(6)), isComplete: true)
                }
                return nil
            }
    }

    public static func normalizeTitle(_ title: String) -> String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func matches(for pattern: String, in text: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return []
        }

        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            guard match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: text) else {
                return nil
            }
            return String(text[range])
        }
    }
}
```

- [ ] **Step 4: Run parser tests**

Run:

```bash
swift test --filter MarkdownParserTests
```

Expected: PASS with all parser tests.

- [ ] **Step 5: Run all tests**

Run:

```bash
swift test
```

Expected: PASS for `PackageSmokeTests`, `MockVaultTests`, and `MarkdownParserTests`.

- [ ] **Step 6: Commit**

Run:

```bash
git add Sources/NotoCore/Lib/MarkdownParser.swift Tests/NotoCoreTests/MarkdownParserTests.swift
git commit -m "feat: parse markdown metadata primitives"
```

---

### Task 4: Build Metadata Cache With Generated Backlinks

**Files:**
- Create: `Sources/NotoCore/Lib/MetadataCacheBuilder.swift`
- Create: `Tests/NotoCoreTests/MetadataCacheBuilderTests.swift`

- [ ] **Step 1: Write metadata cache tests**

Create `Tests/NotoCoreTests/MetadataCacheBuilderTests.swift`:

```swift
import XCTest
@testable import NotoCore

final class MetadataCacheBuilderTests: XCTestCase {
    func testBuildsOutgoingLinksHeadingsTagsAndWordCount() {
        let cache = MetadataCacheBuilder.build(files: MockVault.school.files)
        let photosynthesis = MockVault.school.files.first { $0.title == "Photosynthesis" }!
        let metadata = cache.filesById[photosynthesis.id]

        XCTAssertEqual(metadata?.headings, [
            "Biology Lecture - Photosynthesis",
            "Key idea",
            "Important terms",
            "Summary",
            "Questions to review"
        ])
        XCTAssertEqual(metadata?.outgoingLinks, ["Chloroplast", "Glucose", "Carbon Dioxide", "Cell Structure"])
        XCTAssertEqual(metadata?.tags, [])
        XCTAssertEqual(metadata?.path, "Biology/Photosynthesis.md")
        XCTAssertGreaterThan(metadata?.wordCount ?? 0, 20)
    }

    func testGeneratesBacklinksByResolvingWikiLinksToKnownTitles() {
        let cache = MetadataCacheBuilder.build(files: MockVault.school.files)
        let photosynthesis = MockVault.school.files.first { $0.title == "Photosynthesis" }!
        let metadata = cache.filesById[photosynthesis.id]

        XCTAssertEqual(
            metadata?.backlinks.sorted(),
            ["Biology Lecture - May 13", "Cell Structure", "Chloroplast", "Enzymes", "Glucose", "Carbon Dioxide"].sorted()
        )
    }

    func testIgnoresUnresolvedLinksWhenBuildingBacklinks() {
        var files = MockVault.school.files
        files[0].content += "\n- [[Unresolved Topic]]"

        let cache = MetadataCacheBuilder.build(files: files)

        XCTAssertNil(cache.fileIdByTitle["Unresolved Topic"])
        XCTAssertFalse(cache.filesById.values.contains { $0.backlinks.contains("Unresolved Topic") })
    }
}
```

- [ ] **Step 2: Run metadata tests to verify failure**

Run:

```bash
swift test --filter MetadataCacheBuilderTests
```

Expected: FAIL because `MetadataCacheBuilder` does not exist.

- [ ] **Step 3: Implement metadata cache builder**

Create `Sources/NotoCore/Lib/MetadataCacheBuilder.swift`:

```swift
import Foundation

public enum MetadataCacheBuilder {
    public static func build(files: [VaultFile]) -> MetadataCache {
        let fileIdByTitle = Dictionary(uniqueKeysWithValues: files.map { ($0.title, $0.id) })
        var backlinksByFileId: [String: [String]] = Dictionary(uniqueKeysWithValues: files.map { ($0.id, []) })
        var outgoingByFileId: [String: [String]] = [:]

        for file in files {
            let outgoing = uniquePreservingOrder(MarkdownParser.extractWikiLinks(from: file.content))
            outgoingByFileId[file.id] = outgoing

            for title in outgoing {
                guard let targetId = fileIdByTitle[title], targetId != file.id else {
                    continue
                }
                backlinksByFileId[targetId, default: []].append(file.title)
            }
        }

        var metadata: [String: FileMetadata] = [:]
        for file in files {
            metadata[file.id] = FileMetadata(
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
        }

        return MetadataCache(filesById: metadata, fileIdByTitle: fileIdByTitle)
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
```

- [ ] **Step 4: Run metadata tests**

Run:

```bash
swift test --filter MetadataCacheBuilderTests
```

Expected: PASS with all metadata tests.

- [ ] **Step 5: Run all tests**

Run:

```bash
swift test
```

Expected: PASS for all existing test cases.

- [ ] **Step 6: Commit**

Run:

```bash
git add Sources/NotoCore/Lib/MetadataCacheBuilder.swift Tests/NotoCoreTests/MetadataCacheBuilderTests.swift
git commit -m "feat: derive note metadata and backlinks"
```

---

### Task 5: Build Generated Knowledge Graph Data

**Files:**
- Create: `Sources/NotoCore/Lib/GraphBuilder.swift`
- Create: `Tests/NotoCoreTests/GraphBuilderTests.swift`

- [ ] **Step 1: Write graph builder tests**

Create `Tests/NotoCoreTests/GraphBuilderTests.swift`:

```swift
import XCTest
@testable import NotoCore

final class GraphBuilderTests: XCTestCase {
    func testBuildsNodesAndEdgesFromMetadataCache() {
        let vault = MockVault.school
        let cache = MetadataCacheBuilder.build(files: vault.files)
        let graph = GraphBuilder.build(files: vault.files, cache: cache)

        XCTAssertEqual(graph.nodes.count, vault.files.count)
        XCTAssertTrue(graph.edges.contains { edge in
            edge.source == "biology-photosynthesis" && edge.target == "biology-chloroplast"
        })
        XCTAssertTrue(graph.edges.contains { edge in
            edge.source == "ai-biology-lecture-may-13" && edge.target == "biology-photosynthesis"
        })
    }

    func testLocalFilterShowsActiveNoteOutgoingLinksAndBacklinks() {
        let vault = MockVault.school
        let cache = MetadataCacheBuilder.build(files: vault.files)
        let graph = GraphBuilder.build(files: vault.files, cache: cache)
        let filtered = GraphBuilder.filter(graph: graph, mode: .local, activeFileId: "biology-photosynthesis")

        let titles = Set(filtered.nodes.map(\.title))

        XCTAssertTrue(titles.contains("Photosynthesis"))
        XCTAssertTrue(titles.contains("Chloroplast"))
        XCTAssertTrue(titles.contains("Glucose"))
        XCTAssertTrue(titles.contains("Cell Structure"))
        XCTAssertTrue(titles.contains("Biology Lecture - May 13"))
        XCTAssertFalse(titles.contains("Cold War"))
    }

    func testLectureOnlyFilterShowsLectureFolderNotes() {
        let vault = MockVault.school
        let cache = MetadataCacheBuilder.build(files: vault.files)
        let graph = GraphBuilder.build(files: vault.files, cache: cache)
        let filtered = GraphBuilder.filter(graph: graph, mode: .lectureOnly, activeFileId: "biology-photosynthesis")

        XCTAssertEqual(filtered.nodes.map(\.title), ["Biology Lecture - May 13"])
    }

    func testOrphanFilterShowsNotesWithoutEdges() {
        let vault = MockVault.school
        let cache = MetadataCacheBuilder.build(files: vault.files)
        let graph = GraphBuilder.build(files: vault.files, cache: cache)
        let filtered = GraphBuilder.filter(graph: graph, mode: .orphans, activeFileId: "biology-photosynthesis")

        let titles = Set(filtered.nodes.map(\.title))
        XCTAssertTrue(titles.contains("Cold War"))
        XCTAssertTrue(titles.contains("Industrial Revolution"))
        XCTAssertTrue(titles.contains("Logarithms"))
    }
}
```

- [ ] **Step 2: Run graph tests to verify failure**

Run:

```bash
swift test --filter GraphBuilderTests
```

Expected: FAIL because `GraphBuilder` is missing.

- [ ] **Step 3: Implement graph builder**

Create `Sources/NotoCore/Lib/GraphBuilder.swift`:

```swift
public enum GraphBuilder {
    public static func build(files: [VaultFile], cache: MetadataCache) -> KnowledgeGraph {
        let nodes = files.map { file -> GraphNode in
            let metadata = cache.filesById[file.id]
            return GraphNode(
                id: file.id,
                title: file.title,
                path: file.path,
                backlinksCount: metadata?.backlinks.count ?? 0,
                outgoingCount: metadata?.outgoingLinks.count ?? 0
            )
        }

        var edges: [GraphEdge] = []
        for file in files {
            guard let metadata = cache.filesById[file.id] else { continue }
            for targetTitle in metadata.outgoingLinks {
                guard let targetId = cache.fileIdByTitle[targetTitle] else { continue }
                edges.append(GraphEdge(
                    id: "\(file.id)->\(targetId)",
                    source: file.id,
                    target: targetId,
                    weight: 1
                ))
            }
        }

        return KnowledgeGraph(nodes: nodes, edges: edges)
    }

    public static func filter(graph: KnowledgeGraph, mode: GraphFilter, activeFileId: String) -> KnowledgeGraph {
        switch mode {
        case .all:
            return graph
        case .local:
            let related = localNodeIds(in: graph, activeFileId: activeFileId)
            return subgraph(graph, keeping: related)
        case .lectureOnly:
            let ids = Set(graph.nodes.filter { $0.path.hasPrefix("AI Lecture Notes/") }.map(\.id))
            return subgraph(graph, keeping: ids)
        case .orphans:
            let connected = Set(graph.edges.flatMap { [$0.source, $0.target] })
            let ids = Set(graph.nodes.filter { !connected.contains($0.id) }.map(\.id))
            return subgraph(graph, keeping: ids)
        }
    }

    private static func localNodeIds(in graph: KnowledgeGraph, activeFileId: String) -> Set<String> {
        var ids: Set<String> = [activeFileId]
        for edge in graph.edges {
            if edge.source == activeFileId {
                ids.insert(edge.target)
            }
            if edge.target == activeFileId {
                ids.insert(edge.source)
            }
        }
        return ids
    }

    private static func subgraph(_ graph: KnowledgeGraph, keeping ids: Set<String>) -> KnowledgeGraph {
        KnowledgeGraph(
            nodes: graph.nodes.filter { ids.contains($0.id) },
            edges: graph.edges.filter { ids.contains($0.source) && ids.contains($0.target) }
        )
    }
}
```

- [ ] **Step 4: Run graph tests**

Run:

```bash
swift test --filter GraphBuilderTests
```

Expected: PASS with all graph tests.

- [ ] **Step 5: Run all tests**

Run:

```bash
swift test
```

Expected: PASS for all existing test cases.

- [ ] **Step 6: Commit**

Run:

```bash
git add Sources/NotoCore/Lib/GraphBuilder.swift Tests/NotoCoreTests/GraphBuilderTests.swift
git commit -m "feat: generate knowledge graph from note links"
```

---

### Task 6: Add Note Actions And AI Recorder State Machine

**Files:**
- Create: `Sources/NotoCore/Lib/NoteActions.swift`
- Create: `Sources/NotoCore/Lib/AIRecorderModel.swift`
- Create: `Tests/NotoCoreTests/NoteActionsTests.swift`
- Create: `Tests/NotoCoreTests/AIRecorderModelTests.swift`

- [ ] **Step 1: Write note action tests**

Create `Tests/NotoCoreTests/NoteActionsTests.swift`:

```swift
import XCTest
@testable import NotoCore

final class NoteActionsTests: XCTestCase {
    func testAppendAINotesAddsStructuredMarkdownAndWikiLinks() {
        let original = MockVault.school.files.first { $0.title == "Photosynthesis" }!
        let memory = LectureMemory(
            concepts: ["chlorophyll absorbs light"],
            definitions: [
                LectureDefinition(id: "chlorophyll", term: "Chlorophyll", definition: "Pigment that absorbs light energy.")
            ],
            importantPoints: ["Photosynthesis converts light energy into chemical energy."],
            possibleQuestions: ["Why is chlorophyll important?"],
            linkedNotes: ["Chloroplast", "Glucose", "Carbon Dioxide"]
        )

        let updated = NoteActions.appendAINotes(to: original, memory: memory, now: MockVault.baseDate.addingTimeInterval(60))

        XCTAssertTrue(updated.content.contains("## AI Lecture Notes"))
        XCTAssertTrue(updated.content.contains("### Key definitions"))
        XCTAssertTrue(updated.content.contains("[[Chloroplast]]"))
        XCTAssertTrue(updated.content.contains("[[Glucose]]"))
        XCTAssertGreaterThan(updated.updatedAt, original.updatedAt)
    }

    func testCreateLectureNoteBuildsPathAndContent() {
        let note = NoteActions.createLectureNote(title: "Biology Lecture - May 13", now: MockVault.baseDate)

        XCTAssertEqual(note.path, "AI Lecture Notes/Biology Lecture - May 13.md")
        XCTAssertEqual(note.title, "Biology Lecture - May 13")
        XCTAssertTrue(note.content.contains("# Biology Lecture - May 13"))
    }
}
```

- [ ] **Step 2: Write recorder model tests**

Create `Tests/NotoCoreTests/AIRecorderModelTests.swift`:

```swift
import XCTest
@testable import NotoCore

final class AIRecorderModelTests: XCTestCase {
    func testRecordingOnlyStartsAfterExplicitStart() {
        var recorder = AIRecorderModel()

        XCTAssertEqual(recorder.phase, .idle)
        XCTAssertFalse(recorder.phase.isRecording)

        recorder.start(now: MockVault.baseDate)

        XCTAssertTrue(recorder.phase.isRecording)
        XCTAssertEqual(recorder.memory.concepts, [])
    }

    func testTickAddsSimulatedConceptsWhileRecording() {
        var recorder = AIRecorderModel()
        recorder.start(now: MockVault.baseDate)

        recorder.tick()
        recorder.tick()

        XCTAssertEqual(recorder.memory.concepts.prefix(2), [
            "chlorophyll absorbs light",
            "glucose stores chemical energy"
        ])
        XCTAssertTrue(recorder.memory.linkedNotes.contains("Chloroplast"))
    }

    func testStopMovesThroughProcessingToComplete() {
        var recorder = AIRecorderModel()
        recorder.start(now: MockVault.baseDate)
        recorder.tick()

        recorder.stop(targetNoteTitle: "Photosynthesis")

        XCTAssertEqual(recorder.phase, .processing)

        recorder.finishProcessing(targetNoteTitle: "Photosynthesis")

        XCTAssertEqual(recorder.phase, .complete(targetNoteTitle: "Photosynthesis"))
    }
}
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
swift test --filter NoteActionsTests
swift test --filter AIRecorderModelTests
```

Expected: both commands FAIL because `NoteActions` and `AIRecorderModel` are missing.

- [ ] **Step 4: Implement note actions**

Create `Sources/NotoCore/Lib/NoteActions.swift`:

```swift
import Foundation

public enum NoteActions {
    public static func appendAINotes(to file: VaultFile, memory: LectureMemory, now: Date) -> VaultFile {
        var updated = file
        let section = aiSection(from: memory)
        updated.content = file.content.trimmingCharacters(in: .whitespacesAndNewlines) + "\n\n" + section
        updated.updatedAt = now
        return updated
    }

    public static func createLectureNote(title: String, now: Date) -> VaultFile {
        let safeTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return VaultFile(
            id: "lecture-\(safeTitle.lowercased().replacingOccurrences(of: " ", with: "-"))",
            path: "AI Lecture Notes/\(safeTitle).md",
            title: safeTitle,
            content: """
            # \(safeTitle)

            ## Live notes
            Noto will add structured lecture notes here after you press Record and then Stop.
            """,
            createdAt: now,
            updatedAt: now
        )
    }

    public static func insertBacklink(_ title: String, into file: VaultFile, now: Date) -> VaultFile {
        var updated = file
        updated.content += "\n- [[\(title)]]"
        updated.updatedAt = now
        return updated
    }

    private static func aiSection(from memory: LectureMemory) -> String {
        let definitions = memory.definitions.isEmpty
            ? ["- Chlorophyll: pigment that absorbs light energy.", "- Chloroplast: organelle where photosynthesis occurs.", "- Calvin cycle: process that helps produce sugar."]
            : memory.definitions.map { "- \($0.term): \($0.definition)" }

        let relationships = memory.linkedNotes.isEmpty
            ? ["- [[Chloroplast]] is connected to [[Photosynthesis]]", "- [[Glucose]] is the product of photosynthesis", "- [[Carbon Dioxide]] is a reactant in the process"]
            : memory.linkedNotes.map { "- [[\($0)]] is connected to the lecture" }

        let questions = memory.possibleQuestions.isEmpty
            ? ["- Explain the difference between light-dependent reactions and the Calvin cycle.", "- Why is chlorophyll important?", "- What role does carbon dioxide play?"]
            : memory.possibleQuestions.map { "- \($0)" }

        return """
        ## AI Lecture Notes

        ### Main explanation
        The teacher explained that photosynthesis converts light energy into chemical energy stored in glucose.

        ### Key definitions
        \(definitions.joined(separator: "\n"))

        ### Important relationships
        \(relationships.joined(separator: "\n"))

        ### Possible test questions
        \(questions.joined(separator: "\n"))
        """
    }
}
```

- [ ] **Step 5: Implement recorder model**

Create `Sources/NotoCore/Lib/AIRecorderModel.swift`:

```swift
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
        guard phase.isRecording else { return }
        elapsedSeconds += 2
        guard conceptIndex < Self.script.count else { return }

        let item = Self.script[conceptIndex]
        conceptIndex += 1
        memory.concepts.append(item.concept)

        if let definition = item.definition {
            memory.definitions.append(definition)
        }
        memory.importantPoints.append(item.importantPoint)
        if let question = item.question {
            memory.possibleQuestions.append(question)
        }
        for note in item.linkedNotes where !memory.linkedNotes.contains(note) {
            memory.linkedNotes.append(note)
        }
    }

    public mutating func stop(targetNoteTitle: String) {
        guard phase.isRecording else { return }
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

    private static let script: [ScriptItem] = [
        ScriptItem(
            concept: "chlorophyll absorbs light",
            definition: LectureDefinition(id: "chlorophyll", term: "Chlorophyll", definition: "Pigment that absorbs light energy."),
            importantPoint: "The teacher emphasized that light absorption starts the process.",
            question: "Why is chlorophyll important?",
            linkedNotes: ["Chloroplast", "Photosynthesis"]
        ),
        ScriptItem(
            concept: "glucose stores chemical energy",
            definition: LectureDefinition(id: "glucose", term: "Glucose", definition: "Sugar molecule that stores chemical energy."),
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
            definition: LectureDefinition(id: "calvin-cycle", term: "Calvin cycle", definition: "Process that helps produce sugar from carbon dioxide."),
            importantPoint: "The Calvin cycle should be compared with light-dependent reactions.",
            question: "Compare light reactions and the Calvin cycle.",
            linkedNotes: ["Photosynthesis", "Glucose"]
        )
    ]
}
```

- [ ] **Step 6: Run note action and recorder tests**

Run:

```bash
swift test --filter NoteActionsTests
swift test --filter AIRecorderModelTests
```

Expected: PASS for both commands.

- [ ] **Step 7: Run all tests**

Run:

```bash
swift test
```

Expected: PASS for all existing test cases.

- [ ] **Step 8: Commit**

Run:

```bash
git add Sources/NotoCore/Lib Tests/NotoCoreTests
git commit -m "feat: simulate AI recorder note capture"
```

---

### Task 7: Add Observable App State

**Files:**
- Create: `Sources/Noto/AppState.swift`
- Create: `Sources/NotoCore/Lib/WorkspaceStore.swift`
- Create: `Tests/NotoCoreTests/AppStateBehaviorTests.swift`

- [ ] **Step 1: Add a small testable app state reducer to core**

Create `Tests/NotoCoreTests/AppStateBehaviorTests.swift`:

```swift
import XCTest
@testable import NotoCore

final class AppStateBehaviorTests: XCTestCase {
    func testSelectingFileChangesActiveFile() {
        var store = WorkspaceStore(vault: MockVault.school)
        store.selectFile(id: "history-cold-war")

        XCTAssertEqual(store.activeFile?.title, "Cold War")
    }

    func testAppendingAINotesUpdatesMetadataAndGraph() {
        var store = WorkspaceStore(vault: MockVault.school)
        store.selectFile(id: "biology-photosynthesis")
        store.recorder.start(now: MockVault.baseDate)
        store.recorder.tick()
        store.stopRecordingAndAppendNotes(now: MockVault.baseDate.addingTimeInterval(120))

        let active = store.activeFile!
        let metadata = store.metadata.filesById[active.id]!

        XCTAssertTrue(active.content.contains("## AI Lecture Notes"))
        XCTAssertTrue(metadata.outgoingLinks.contains("Chloroplast"))
        XCTAssertTrue(store.graph.edges.contains { $0.source == active.id && $0.target == "biology-chloroplast" })
    }
}
```

- [ ] **Step 2: Run state behavior tests to verify failure**

Run:

```bash
swift test --filter AppStateBehaviorTests
```

Expected: FAIL because `WorkspaceStore` does not exist.

- [ ] **Step 3: Create `WorkspaceStore` in core**

Create `Sources/NotoCore/Lib/WorkspaceStore.swift`:

```swift
import Foundation

public struct WorkspaceStore: Equatable {
    public var vault: Vault
    public var activeFileId: String
    public var activeTab: WorkspaceTab
    public var graphFilter: GraphFilter
    public var searchQuery: String
    public var recorder: AIRecorderModel

    public init(vault: Vault) {
        self.vault = vault
        self.activeFileId = vault.files.first?.id ?? ""
        self.activeTab = .note
        self.graphFilter = .all
        self.searchQuery = ""
        self.recorder = AIRecorderModel()
    }

    public var activeFile: VaultFile? {
        vault.files.first { $0.id == activeFileId }
    }

    public var metadata: MetadataCache {
        MetadataCacheBuilder.build(files: vault.files)
    }

    public var graph: KnowledgeGraph {
        GraphBuilder.build(files: vault.files, cache: metadata)
    }

    public var visibleGraph: KnowledgeGraph {
        GraphBuilder.filter(graph: graph, mode: graphFilter, activeFileId: activeFileId)
    }

    public var filteredFiles: [VaultFile] {
        let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return vault.files }
        return vault.files.filter {
            $0.title.localizedCaseInsensitiveContains(trimmed) ||
            $0.path.localizedCaseInsensitiveContains(trimmed)
        }
    }

    public mutating func selectFile(id: String) {
        guard vault.files.contains(where: { $0.id == id }) else { return }
        activeFileId = id
        activeTab = .note
    }

    public mutating func openGraph(filter: GraphFilter = .all) {
        graphFilter = filter
        activeTab = .graph
    }

    public mutating func createNewNote(now: Date) {
        let count = vault.files.filter { $0.path.hasPrefix("AI Lecture Notes/Untitled") }.count + 1
        let title = "Untitled \(count)"
        let file = VaultFile(
            id: "untitled-\(count)",
            path: "AI Lecture Notes/\(title).md",
            title: title,
            content: "# \(title)\n\n",
            createdAt: now,
            updatedAt: now
        )
        vault.files.append(file)
        activeFileId = file.id
    }

    public mutating func stopRecordingAndAppendNotes(now: Date) {
        guard let file = activeFile, recorder.phase.isRecording else { return }
        recorder.stop(targetNoteTitle: file.title)
        let updated = NoteActions.appendAINotes(to: file, memory: recorder.memory, now: now)
        replaceFile(updated)
    }

    public mutating func replaceFile(_ file: VaultFile) {
        guard let index = vault.files.firstIndex(where: { $0.id == file.id }) else { return }
        vault.files[index] = file
    }
}

public enum WorkspaceTab: String, Equatable {
    case note
    case graph
}
```

- [ ] **Step 4: Run state behavior tests**

Run:

```bash
swift test --filter AppStateBehaviorTests
```

Expected: PASS with both state behavior tests.

- [ ] **Step 5: Create SwiftUI observable wrapper**

Create `Sources/Noto/AppState.swift`:

```swift
import Foundation
import Observation
import NotoCore

@Observable
final class AppState {
    var store = WorkspaceStore(vault: MockVault.school)
    var isCommandPalettePresented = false
    var isRecorderPresented = false

    var slogan: String {
        "When you listen, Noto remembers."
    }

    func selectFile(id: String) {
        store.selectFile(id: id)
    }

    func openGraph(filter: GraphFilter = .all) {
        store.openGraph(filter: filter)
    }

    func toggleRecorder() {
        isRecorderPresented.toggle()
    }

    func toggleCommandPalette() {
        isCommandPalettePresented.toggle()
    }

    func startRecording() {
        store.recorder.start(now: Date())
    }

    func recorderTick() {
        store.recorder.tick()
    }

    func stopRecording() {
        store.stopRecordingAndAppendNotes(now: Date())
    }

    func recordMore() {
        store.recorder.reset()
    }

    func createNewNote() {
        store.createNewNote(now: Date())
    }
}
```

- [ ] **Step 6: Run all tests and build**

Run:

```bash
swift test
swift build
```

Expected: both commands PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add Sources/Noto Sources/NotoCore Tests/NotoCoreTests
git commit -m "feat: add workspace state and derived graph data"
```

---

### Task 8: Build The Native Mac Window Shell

**Files:**
- Modify: `Sources/Noto/NotoApp.swift`
- Create: `Sources/Noto/Views/DesignSystem.swift`
- Create: `Sources/Noto/Views/MacWindowView.swift`
- Create: `Sources/Noto/Views/TitleBarView.swift`

- [ ] **Step 1: Replace app entry with stateful app shell**

Modify `Sources/Noto/NotoApp.swift`:

```swift
import SwiftUI

@main
struct NotoApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            MacWindowView()
                .environment(appState)
                .frame(minWidth: 1180, minHeight: 760)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
    }
}
```

- [ ] **Step 2: Create design tokens**

Create `Sources/Noto/Views/DesignSystem.swift`:

```swift
import SwiftUI

enum NotoDesign {
    static let accent = Color(red: 0.22, green: 0.42, blue: 0.78)
    static let ink = Color(red: 0.12, green: 0.14, blue: 0.18)
    static let muted = Color(red: 0.42, green: 0.45, blue: 0.50)
    static let line = Color.black.opacity(0.08)
    static let panel = Color.white.opacity(0.72)
    static let editor = Color(red: 0.985, green: 0.986, blue: 0.992)
    static let recorderRed = Color(red: 0.82, green: 0.18, blue: 0.16)

    static func glassBackground(cornerRadius: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.white.opacity(0.65), lineWidth: 1)
            )
    }
}

struct SectionLabel: View {
    let title: String

    var body: some View {
        Text(title.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(NotoDesign.muted)
            .tracking(0.8)
    }
}
```

- [ ] **Step 3: Create titlebar view**

Create `Sources/Noto/Views/TitleBarView.swift`:

```swift
import SwiftUI

struct TitleBarView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        HStack(spacing: 8) {
            trafficLight(.red)
            trafficLight(.yellow)
            trafficLight(.green)

            VStack(alignment: .leading, spacing: 1) {
                Text("Noto")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(NotoDesign.ink)
                Text(appState.slogan)
                    .font(.system(size: 10))
                    .foregroundStyle(NotoDesign.muted)
            }
            .padding(.leading, 16)

            Spacer()

            Button {
                appState.toggleCommandPalette()
            } label: {
                Label("Command", systemImage: "command")
                    .font(.system(size: 12, weight: .medium))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .help("Open Command Palette")
        }
        .padding(.horizontal, 14)
        .frame(height: 48)
        .background(.ultraThinMaterial)
        .overlay(alignment: .bottom) {
            Rectangle().fill(NotoDesign.line).frame(height: 1)
        }
    }

    private func trafficLight(_ color: Color) -> some View {
        Circle()
            .fill(color)
            .frame(width: 12, height: 12)
            .overlay(Circle().stroke(Color.black.opacity(0.08), lineWidth: 0.5))
    }
}
```

- [ ] **Step 4: Create main window shell**

Create `Sources/Noto/Views/MacWindowView.swift`:

```swift
import SwiftUI

struct MacWindowView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            LinearGradient(
                colors: [
                    Color(red: 0.88, green: 0.90, blue: 0.94),
                    Color(red: 0.97, green: 0.98, blue: 0.99)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                TitleBarView()
                HStack(spacing: 0) {
                    VaultSidebarView()
                        .frame(width: 246)
                    MarkdownWorkspaceView()
                    RightContextPanelView()
                        .frame(width: 286)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color.black.opacity(0.10), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.18), radius: 40, x: 0, y: 24)
            .padding(28)

            if appState.isRecorderPresented {
                AIRecorderPanelView()
                    .padding(.trailing, 70)
                    .padding(.bottom, 68)
                    .transition(.scale(scale: 0.92).combined(with: .opacity))
            }
        }
        .overlay {
            if appState.isCommandPalettePresented {
                CommandPaletteView()
                    .transition(.scale(scale: 0.96).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: appState.isRecorderPresented)
        .animation(.spring(response: 0.22, dampingFraction: 0.88), value: appState.isCommandPalettePresented)
        .focusable()
        .onKeyPress("k", phases: .down) { press in
            guard press.modifiers.contains(.command) else { return .ignored }
            appState.toggleCommandPalette()
            return .handled
        }
        .onKeyPress("m", phases: .down) { press in
            guard press.modifiers.contains(.command), press.modifiers.contains(.control) else { return .ignored }
            appState.toggleRecorder()
            return .handled
        }
    }
}
```

- [ ] **Step 5: Add temporary stub views so the shell builds**

Create temporary stub declarations in `Sources/Noto/Views/MacWindowView.swift` below `MacWindowView` and remove them as each real view is added:

```swift
struct VaultSidebarView: View { var body: some View { Color.clear } }
struct MarkdownWorkspaceView: View { var body: some View { Color.clear } }
struct RightContextPanelView: View { var body: some View { Color.clear } }
struct AIRecorderPanelView: View { var body: some View { EmptyView() } }
struct CommandPaletteView: View { var body: some View { EmptyView() } }
```

- [ ] **Step 6: Build**

Run:

```bash
swift build
```

Expected: PASS. If `onKeyPress` is unavailable in the local SDK, replace the two `.onKeyPress` modifiers with `.commands` in `NotoApp` using `CommandMenu("Noto")` and keyboard shortcuts.

- [ ] **Step 7: Commit**

Run:

```bash
git add Sources/Noto
git commit -m "feat: build Noto macOS window shell"
```

---

### Task 9: Build Sidebar, File Tree, And Right Context Panel

**Files:**
- Create: `Sources/Noto/Views/VaultSidebarView.swift`
- Create: `Sources/Noto/Views/FileTreeView.swift`
- Create: `Sources/Noto/Views/RightContextPanelView.swift`
- Modify: `Sources/Noto/Views/MacWindowView.swift`

- [ ] **Step 1: Implement sidebar**

Create `Sources/Noto/Views/VaultSidebarView.swift`:

```swift
import SwiftUI
import NotoCore

struct VaultSidebarView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState

        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(appState.store.vault.name)
                        .font(.system(size: 15, weight: .semibold))
                    Text("Local Markdown Vault")
                        .font(.system(size: 11))
                        .foregroundStyle(NotoDesign.muted)
                }
                Spacer()
            }

            TextField("Search notes", text: $appState.store.searchQuery)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .padding(.horizontal, 10)
                .frame(height: 30)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.80)))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(NotoDesign.line, lineWidth: 1))

            Button {
                appState.createNewNote()
            } label: {
                Label("New Note", systemImage: "square.and.pencil")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)

            Button {
                appState.openGraph(filter: .all)
            } label: {
                Label("Knowledge Web", systemImage: "point.3.connected.trianglepath.dotted")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .foregroundStyle(NotoDesign.accent)

            ScrollView {
                FileTreeView(files: appState.store.filteredFiles)
            }

            Spacer(minLength: 0)
        }
        .padding(16)
        .background(.ultraThinMaterial)
        .overlay(alignment: .trailing) {
            Rectangle().fill(NotoDesign.line).frame(width: 1)
        }
    }
}
```

- [ ] **Step 2: Implement file tree**

Create `Sources/Noto/Views/FileTreeView.swift`:

```swift
import SwiftUI
import NotoCore

struct FileTreeView: View {
    @Environment(AppState.self) private var appState
    let files: [VaultFile]

    private var grouped: [(folder: String, files: [VaultFile])] {
        let groups = Dictionary(grouping: files) { file in
            file.path.components(separatedBy: "/").first ?? "Notes"
        }
        return groups.keys.sorted().map { key in
            (key, groups[key, default: []].sorted { $0.title < $1.title })
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if files.isEmpty {
                Text("No notes found.")
                    .font(.system(size: 12))
                    .foregroundStyle(NotoDesign.muted)
                    .padding(.vertical, 10)
            }

            ForEach(grouped, id: \.folder) { group in
                VStack(alignment: .leading, spacing: 5) {
                    Label(group.folder, systemImage: "folder")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(NotoDesign.muted)

                    ForEach(group.files) { file in
                        Button {
                            appState.selectFile(id: file.id)
                        } label: {
                            HStack(spacing: 7) {
                                Image(systemName: "doc.plaintext")
                                    .font(.system(size: 11))
                                Text(file.title)
                                    .lineLimit(1)
                                Spacer()
                            }
                            .font(.system(size: 12))
                            .padding(.vertical, 6)
                            .padding(.horizontal, 8)
                            .background(rowBackground(for: file))
                            .foregroundStyle(file.id == appState.store.activeFileId ? NotoDesign.accent : NotoDesign.ink)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func rowBackground(for file: VaultFile) -> some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(file.id == appState.store.activeFileId ? NotoDesign.accent.opacity(0.12) : Color.clear)
    }
}
```

- [ ] **Step 3: Implement right context panel**

Create `Sources/Noto/Views/RightContextPanelView.swift`:

```swift
import SwiftUI
import NotoCore

struct RightContextPanelView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        let file = appState.store.activeFile
        let metadata = file.flatMap { appState.store.metadata.filesById[$0.id] }

        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                metadataSection(metadata)
                outlineSection(metadata)
                backlinksSection(metadata)
                outgoingSection(metadata)
                aiMemorySection(appState.store.recorder.memory)
            }
            .padding(16)
        }
        .background(.ultraThinMaterial)
        .overlay(alignment: .leading) {
            Rectangle().fill(NotoDesign.line).frame(width: 1)
        }
    }

    private func metadataSection(_ metadata: FileMetadata?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(title: "Metadata")
            Text(metadata?.path ?? "No active note")
                .font(.system(size: 12))
                .foregroundStyle(NotoDesign.muted)
                .lineLimit(2)

            HStack(spacing: 8) {
                stat("Words", "\(metadata?.wordCount ?? 0)")
                stat("Backlinks", "\(metadata?.backlinks.count ?? 0)")
                stat("Links", "\(metadata?.outgoingLinks.count ?? 0)")
            }
        }
    }

    private func outlineSection(_ metadata: FileMetadata?) -> some View {
        panel(title: "Outline", empty: "No headings yet.", values: metadata?.headings ?? [])
    }

    private func backlinksSection(_ metadata: FileMetadata?) -> some View {
        panel(title: "Backlinks", empty: "No backlinks yet.", values: metadata?.backlinks ?? [])
    }

    private func outgoingSection(_ metadata: FileMetadata?) -> some View {
        panel(title: "Outgoing Links", empty: "No outgoing links.", values: metadata?.outgoingLinks ?? [])
    }

    private func aiMemorySection(_ memory: LectureMemory) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(title: "AI Memory")
            if memory.concepts.isEmpty {
                Text("Visible after you press Record.")
                    .font(.system(size: 12))
                    .foregroundStyle(NotoDesign.muted)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.70)))
            } else {
                ForEach(memory.concepts, id: \.self) { concept in
                    Text(concept)
                        .font(.system(size: 12))
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.74)))
                }
            }
        }
    }

    private func panel(title: String, empty: String, values: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(title: title)
            if values.isEmpty {
                Text(empty)
                    .font(.system(size: 12))
                    .foregroundStyle(NotoDesign.muted)
            } else {
                ForEach(values, id: \.self) { value in
                    Text(value)
                        .font(.system(size: 12))
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.74)))
                }
            }
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(NotoDesign.muted)
            Text(value)
                .font(.system(size: 14, weight: .semibold))
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.74)))
    }
}
```

- [ ] **Step 4: Remove matching temporary stubs from `MacWindowView.swift`**

Remove these lines if they are still present:

```swift
struct VaultSidebarView: View { var body: some View { Color.clear } }
struct RightContextPanelView: View { var body: some View { Color.clear } }
```

- [ ] **Step 5: Build**

Run:

```bash
swift build
```

Expected: PASS with no duplicate type declarations.

- [ ] **Step 6: Commit**

Run:

```bash
git add Sources/Noto/Views
git commit -m "feat: add vault sidebar and context inspector"
```

---

### Task 10: Build Markdown Workspace And Link Rendering

**Files:**
- Create: `Sources/Noto/Views/MarkdownWorkspaceView.swift`
- Create: `Sources/Noto/Views/MarkdownPreviewView.swift`
- Modify: `Sources/Noto/Views/MacWindowView.swift`

- [ ] **Step 1: Implement workspace tab shell**

Create `Sources/Noto/Views/MarkdownWorkspaceView.swift`:

```swift
import SwiftUI
import NotoCore

struct MarkdownWorkspaceView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                tab("Note", selected: appState.store.activeTab == .note) {
                    appState.store.activeTab = .note
                }
                tab("Knowledge Web", selected: appState.store.activeTab == .graph) {
                    appState.openGraph(filter: appState.store.graphFilter)
                }
                Spacer()
            }
            .padding(.horizontal, 18)
            .frame(height: 40)
            .background(Color.white.opacity(0.52))
            .overlay(alignment: .bottom) {
                Rectangle().fill(NotoDesign.line).frame(height: 1)
            }

            if appState.store.activeTab == .note {
                MarkdownPreviewView(file: appState.store.activeFile)
            } else {
                KnowledgeGraphView()
            }
        }
        .background(NotoDesign.editor)
    }

    private func tab(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: selected ? .semibold : .regular))
                .foregroundStyle(selected ? NotoDesign.ink : NotoDesign.muted)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(selected ? Color.white : Color.clear)
                )
        }
        .buttonStyle(.plain)
    }
}
```

- [ ] **Step 2: Implement Markdown preview**

Create `Sources/Noto/Views/MarkdownPreviewView.swift`:

```swift
import SwiftUI
import NotoCore

struct MarkdownPreviewView: View {
    @Environment(AppState.self) private var appState
    let file: VaultFile?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let file {
                    Text(file.title)
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(NotoDesign.ink)
                        .padding(.bottom, 4)

                    ForEach(renderLines(file.content), id: \.id) { line in
                        render(line)
                    }
                } else {
                    Text("No note selected.")
                        .foregroundStyle(NotoDesign.muted)
                }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(.horizontal, 38)
            .padding(.vertical, 30)
        }
    }

    private func render(_ line: RenderLine) -> some View {
        Group {
            switch line.kind {
            case .heading(let level, let text):
                Text(text)
                    .font(.system(size: level == 1 ? 24 : 17, weight: .semibold))
                    .foregroundStyle(NotoDesign.ink)
                    .padding(.top, level == 1 ? 4 : 8)
            case .bullet(let text):
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("•").foregroundStyle(NotoDesign.muted)
                    linkedText(text)
                }
            case .checkbox(let text, let checked):
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: checked ? "checkmark.square.fill" : "square")
                        .foregroundStyle(checked ? NotoDesign.accent : NotoDesign.muted)
                    linkedText(text)
                }
            case .callout(let text):
                linkedText(text)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10).fill(NotoDesign.accent.opacity(0.08)))
                    .overlay(alignment: .leading) {
                        Rectangle().fill(NotoDesign.accent).frame(width: 3)
                    }
            case .paragraph(let text):
                linkedText(text)
            case .blank:
                Spacer().frame(height: 4)
            }
        }
    }

    private func linkedText(_ text: String) -> some View {
        FlowLayout(spacing: 5) {
            ForEach(LinkSegment.segments(from: text), id: \.id) { segment in
                switch segment.kind {
                case .plain:
                    Text(segment.text)
                        .font(.system(size: 14))
                        .foregroundStyle(NotoDesign.ink)
                case .wiki:
                    Button {
                        openWikiLink(segment.text)
                    } label: {
                        Text("[[\(segment.text)]]")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(NotoDesign.accent)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(NotoDesign.accent.opacity(0.10)))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func openWikiLink(_ title: String) {
        guard let id = appState.store.metadata.fileIdByTitle[title] else { return }
        appState.selectFile(id: id)
    }

    private func renderLines(_ content: String) -> [RenderLine] {
        content.split(separator: "\n", omittingEmptySubsequences: false).enumerated().map { index, line in
            RenderLine(index: index, raw: String(line))
        }
    }
}

struct RenderLine: Identifiable {
    let id: Int
    let kind: Kind

    init(index: Int, raw: String) {
        id = index
        let text = raw.trimmingCharacters(in: .whitespaces)

        if text.isEmpty {
            kind = .blank
        } else if text.hasPrefix("#") {
            let level = text.prefix(while: { $0 == "#" }).count
            let value = text.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)
            kind = .heading(level: level, text: value)
        } else if text.hasPrefix("- [ ] ") {
            kind = .checkbox(text: String(text.dropFirst(6)), checked: false)
        } else if text.hasPrefix("- [x] ") || text.hasPrefix("- [X] ") {
            kind = .checkbox(text: String(text.dropFirst(6)), checked: true)
        } else if text.hasPrefix("- ") {
            kind = .bullet(text: String(text.dropFirst(2)))
        } else if text.hasPrefix(">") {
            kind = .callout(text: text.dropFirst().trimmingCharacters(in: .whitespaces))
        } else {
            kind = .paragraph(text: text)
        }
    }

    enum Kind {
        case heading(level: Int, text: String)
        case bullet(text: String)
        case checkbox(text: String, checked: Bool)
        case callout(text: String)
        case paragraph(text: String)
        case blank
    }
}

struct LinkSegment: Identifiable {
    let id: String
    let text: String
    let kind: Kind

    enum Kind {
        case plain
        case wiki
    }

    static func segments(from text: String) -> [LinkSegment] {
        let pattern = #"\[\[([^\[\]]+)\]\]"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return [LinkSegment(id: "plain-\(text)", text: text, kind: .plain)]
        }

        let nsRange = NSRange(text.startIndex..<text.endIndex, in: text)
        var result: [LinkSegment] = []
        var cursor = text.startIndex

        for match in regex.matches(in: text, range: nsRange) {
            guard let fullRange = Range(match.range(at: 0), in: text),
                  let titleRange = Range(match.range(at: 1), in: text) else { continue }
            if cursor < fullRange.lowerBound {
                let plain = String(text[cursor..<fullRange.lowerBound])
                result.append(LinkSegment(id: "plain-\(result.count)-\(plain)", text: plain, kind: .plain))
            }
            let title = String(text[titleRange])
            result.append(LinkSegment(id: "wiki-\(result.count)-\(title)", text: title, kind: .wiki))
            cursor = fullRange.upperBound
        }

        if cursor < text.endIndex {
            let plain = String(text[cursor..<text.endIndex])
            result.append(LinkSegment(id: "plain-\(result.count)-\(plain)", text: plain, kind: .plain))
        }

        return result
    }
}

struct FlowLayout<Content: View>: View {
    let spacing: CGFloat
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: spacing) {
            content
        }
    }
}
```

- [ ] **Step 3: Remove matching temporary stub from `MacWindowView.swift`**

Remove this line if it is still present:

```swift
struct MarkdownWorkspaceView: View { var body: some View { Color.clear } }
```

- [ ] **Step 4: Add a temporary graph stub**

Add this temporary declaration to the bottom of `Sources/Noto/Views/MarkdownWorkspaceView.swift` so the workspace can build before the real graph view is added:

```swift
struct KnowledgeGraphView: View {
    var body: some View {
        ContentUnavailableView(
            "Knowledge Web",
            systemImage: "point.3.connected.trianglepath.dotted",
            description: Text("Graph view is added in the next task.")
        )
    }
}
```

- [ ] **Step 5: Build**

Run:

```bash
swift build
```

Expected: PASS. If `FlowLayout` needs wrapping for long lines during visual review, replace it with a vertical-friendly custom layout in the polish task.

- [ ] **Step 6: Commit**

Run:

```bash
git add Sources/Noto/Views
git commit -m "feat: render markdown workspace with wiki links"
```

---

### Task 11: Build Knowledge Web UI

**Files:**
- Create: `Sources/Noto/Views/KnowledgeGraphView.swift`
- Modify: `Sources/Noto/Views/MacWindowView.swift`

- [ ] **Step 1: Implement graph view**

Create `Sources/Noto/Views/KnowledgeGraphView.swift`:

```swift
import SwiftUI
import NotoCore

struct KnowledgeGraphView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState
        let graph = appState.store.visibleGraph

        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Knowledge Web")
                        .font(.system(size: 22, weight: .bold))
                    Text("Generated from Markdown wiki links and backlinks.")
                        .font(.system(size: 12))
                        .foregroundStyle(NotoDesign.muted)
                }

                Spacer()

                Picker("Graph Filter", selection: $appState.store.graphFilter) {
                    ForEach(GraphFilter.allCases) { filter in
                        Text(filter.title).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 430)
            }
            .padding(24)

            if graph.nodes.isEmpty {
                ContentUnavailableView("No graph nodes", systemImage: "point.3.connected.trianglepath.dotted", description: Text("The selected filter has no notes to show."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                GeometryReader { proxy in
                    let layout = GraphLayout.layout(graph: graph, size: proxy.size, activeFileId: appState.store.activeFileId)

                    ZStack {
                        ForEach(graph.edges) { edge in
                            if let source = layout[edge.source], let target = layout[edge.target] {
                                Path { path in
                                    path.move(to: source)
                                    path.addLine(to: target)
                                }
                                .stroke(NotoDesign.accent.opacity(0.22), lineWidth: edge.weight)
                            }
                        }

                        ForEach(graph.nodes) { node in
                            let point = layout[node.id] ?? .zero
                            Button {
                                appState.selectFile(id: node.id)
                            } label: {
                                VStack(spacing: 5) {
                                    Circle()
                                        .fill(node.id == appState.store.activeFileId ? NotoDesign.accent : Color.white)
                                        .frame(width: nodeSize(node), height: nodeSize(node))
                                        .overlay(Circle().stroke(NotoDesign.accent.opacity(0.38), lineWidth: 1))
                                        .shadow(color: Color.black.opacity(0.10), radius: 8, x: 0, y: 4)
                                    Text(node.title)
                                        .font(.system(size: 11, weight: node.id == appState.store.activeFileId ? .semibold : .regular))
                                        .foregroundStyle(NotoDesign.ink)
                                        .lineLimit(1)
                                        .frame(width: 118)
                                }
                            }
                            .buttonStyle(.plain)
                            .position(point)
                        }
                    }
                    .padding(20)
                }
            }
        }
        .background(NotoDesign.editor)
    }

    private func nodeSize(_ node: GraphNode) -> CGFloat {
        CGFloat(18 + min(node.degree, 8) * 4)
    }
}

enum GraphLayout {
    static func layout(graph: KnowledgeGraph, size: CGSize, activeFileId: String) -> [String: CGPoint] {
        guard !graph.nodes.isEmpty else { return [:] }

        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let radius = max(120, min(size.width, size.height) * 0.34)
        let sorted = graph.nodes.sorted { left, right in
            if left.id == activeFileId { return true }
            if right.id == activeFileId { return false }
            return left.title < right.title
        }

        var points: [String: CGPoint] = [:]
        for (index, node) in sorted.enumerated() {
            if node.id == activeFileId {
                points[node.id] = center
            } else {
                let angle = (Double(index) / Double(max(sorted.count - 1, 1))) * Double.pi * 2 - Double.pi / 2
                let adjustedRadius = radius + CGFloat((node.degree % 3) * 18)
                points[node.id] = CGPoint(
                    x: center.x + cos(angle) * adjustedRadius,
                    y: center.y + sin(angle) * adjustedRadius
                )
            }
        }

        return points
    }
}
```

- [ ] **Step 2: Remove matching temporary graph stub**

Remove this temporary declaration from `Sources/Noto/Views/MarkdownWorkspaceView.swift`:

```swift
struct KnowledgeGraphView: View {
    var body: some View {
        ContentUnavailableView(
            "Knowledge Web",
            systemImage: "point.3.connected.trianglepath.dotted",
            description: Text("Graph view is added in the next task.")
        )
    }
}
```

- [ ] **Step 3: Build**

Run:

```bash
swift build
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add Sources/Noto/Views/KnowledgeGraphView.swift Sources/Noto/Views/MacWindowView.swift
git commit -m "feat: add generated Knowledge Web view"
```

---

### Task 12: Build AI Recorder Popup And Waveform

**Files:**
- Create: `Sources/Noto/Views/AIRecorderPanelView.swift`
- Create: `Sources/Noto/Views/AudioWaveformView.swift`
- Modify: `Sources/Noto/Views/MacWindowView.swift`

- [ ] **Step 1: Implement waveform**

Create `Sources/Noto/Views/AudioWaveformView.swift`:

```swift
import SwiftUI

struct AudioWaveformView: View {
    let isAnimating: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 4) {
            ForEach(0..<18, id: \.self) { index in
                RoundedRectangle(cornerRadius: 3)
                    .fill(NotoDesign.accent.opacity(0.78))
                    .frame(width: 4, height: isAnimating ? CGFloat(12 + ((index * 7) % 30)) : 10)
                    .animation(
                        isAnimating
                            ? .easeInOut(duration: 0.48 + Double(index % 4) * 0.08).repeatForever(autoreverses: true)
                            : .default,
                        value: isAnimating
                    )
            }
        }
        .frame(height: 54)
    }
}
```

- [ ] **Step 2: Implement recorder popup**

Create `Sources/Noto/Views/AIRecorderPanelView.swift`:

```swift
import SwiftUI
import NotoCore

struct AIRecorderPanelView: View {
    @Environment(AppState.self) private var appState
    @State private var timer: Timer?

    var body: some View {
        VStack(spacing: 14) {
            phaseHeader

            AudioWaveformView(isAnimating: appState.store.recorder.phase.isRecording)
                .opacity(appState.store.recorder.phase.isRecording ? 1 : 0.45)

            phaseBody

            Text("Recording only starts when you press Record.")
                .font(.system(size: 10))
                .foregroundStyle(NotoDesign.muted)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(width: 340, height: 300)
        .background(NotoDesign.glassBackground(cornerRadius: 42))
        .shadow(color: Color.black.opacity(0.22), radius: 34, x: 0, y: 22)
        .onDisappear { stopTimer() }
    }

    private var phaseHeader: some View {
        VStack(spacing: 5) {
            HStack(spacing: 6) {
                if appState.store.recorder.phase.isRecording {
                    Circle()
                        .fill(NotoDesign.recorderRed)
                        .frame(width: 8, height: 8)
                }
                Text("Lecture AI")
                    .font(.system(size: 16, weight: .semibold))
            }
            Text(statusText)
                .font(.system(size: 12))
                .foregroundStyle(NotoDesign.muted)
        }
    }

    private var phaseBody: some View {
        VStack(spacing: 10) {
            switch appState.store.recorder.phase {
            case .idle:
                Button {
                    appState.startRecording()
                    startTimer()
                } label: {
                    Label("Record", systemImage: "mic.fill")
                        .frame(width: 118)
                }
                .buttonStyle(.borderedProminent)

            case .recording:
                Text(timerText)
                    .font(.system(size: 18, weight: .semibold, design: .monospaced))
                Button {
                    stopTimer()
                    appState.stopRecording()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                        .frame(width: 112)
                }
                .buttonStyle(.bordered)

            case .processing:
                ProgressView()
                    .controlSize(.small)
                    .onAppear {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                            if let title = appState.store.activeFile?.title {
                                appState.store.recorder.finishProcessing(targetNoteTitle: title)
                            }
                        }
                    }

            case .complete:
                HStack(spacing: 8) {
                    Button("Open note") {
                        appState.store.activeTab = .note
                    }
                    Button("Record more") {
                        appState.recordMore()
                    }
                }
                .controlSize(.small)
            }

            if !appState.store.recorder.memory.concepts.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(appState.store.recorder.memory.concepts.suffix(3), id: \.self) { concept in
                        Text("• \(concept)")
                            .font(.system(size: 11))
                            .foregroundStyle(NotoDesign.ink)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var statusText: String {
        switch appState.store.recorder.phase {
        case .idle:
            return "Ready to listen when you start."
        case .recording:
            return "Listening to lecture..."
        case .processing:
            return "Organizing notes..."
        case .complete(let title):
            return "Notes added to \(title)"
        }
    }

    private var timerText: String {
        let seconds = appState.store.recorder.elapsedSeconds
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }

    private func startTimer() {
        stopTimer()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
            appState.recorderTick()
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }
}
```

- [ ] **Step 3: Remove matching temporary stub from `MacWindowView.swift`**

Remove this line if it is still present:

```swift
struct AIRecorderPanelView: View { var body: some View { EmptyView() } }
```

- [ ] **Step 4: Build**

Run:

```bash
swift build
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add Sources/Noto/Views
git commit -m "feat: add explicit AI recorder popup"
```

---

### Task 13: Build Command Palette

**Files:**
- Create: `Sources/Noto/Views/CommandPaletteView.swift`
- Modify: `Sources/Noto/Views/MacWindowView.swift`

- [ ] **Step 1: Implement command palette**

Create `Sources/Noto/Views/CommandPaletteView.swift`:

```swift
import SwiftUI
import NotoCore

struct CommandPaletteView: View {
    @Environment(AppState.self) private var appState
    @State private var query = ""

    private var commands: [PaletteCommand] {
        [
            PaletteCommand(title: "New Note", icon: "square.and.pencil") {
                appState.createNewNote()
                appState.isCommandPalettePresented = false
            },
            PaletteCommand(title: "Open Knowledge Web", icon: "point.3.connected.trianglepath.dotted") {
                appState.openGraph(filter: .all)
                appState.isCommandPalettePresented = false
            },
            PaletteCommand(title: "Toggle AI Recorder", icon: "mic.circle") {
                appState.toggleRecorder()
                appState.isCommandPalettePresented = false
            },
            PaletteCommand(title: "Search Notes", icon: "magnifyingglass") {
                appState.isCommandPalettePresented = false
            },
            PaletteCommand(title: "Insert Backlink", icon: "link") {
                guard let active = appState.store.activeFile else { return }
                let updated = NoteActions.insertBacklink("Photosynthesis", into: active, now: Date())
                appState.store.replaceFile(updated)
                appState.isCommandPalettePresented = false
            },
            PaletteCommand(title: "Create Lecture Note", icon: "waveform") {
                let note = NoteActions.createLectureNote(title: "Biology Lecture - May 13", now: Date())
                appState.store.vault.files.append(note)
                appState.store.selectFile(id: note.id)
                appState.isCommandPalettePresented = false
            },
            PaletteCommand(title: "Show Local Graph", icon: "scope") {
                appState.openGraph(filter: .local)
                appState.isCommandPalettePresented = false
            }
        ]
    }

    private var filteredCommands: [PaletteCommand] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return commands }
        return commands.filter { $0.title.localizedCaseInsensitiveContains(trimmed) }
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                Image(systemName: "command")
                    .foregroundStyle(NotoDesign.muted)
                TextField("Search commands", text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15))
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.84)))

            VStack(spacing: 4) {
                ForEach(filteredCommands) { command in
                    Button {
                        command.action()
                    } label: {
                        HStack {
                            Image(systemName: command.icon)
                                .frame(width: 22)
                            Text(command.title)
                            Spacer()
                        }
                        .font(.system(size: 13))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.001)))
                }
            }
        }
        .padding(12)
        .frame(width: 460)
        .background(NotoDesign.glassBackground(cornerRadius: 18))
        .shadow(color: Color.black.opacity(0.20), radius: 34, x: 0, y: 22)
    }
}

struct PaletteCommand: Identifiable {
    let id = UUID()
    let title: String
    let icon: String
    let action: () -> Void
}
```

- [ ] **Step 2: Remove matching temporary stub from `MacWindowView.swift`**

Remove this line if it is still present:

```swift
struct CommandPaletteView: View { var body: some View { EmptyView() } }
```

- [ ] **Step 3: Build**

Run:

```bash
swift build
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add Sources/Noto/Views/CommandPaletteView.swift Sources/Noto/Views/MacWindowView.swift
git commit -m "feat: add Noto command palette"
```

---

### Task 14: Polish Visual Fidelity And Verify The Prototype

**Files:**
- Modify: `Sources/Noto/Views/DesignSystem.swift`
- Modify: `Sources/Noto/Views/MacWindowView.swift`
- Modify: `Sources/Noto/Views/MarkdownPreviewView.swift`
- Modify: `Sources/Noto/Views/KnowledgeGraphView.swift`
- Modify: `Sources/Noto/Views/AIRecorderPanelView.swift`
- Modify: `docs/superpowers/specs/2026-05-13-noto-design.md` only if implementation intentionally differs from the approved design.

- [ ] **Step 1: Inspect current git state**

Run:

```bash
git status --short
```

Expected: clean worktree before polish starts.

- [ ] **Step 2: Run all tests**

Run:

```bash
swift test
```

Expected: PASS for `NotoCoreTests`.

- [ ] **Step 3: Build the app**

Run:

```bash
swift build
```

Expected: PASS with no compiler errors.

- [ ] **Step 4: Run the app**

Run:

```bash
swift run Noto
```

Expected: the Noto window opens. If the process remains active because the app window is open, close the app window before continuing.

- [ ] **Step 5: Manually verify required interactions**

Use the running app and confirm:

- Clicking `Biology/Photosynthesis.md` selects the Photosynthesis note.
- Sidebar search for `cold` filters to `Cold War.md`.
- Clicking `Knowledge Web` opens graph mode.
- Switching graph filter to `Local Graph` shows the active note neighborhood.
- Clicking a graph node selects the corresponding note.
- `Command + K` opens the command palette.
- Command palette `Show Local Graph` opens Knowledge Web in local mode.
- `Command + Control + M` opens the recorder panel.
- Recorder idle state shows `Recording only starts when you press Record.`
- Pressing Record starts waveform animation and visible recording state.
- Pressing Stop appends `## AI Lecture Notes` to the active note.
- Right panel AI Memory shows detected concepts while recording.
- Backlinks, outgoing links, and graph state update after note append.
- The titlebar shows `Noto` and `When you listen, Noto remembers.`

- [ ] **Step 6: Apply targeted polish changes**

If manual verification finds layout issues, apply only these kinds of changes:

```swift
// Preferred polish changes:
// - Adjust padding, spacing, fonts, and frame constraints.
// - Replace any visual collision with a stable minWidth, maxWidth, or fixed toolbar height.
// - Keep the palette calm: off-white, light gray, black text, and restrained blue accent.
// - Keep recorder privacy text visible in idle and recording states.
```

Do not add new product features in this task.

- [ ] **Step 7: Re-run final verification**

Run:

```bash
swift test
swift build
```

Expected: both commands PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add Sources Tests docs
git commit -m "polish: refine Noto prototype visuals"
```

---

## Final Acceptance Checklist

Before reporting completion, verify each item:

- [ ] `swift test` passes.
- [ ] `swift build` passes.
- [ ] `swift run Noto` launches the app.
- [ ] Noto name and slogan are visible.
- [ ] School Vault sidebar contains the required folders and notes.
- [ ] Search filters notes.
- [ ] Markdown preview renders headings, bullets, checkboxes, callouts, and wiki-link pills.
- [ ] Wiki-link pills open resolved target notes.
- [ ] Right panel shows path, word count, last edited, backlinks, outgoing links, outline, and AI memory.
- [ ] Backlinks are generated from wiki links.
- [ ] Knowledge Web nodes and edges are generated from metadata.
- [ ] Local graph filter shows active note, outgoing links, and backlinks.
- [ ] Recorder opens with `Command + Control + M`.
- [ ] Recorder starts only after pressing Record.
- [ ] Recorder privacy line is visible.
- [ ] Stop appends structured AI notes into the active note.
- [ ] Metadata and graph update after AI notes are appended.
- [ ] Command palette opens with `Command + K`.
- [ ] No real microphone capture is requested or implied.

## Execution Notes

Use these commands during execution:

```bash
swift test
swift build
swift run Noto
git status --short
```

Commit after each task. If a SwiftUI API differs on the installed macOS SDK, keep the product behavior the same and adapt the narrow syntax in that task.
