// Roadmap board data for the download / coming-soon page.
// Votes and comment counts are intentionally omitted — the board is read-only.

export type TagKey = "feature" | "improvement" | "fix";

export interface RoadmapTag {
  label: string;
  color: string;
}

export interface ChecklistItem {
  label: string;
  done: boolean;
}

export interface RoadmapCard {
  id: string;
  title: string;
  tag: TagKey;
  status: string;
  target: string;
  author: string;
  desc: string[];
  checklist: ChecklistItem[];
  links: string[];
}

export interface RoadmapColumn {
  key: string;
  name: string;
  icon: "inbox" | "forward" | "bolt" | "check-circle";
  color: string;
  cards: RoadmapCard[];
}

export const TAGS: Record<TagKey, RoadmapTag> = {
  feature: { label: "Feature", color: "#578FFA" },
  improvement: { label: "Improvement", color: "#E0A23B" },
  fix: { label: "Fix", color: "#F54740" },
};

export const COLUMNS: RoadmapColumn[] = [
  {
    key: "backlog",
    name: "Backlog",
    icon: "inbox",
    color: "#9AA0AD",
    cards: [
      {
        id: "mobile",
        title: "Mobile companion for iPhone & iPad",
        tag: "feature",
        status: "Backlog",
        target: "Exploring",
        author: "Product",
        desc: [
          "A read-and-capture companion that opens the same on-disk vault from your pocket. Browse notes, follow wiki links, and jot quick captures that sync back to your Mac.",
          "Editing parity with the desktop app is explicitly out of scope for v1 — the goal is fast capture and reliable reading, not a second full editor.",
        ],
        checklist: [
          { label: "Vault format spec finalised", done: true },
          { label: "Read-only browsing prototype", done: false },
          { label: "Quick-capture inbox", done: false },
          { label: "Conflict-free sync layer", done: false },
        ],
        links: ["Vault format", "iCloud sync", "Quick capture"],
      },
      {
        id: "pdf",
        title: "Annotate & import PDFs into the vault",
        tag: "feature",
        status: "Backlog",
        target: "Exploring",
        author: "Community",
        desc: [
          "Drop a PDF into a folder and Noto creates a linked note beside it. Highlights and margin notes become Markdown you can back-link to like any other note.",
        ],
        checklist: [
          { label: "PDF thumbnailing", done: false },
          { label: "Highlight → Markdown extraction", done: false },
          { label: "Two-way scroll sync", done: false },
        ],
        links: ["Markdown vault", "Backlinks"],
      },
      {
        id: "plugins",
        title: "Public plugin API",
        tag: "feature",
        status: "Backlog",
        target: "Researching",
        author: "Platform",
        desc: [
          "A sandboxed, local-first extension API so the community can add custom panels, commands, and exporters — without ever sending your vault to a server.",
        ],
        checklist: [
          { label: "API surface design doc", done: true },
          { label: "Permission model", done: false },
          { label: "Sample plugins", done: false },
        ],
        links: ["Command palette", "Security model"],
      },
      {
        id: "vim",
        title: "Vim-style keybindings",
        tag: "improvement",
        status: "Backlog",
        target: "Planned",
        author: "Community",
        desc: [
          "Modal editing for the workspace, including normal/insert modes, motions, and a leader key bound to the command palette.",
        ],
        checklist: [
          { label: "Normal & insert modes", done: false },
          { label: "Motions & text objects", done: false },
        ],
        links: ["Editor", "Command palette"],
      },
      {
        id: "encrypt",
        title: "End-to-end encrypted vault sync",
        tag: "feature",
        status: "Backlog",
        target: "Researching",
        author: "Security",
        desc: [
          "Optional zero-knowledge encryption for users who sync their vault across machines. Keys stay on your devices; we never see plaintext.",
        ],
        checklist: [
          { label: "Crypto design review", done: false },
          { label: "Key recovery flow", done: false },
        ],
        links: ["iCloud sync", "Security model"],
      },
    ],
  },
  {
    key: "next",
    name: "Next up",
    icon: "forward",
    color: "#578FFA",
    cards: [
      {
        id: "graphfilter",
        title: "Graph view: filter by tag & folder",
        tag: "feature",
        status: "Next up",
        target: "Q3 2026",
        author: "Core",
        desc: [
          "Slice the knowledge web down to the threads you care about. Filter the graph by tag, folder, or recency, and pin a focus node to explore its neighbourhood.",
        ],
        checklist: [
          { label: "Tag & folder filters", done: true },
          { label: "Focus-node neighbourhood mode", done: false },
          { label: "Saved graph views", done: false },
        ],
        links: ["Knowledge Web", "Wiki links"],
      },
      {
        id: "daily",
        title: "Daily note templates",
        tag: "feature",
        status: "Next up",
        target: "Q3 2026",
        author: "Core",
        desc: [
          "A configurable daily note with templated sections, automatic date back-links, and a calendar strip to jump between days.",
        ],
        checklist: [
          { label: "Template variables", done: true },
          { label: "Calendar jump strip", done: false },
        ],
        links: ["Templates", "Backlinks"],
      },
      {
        id: "multiwin",
        title: "Multi-window editing",
        tag: "improvement",
        status: "Next up",
        target: "Q3 2026",
        author: "Core",
        desc: [
          "Tear a note out into its own window and place it on a second display. Each window keeps its own command palette and recorder state.",
        ],
        checklist: [
          { label: "Window tear-off", done: false },
          { label: "Per-window state", done: false },
        ],
        links: ["Workspace"],
      },
    ],
  },
  {
    key: "progress",
    name: "In Progress",
    icon: "bolt",
    color: "#E0A23B",
    cards: [
      {
        id: "icloud",
        title: "iCloud vault sync (beta)",
        tag: "feature",
        status: "In Progress",
        target: "Ships June 20",
        author: "Core",
        desc: [
          "Keep one vault in step across every Mac signed into your iCloud account. Sync runs file-by-file over Markdown, so nothing is locked into a proprietary database.",
          "Currently in closed beta with around 400 testers. Conflict handling and large-attachment performance are the last items before public release.",
        ],
        checklist: [
          { label: "File-level sync engine", done: true },
          { label: "Conflict resolution UI", done: true },
          { label: "Large attachment handling", done: false },
          { label: "Public rollout", done: false },
        ],
        links: ["Markdown vault", "Mobile companion"],
      },
      {
        id: "languages",
        title: "Lecture AI: 12 new languages",
        tag: "feature",
        status: "In Progress",
        target: "Ships June 20",
        author: "Lecture AI",
        desc: [
          "On-device transcription and structured note drafting for twelve additional languages, including Japanese, German, and Spanish — all without your audio leaving the Mac.",
        ],
        checklist: [
          { label: "Model packaging per language", done: true },
          { label: "Mixed-language lectures", done: false },
          { label: "Accuracy benchmarking", done: false },
        ],
        links: ["Lecture AI", "AI Memory"],
      },
      {
        id: "latex",
        title: "Inline LaTeX & math blocks",
        tag: "feature",
        status: "In Progress",
        target: "Q3 2026",
        author: "Editor",
        desc: [
          "Write $inline$ and $$block$$ math that renders live in the preview, with a symbol palette for the formulas you reach for most.",
        ],
        checklist: [
          { label: "Inline rendering", done: true },
          { label: "Block rendering", done: true },
          { label: "Symbol palette", done: false },
        ],
        links: ["Markdown preview"],
      },
    ],
  },
  {
    key: "done",
    name: "Shipped",
    icon: "check-circle",
    color: "#4FA776",
    cards: [
      {
        id: "palette",
        title: "Command palette ⌘K",
        tag: "feature",
        status: "Shipped",
        target: "v1.4",
        author: "Core",
        desc: [
          "Jump between notes, toggle the recorder, and open the graph from a single fuzzy-searchable palette. Everything in Noto is now one keystroke away.",
        ],
        checklist: [
          { label: "Fuzzy command search", done: true },
          { label: "Note quick-switch", done: true },
          { label: "Custom shortcuts", done: true },
        ],
        links: ["Workspace", "Knowledge Web"],
      },
      {
        id: "backlinks",
        title: "Backlinks & outgoing links panel",
        tag: "feature",
        status: "Shipped",
        target: "v1.3",
        author: "Core",
        desc: [
          "A right-hand context panel that shows every note linking in, and every note this one links out to — so you always know where an idea sits in your web.",
        ],
        checklist: [
          { label: "Backlinks index", done: true },
          { label: "Outgoing links", done: true },
        ],
        links: ["Wiki links", "Knowledge Web"],
      },
      {
        id: "dark",
        title: "Dark mode",
        tag: "improvement",
        status: "Shipped",
        target: "v1.3",
        author: "Design",
        desc: [
          "A true dark theme tuned to the same restrained palette as the rest of Noto, with a single keystroke to flip between light and dark.",
        ],
        checklist: [
          { label: "Dark token set", done: true },
          { label: "System-follow option", done: true },
        ],
        links: ["Design system"],
      },
      {
        id: "autocomplete",
        title: "Wiki-link autocomplete",
        tag: "feature",
        status: "Shipped",
        target: "v1.2",
        author: "Editor",
        desc: [
          "Type two square brackets and Noto suggests existing notes as you go, creating the link — and the backlink — the moment you accept.",
        ],
        checklist: [
          { label: "Inline suggestions", done: true },
          { label: "Create-on-accept", done: true },
        ],
        links: ["Wiki links", "Backlinks"],
      },
    ],
  },
];
