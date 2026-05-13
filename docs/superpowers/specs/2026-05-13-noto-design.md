# Noto Design Spec

Date: 2026-05-13
Status: Ready for user review

## Purpose

Noto is a high-fidelity native macOS visual prototype for a local-first Markdown notes workspace with an AI lecture-listening assistant. The product should feel like a serious Mac productivity app and should communicate an Obsidian-like notes architecture without copying Obsidian branding, iconography, or visual identity.

Slogan: "When you listen, Noto remembers."

The prototype focuses on making the knowledge workspace legible:

- A vault-like root workspace named "School Vault".
- Markdown notes represented as plain text files.
- Wiki links such as `[[Photosynthesis]]` and `[[Cell Structure]]`.
- Generated backlinks and outgoing links.
- A metadata cache derived from Markdown content.
- A generated graph view called "Knowledge Web".
- Split-pane note workspace with a vault sidebar and right context panel.
- A command palette for power-user actions.
- A floating AI recorder that only starts after explicit user action.

## Approved Approach

Use approach A: Focused Native Prototype.

Build a pure SwiftPM macOS executable using SwiftUI. The first version will be an in-memory prototype with polished UI and real derived metadata behavior. It will not implement real file-system vault persistence, real microphone capture, real transcription, or real AI summarization yet.

This keeps the first build focused on the product concept and knowledge architecture while leaving clear integration seams for production features.

## Technology

- SwiftPM package.
- SwiftUI macOS executable target.
- No backend.
- In-memory mock vault data.
- Native keyboard shortcuts for `Command + K` and `Command + Control + M`.
- SwiftUI animation for graph transitions, recorder entrance, timer, and waveform.

The workspace currently has no existing source files and no `Package.swift`, so the implementation will create the SwiftPM package from scratch.

## Product Layout

The app opens into a centered macOS desktop window styled as a polished productivity tool:

- Custom titlebar area with traffic-light controls, app title, and command/search affordance.
- Left translucent vault sidebar around 240 px wide.
- Central editor and preview workspace.
- Right translucent context panel around 280 px wide.
- Floating AI recorder utility panel that appears above the app when invoked.

### Left Sidebar

The left sidebar represents the local vault.

It includes:

- Vault name: "School Vault".
- Search input.
- "New Note" button.
- File tree grouped into folders:
  - Biology
  - History
  - Mathematics
  - Literature
  - AI Lecture Notes
- Example notes:
  - `Biology/Photosynthesis.md`
  - `Biology/Cell Structure.md`
  - `Biology/Enzymes.md`
  - `History/Cold War.md`
  - `History/Industrial Revolution.md`
  - `Mathematics/Logarithms.md`
  - `AI Lecture Notes/Biology Lecture - May 13.md`

Clicking a note changes the active file. Searching filters visible notes by path or title.

### Main Workspace

The central area has a quiet tab bar with at least:

- Active note tab.
- Knowledge Web tab.

The Markdown note view shows:

- Active note title.
- Markdown-like content.
- Rendered headings.
- Bullets.
- Checkboxes.
- Callout styling.
- Wiki links rendered as subtle pill-like links.

Resolved wiki links are clickable and open the target note. Unresolved links can render in the same visual family but should not create hard-coded metadata.

### Right Context Panel

The context panel is derived from the active note and current recorder state.

It contains:

- Active note metadata:
  - Path.
  - Word count.
  - Last edited date.
  - Backlink count.
  - Outgoing link count.
- Outline extracted from Markdown headings.
- Backlinks generated from the metadata cache.
- Outgoing links generated from active note wiki links.
- AI Memory from the active recording session:
  - Key definitions.
  - Important points.
  - Teacher emphasis.
  - Possible test questions.
  - Action items.

## Data Model

Use small explicit Swift models that can later map to disk-backed files.

```swift
struct Vault: Identifiable {
    let id: String
    var name: String
    var files: [VaultFile]
}

struct VaultFile: Identifiable {
    let id: String
    var path: String
    var title: String
    var content: String
    var createdAt: Date
    var updatedAt: Date
}

struct FileMetadata: Identifiable {
    let id: String
    let fileId: String
    let path: String
    let title: String
    let headings: [String]
    let outgoingLinks: [String]
    let backlinks: [String]
    let tags: [String]
    let wordCount: Int
    let updatedAt: Date
}

struct LectureMemory {
    var concepts: [String]
    var definitions: [LectureDefinition]
    var importantPoints: [String]
    var possibleQuestions: [String]
    var linkedNotes: [String]
}

struct LectureDefinition: Identifiable {
    let id: String
    var term: String
    var definition: String
}
```

The final implementation can refine these shapes, but the boundaries should remain clear: vault data is source content, metadata is derived data, graph data is derived from metadata, and AI memory is active-session state.

## Metadata Cache

Implement a pure utility that builds metadata from all vault files:

```swift
func buildMetadataCache(files: [VaultFile]) -> MetadataCache
```

The metadata cache extracts:

- Headings using Markdown heading markers.
- Wiki links using a simple `[[Title]]` parser.
- Tags using `#tag` parsing while ignoring Markdown heading markers.
- Word count from Markdown text.
- Updated date from `VaultFile.updatedAt`.
- Backlinks by scanning all files and resolving outgoing wiki links to known note titles.

Backlinks must not be hand-authored in UI state. They are always generated from outgoing links.

## Graph View

The graph view is called "Knowledge Web".

Graph data is generated from the vault and metadata cache:

```swift
struct GraphNode: Identifiable {
    let id: String
    let title: String
    let path: String
    let backlinksCount: Int
    let outgoingCount: Int
}

struct GraphEdge: Identifiable {
    let id: String
    let source: String
    let target: String
    let weight: Double
}
```

Each vault file becomes a node. Each resolved wiki link becomes an edge from source note to target note.

The Knowledge Web supports:

- Show all notes.
- Local graph.
- Lecture notes only.
- Orphan notes.

Local graph mode shows:

- The active note.
- Notes directly linked from the active note.
- Notes that backlink to the active note.

The prototype should use a deterministic SwiftUI layout so the graph is visually stable. A radial or simple force-like layout is acceptable. Nodes should be circular, clickable, and scaled by link degree. The active note should be highlighted.

## AI Recorder

The AI recorder is a floating, rounded, native-feeling SwiftUI utility panel opened with `Command + Control + M`.

States:

1. Idle
   - Title: "Lecture AI".
   - Text: "Ready to listen when you start."
   - Button: "Record".
   - Privacy line: "Recording only starts when you press Record."
   - Minimal microphone icon.

2. Recording
   - Visible red recording indicator.
   - Animated waveform.
   - Timer.
   - Stop button.
   - Text: "Listening to lecture..."
   - Live detected concepts.

3. Processing
   - Text: "Organizing notes..."
   - Subtle spinner or wave animation.

4. Complete
   - Text: "Notes added to <target note title>", for example "Notes added to Biology Lecture - May 13".
   - Buttons:
     - "Open note".
     - "Record more".

The recorder must not imply background listening. Recording only starts after pressing Record. For this prototype, recording is simulated, but the UI and state model must preserve the consent boundary needed for real microphone capture later.

## AI Note-Taking Simulation

During simulated recording, the app periodically adds lecture concepts to the active session memory:

- "chlorophyll absorbs light"
- "glucose stores chemical energy"
- "carbon dioxide enters through stomata"
- "Calvin cycle produces sugar"
- "possible test question: compare light reactions and Calvin cycle"

When the user presses Stop, the app appends a structured Markdown section to the active note:

```markdown
## AI Lecture Notes

### Main explanation
The teacher explained that photosynthesis converts light energy into chemical energy stored in glucose.

### Key definitions
- Chlorophyll: pigment that absorbs light energy.
- Chloroplast: organelle where photosynthesis occurs.
- Calvin cycle: process that helps produce sugar.

### Important relationships
- [[Chloroplast]] is connected to [[Photosynthesis]]
- [[Glucose]] is the product of photosynthesis
- [[Carbon Dioxide]] is a reactant in the process

### Possible test questions
- Explain the difference between light-dependent reactions and the Calvin cycle.
- Why is chlorophyll important?
- What role does carbon dioxide play?
```

After append, `updatedAt` changes, metadata rebuilds, and graph/backlink/outgoing-link UI updates from the new Markdown content.

## Command Palette

`Command + K` opens a compact native command palette.

Commands:

- New Note.
- Open Knowledge Web.
- Toggle AI Recorder.
- Search Notes.
- Insert Backlink.
- Create Lecture Note.
- Show Local Graph.

Commands can be backed by local closures in the first prototype. They should be visibly listed and searchable.

## Component Boundaries

Suggested source organization:

```text
Package.swift
Sources/Noto/
  NotoApp.swift
  AppState.swift
  Data/MockVault.swift
  Models/Vault.swift
  Models/Metadata.swift
  Models/Graph.swift
  Models/AI.swift
  Lib/MarkdownParser.swift
  Lib/MetadataCacheBuilder.swift
  Lib/GraphBuilder.swift
  Lib/NoteActions.swift
  Views/MacWindowView.swift
  Views/TitleBarView.swift
  Views/VaultSidebarView.swift
  Views/FileTreeView.swift
  Views/MarkdownWorkspaceView.swift
  Views/MarkdownPreviewView.swift
  Views/RightContextPanelView.swift
  Views/KnowledgeGraphView.swift
  Views/CommandPaletteView.swift
  Views/AIRecorderPanelView.swift
  Views/AudioWaveformView.swift
```

These names can be adjusted during implementation, but the implementation should avoid putting all behavior into one large SwiftUI file.

## Integration Seams

Add short comments where production integrations would later attach:

- Real local file-system vault access using security-scoped bookmarks and file watching.
- Real microphone capture using AVFoundation.
- Real transcription service.
- Real AI summarization.
- Real vector memory or semantic memory.
- Real graph persistence and layout caching.

These comments should be sparse and attached to relevant code boundaries.

## Visual Direction

The app should feel native, premium, quiet, and focused:

- Rounded desktop window.
- Soft translucent sidebars.
- Thin separators and borders.
- Minimal titlebar.
- Small readable typography.
- Off-white and light gray surfaces.
- One restrained accent color for links and active states.
- Smooth animations.
- No childish gradients.
- No generic dashboard card layout.
- No Obsidian brand colors, icons, or exact identity.

## Error Handling And Empty States

The prototype should include sensible local states:

- If search returns no notes, show a compact empty result row.
- If a note has no backlinks, show "No backlinks yet."
- If a note has no outgoing links, show "No outgoing links."
- If graph filters produce no nodes, show a quiet empty graph state.
- If the user stops recording before simulated concepts appear, still append a minimal AI notes section based on default memory.

No production error boundary is needed for the first prototype.

## Verification

Implementation must be verified with SwiftPM:

- Run `swift build`.
- Fix all Swift compiler errors.
- Run the executable if feasible with `swift run`.
- Confirm the package products found.
- Confirm whether build, run, or test succeeded.

There may be no automated tests in the first prototype, but the pure parser, metadata, and graph utilities should be structured so targeted tests can be added later.

## Non-Goals For First Prototype

- Real microphone recording.
- Real transcription.
- Real AI/LLM service calls.
- Real file-system vault persistence.
- App Store sandboxing and entitlements.
- Sync.
- Plugins.
- A production Markdown editor.
- Exact Obsidian visual design.

## Acceptance Criteria

The first implementation is successful when:

- The app is a SwiftUI/SwiftPM macOS executable.
- The UI clearly looks like a polished macOS desktop app.
- The notes workspace clearly communicates vault, Markdown notes, file tree, wiki links, backlinks, outgoing links, graph view, command palette, and metadata cache.
- The Knowledge Web is generated from note links, not hard-coded graph edges.
- Local graph mode filters to the active note relationship neighborhood.
- Clicking notes changes active note.
- Clicking graph nodes changes active note.
- `Command + Control + M` opens and closes the AI recorder.
- Pressing Record starts visible simulated recording with waveform animation.
- Pressing Stop appends structured AI notes to the active Markdown note.
- Right sidebar AI memory updates during recording.
- Metadata, backlinks, outgoing links, and graph update after AI note append.
- `Command + K` opens the command palette.
- Sidebar search filters notes.
- The app never appears to record secretly and always shows clear recording state.
- `swift build` succeeds without compiler errors.
