# Noto — Stage A: Competitive Analysis & Wedge Recommendation

**Date:** 2026-06-28
**Status:** Stage A deliverable (analysis only — no design/code). Awaiting wedge sign-off before Stage B (superpowers:brainstorming → writing-plans).
**Companion doc:** `docs/superpowers/specs/2026-06-27-noto-mcp-memory-layer-design.md` (the MCP architecture decision doc).

> **What exists in Noto today (verified from code + project memory):** a hosted web app (React 19 + Express 5 + SQLite, `landing/`) with notes CRUD, a wiki-link knowledge graph, **client-side semantic Smart Search** (MiniLM in-browser), an OpenAI-backed AI window (chat / summarize / flashcards / find-links / lecture transcription), and inline link citations. **The MCP shared-memory layer is fully *designed* (companion doc) but *not built*.** Noto is **cloud/hosted, not local-first** (the server is the source of truth). These three facts constrain every recommendation below.

---

## Executive summary (the punchline)

The market has quietly crossed a threshold in 2025–2026: **almost every serious note/meeting app now ships an MCP server or public API** so Claude/Cursor/ChatGPT can reach it. Integration-exists is no longer a differentiator. But the research surfaced one **empty corner** that nobody occupies:

> A **polished notes app you'd actually write in**, that is **purpose-built as your AI's shared memory** — official, frictionless, **read *and* write**, **cross-tool**, with **memory hygiene** (dedup/decay/scope/rank) and a **provenance/trust layer** so the AI-written memory is auditable.

- **Notion** ships the official, hosted, read+write, cross-tool MCP — but it's a database-block app, cloud-only, and has *zero* memory semantics (no dedup/decay/provenance; it's generic page CRUD). It's the biggest threat and the clearest benchmark.
- **Obsidian + community MCP** is the closest "your notes ARE the AI's memory," but the bridge is fragmented, solo-maintained, assembly-required, desktop-only, unofficial.
- **Pieces** has the best privacy posture but is auto-capture (not authoring), dev-only, and its MCP is **read-only** (no write-back).
- **mem0 / Letta** are developer infrastructure with no human writing surface. **Supermemory** is a cloud RAG store with a consumer app bolted on.
- **Native memory** (ChatGPT, Claude, Cursor, Windsurf, Codex) is a **hard silo** in every case — **zero cross-vendor interchange**. The only shared layer is the `AGENTS.md` file convention, and only among coding tools.

**Recommended wedge:** *"Noto is the app that remembers — the notes vault that doubles as the live, shared, auditable memory your Claude Code, Cursor, and ChatGPT read from and write back to, so you stop re-explaining context."* It uses Noto's actual assets (graph, semantic search, AI, the already-designed MCP spec) and attacks the single highest-pain, worst-served gap. Honest caveat: Noto is **not** local-first, so it cannot win the privacy corner that Pieces/Obsidian own — the wedge must be won on **memory quality + trust**, not data locality.

---

## Part 1 — Competitor matrix (cited; current as of June 2026)

Sourcing notes: prices verified against vendor pricing pages where reachable; several vendor pages are JS-gated or hide USD until checkout (flagged). "Trains on your data" is reported as the vendor's stated default. **A recurring 2026 trap:** SEO blogs lag real repricings (esp. Tana, Notion AI) — figures below favor the vendor's live page.

### 1a. Structure-first

| App | Known for | Org model | AI | Pricing & free-tier reality | Data / training | External-AI access | Biggest weakness |
|---|---|---|---|---|---|---|---|
| **Notion** | All-in-one workspace | DB/properties + pages | Bolt-on→woven | Free; Plus $10; **Business $20**/seat (full AI); custom agents $10/1k credits ([pricing](https://www.notion.com/pricing)). Free AI ≈ ~20 lifetime responses | Cloud; **does NOT train** on customer data ([security](https://www.notion.com/help/notion-ai-security-practices)) | **Official hosted MCP** (read+write) + official Claude Code plugin ([mcp](https://developers.notion.com/guides/mcp/get-started-with-mcp)) | Slow on big DBs (>5k); weak mobile/offline |
| **Tana** | Supertags (queryable nodes) | DB + links (outliner) | **Native** | Free (≈5 meetings, 50 AI queries); **Pro $20–30**, Max $80–120 ([pricing](https://tana.inc/pricing)) — note: blogs still say $10/$18 (stale) | Cloud; training posture **unverified** | **Official in-app local MCP**, auto-configured ([docs](https://tana.inc/docs/local-api-mcp)) | Steep learning curve; weak mobile (~2.15★) |
| **Capacities** | Object-based notes | DB (object types) + links | Bolt-on | Free (no AI); **Pro $9.99**; Believer $12.49 ([pricing](https://capacities.io/pricing)) | Cloud; not E2E; training **unverified** | Official AI Chat Connectors (MCP) + API ([docs](https://docs.capacities.io/developer/model-context-protocol)) | No real-time collab; buggy mobile capture |
| **Obsidian** | Local-first MD vault + plugins | Folders + links | Bolt-on (plugins only) | **Core free, no limits**; Sync $4; Publish $8 ([pricing](https://obsidian.md/pricing)) | **Local-first plain files**; Sync E2E; no vendor AI | **Community-only** but mature (Local REST API + 3rd-party MCP) | Assembly/maintenance burden; weak mobile |
| **Logseq** | OSS local-first outliner | Links + tags (outliner) | Minimal | Core free; Sync ~$5 ([ref](https://aitoolpick.org/blog/logseq-pricing-2026/)). DB version + paid "Pro" still in beta | **Local-first**; Sync E2E | Community MCP via local HTTP API | DB-rewrite limbo; momentum stalled |
| **Roam** | Pioneered bidirectional links | Links + tags (outliner) | Lagging | **No free tier**; Pro $15/mo; Believer $500/5yr ([ref](https://costbench.com/software/note-taking/roam-research/)) | Cloud; training **unverified** | Official MCP + community (Datalog) ([docs](https://developer.ro.am/docs/integrations/mcp)) | Stagnation; lag on big graphs; no native mobile |
| **Craft** | Beautiful documents | Folders/spaces + links | Bolt-on | Free (1,500 blocks, 15 AI credits); **Plus $4.80**/mo annual ([pricing](https://www.craft.do/pricing)) | Cloud; training **unverified** | **Official MCP/API**, per-doc scoping ([imagine](https://www.craft.do/imagine)) | Apple-centric; thin PKM depth |
| **RemNote** | Notes + spaced repetition | Links + tags (outliner) | Native (niche) | Free (100 AI credits/mo); **Pro $8**; Pro+AI $18 ([pricing](https://www.remnote.com/pricing)) | Cloud sync; training **unverified** | Community MCP via Automation Bridge | Buggy/unreliable, esp. iOS sync |

### 1b. Capture-first

| App | Known for | Org model | AI | Pricing & free-tier reality | Data / training | External-AI access | Biggest weakness |
|---|---|---|---|---|---|---|---|
| **Mem** | AI auto-organizes (no filing) | **AI-auto** + tags | **Native (only one that earns it)** | Free (25 notes/mo — trial-grade); **Pro $12** ([pricing](https://get.mem.ai/pricing)) | Cloud; no-train pledge **not found (unverified)** | Official API + Zapier; **no MCP** | Reliability/trust + poor support; **the cautionary tale for auto-organize** |
| **Reflect** | E2E networked notebook | Links + tags | Bolt-on (assist) | **No free tier**; ~$10/mo ([site](https://reflect.app/)) | Cloud **+ E2E**; **explicitly no-train** ([privacy](https://reflect.app/privacy)) | Official OAuth API + "edit with coding agents"; MCP community ([blog](https://reflect.app/blog/edit-notes-with-coding-agents)) | Expensive for a single-pane app; small ecosystem |
| **Apple Notes** (Apple Intelligence) | Free ubiquitous default | Folders + tags | Bolt-on (system) | Free (tied to iCloud) | **On-device + Private Cloud Compute; never stored, not trained** ([PCC](https://security.apple.com/blog/private-cloud-compute/)) | **Weakest** — no official API; brittle AppleScript shims | Apple-only lock-in; shallow org/AI |
| **Google Keep** (Gemini) | Sticky-note capture | Tags/color | Bolt-on (thin) | Free (Google One storage) | Cloud; Keep-specific no-train **unverified** | No official consumer API; no MCP | Too basic to scale |
| **Bear** | Beautiful Apple Markdown | Tags + light wiki-links | ~None | Free (no sync); **Pro $2.99/mo** ([faq](https://bear.app/faq/features-and-price-of-bear-pro/)) | **Local + iCloud**; per-note encryption (Pro) | Official x-callback + strong community MCP | Apple-only |

### 1c. Synthesis-first

| App | Known for | Org model | AI | Pricing & free-tier reality | Data / training | External-AI access | Biggest weakness |
|---|---|---|---|---|---|---|---|
| **NotebookLM** | Grounded cited Q&A + Audio Overviews | AI-auto (source-bound) | **Native** | Free (50 sources/notebook, 50 chats/day); Plus $7.99; Pro $19.99 via Google AI ([plans](https://notebooklm.google/plans)) | Cloud; **does NOT train** ([privacy](https://support.google.com/notebooklm/answer/17004255)) | No official MCP (Enterprise API only); community MCP | **No structured export** — source-bound consumption, lossy to get your own work out ([ref](https://www.makeuseof.com/switched-away-from-notebooklm-because-export-limitations-broke-research/)) |
| **Heptabase** | Infinite whiteboard sensemaking | Canvas + links | Bolt-on | **No free tier**; Pro $8.99; Premium $17.99 ([pricing](https://heptabase.com/pricing)) | **Local-first**; no-train **unverified** | Community MCP (local backup), officially documented | Weak mobile; lag on big boards |
| **Fabric** | Self-organizing AI library | AI-auto + tags | **Native** | Free; Plus $4.67; Pro $12.50 ([pricing](https://fabric.so/pricing-and-plans-for-individuals)) | Cloud; **anonymized, never trained** ([privacy](https://fabric.so/info/privacy)) | **No MCP / public API found** | Thin independent review coverage |
| **Scrintal** | Visual cards/mind-map | Canvas + links | Bolt-on | ~$9/mo; free tier slipping ([pricing](https://scrintal.com/pricing)) | Cloud; no-train **unverified** | **No API, no MCP** | No Markdown import/export (lock-in); no offline |
| **Atlas** (atlasworkspace.ai) | NotebookLM-style cited mind-map | Canvas + AI-auto | **Native** | Free (5 lifetime chats); Pro $17 ([pricing](https://www.atlasworkspace.ai/pricing)) | Cloud; **explicit no-train**; SOC2/HIPAA | **None found** | Source-bound, no real authoring/export; trial-only free |
| **Storyflow** | *(Identity flagged)* AI storyboarding self-marketed as notes | Canvas + AI-auto | Native | Free; Plus $7.99; Pro $14 ([pricing](https://storyflow.so/pricing)) | **Unverified** | **None found** | Not really a notes app; no independent reviews |

### 1d. Meeting / voice-native (every one now ships official MCP — but all silo)

| App | Known for | AI beyond summaries? | Pricing & free-tier reality | Data / training | External-AI access | Biggest weakness |
|---|---|---|---|---|---|---|
| **Granola** | Bot-less AI notepad augmenting *your* notes | Yes — Granola Chat across all notes, cited | **Basic free** (30-day window); Business $14; Ent $35 ([pricing](https://www.granola.ai/pricing)) | Cloud; 3rd-parties never train; **own models may use anonymized data (opt-out)** | **Official MCP** ([docs](https://docs.granola.ai/help-center/sharing/integrations/mcp)); transcripts gated to Business+ | **No easy export**; notes siloed |
| **Otter** | Live transcription / meeting agent | Yes — Otter Chat across history | Free (300 min, 30-min cap); Pro $8.33; Business $20 ([pricing](https://otter.ai/pricing)) | Cloud; **trains own models by default** (buried opt-out) | Official MCP (read-only) in Claude directory | **Privacy class action** (consolidated Dec 2025); accuracy |
| **Fathom** | Best free meeting recorder | Ask Fathom (cross-call, gated) | Free (5 AI summaries/mo); Premium $16; Business $25 ([pricing](https://www.fathom.ai/pricing)) | Cloud; 3rd-parties barred; **own models use de-identified data (opt-out)** | **Official MCP + REST** ([docs](https://developers.fathom.ai/mcp-docs)) | Weak cross-library semantic recall |
| **Fireflies** | Bot notetaker + dev API | Yes — Global AskFred across all meetings | Free (20 AI credits/mo); Pro $10; Business $19 ([pricing](https://fireflies.ai/pricing)) | Cloud; **"don't train by default, every tier"; 0-day LLM retention** ([security](https://fireflies.ai/security)) | **Official MCP + GraphQL API** ([docs](https://docs.fireflies.ai/getting-started/mcp-configuration)) | Intrusive bot; **BIPA class action** (Dec 2025) |
| **Limitless** (ex-Rewind) | Wearable always-on recall | Yes — Ask Limitless | **Meta-acquired Dec 2025, winding down**; pendant unsold; free 20 hrs/mo | Cloud; **trains on data** | Official MCP (**read-only**) | Cloud dependency + bystander consent; **wind-down** |

### 1e. Legacy + outliners

| App | Known for | Pricing & free-tier reality | Data / training | External-AI access | Biggest weakness |
|---|---|---|---|---|---|
| **Evernote** | Capture-everything web clipper | Free **50 notes/1 device** (notorious); Starter $99/yr; Advanced $250/yr ([ref](https://costbench.com/software/note-taking/evernote/)) | Cloud; **explicit no-train** ([policy](https://evernote.com/privacy/policy)) | **Official Claude/MCP connector** ([connector](https://evernote.com/model-context-protocol/evernote-claude-connector)) | Post-acquisition price hikes + free-tier gutting → ongoing exodus |
| **OneNote** | Free-form notebook canvas | App free w/ MS account; **AI gated** behind M365 Copilot ~$30/user ([pricing](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing)) | Cloud; **no-train** (M365 boundary) | Graph API → thriving **community** MCP servers | Sync unreliability; organization chaos (20+ yrs) |
| **Workflowy** | Infinite nested outliner | Free 100 nodes/mo; Pro $6.99 annual ([pricing](https://workflowy.com/pricing/)) | Cloud; AI data not trained | Internal AI only; **no external MCP** | Feature stagnation |
| **Saner.ai** | AI-native ADHD capture/assistant | Free; Starter $8; Pro $16 ([ref](https://opentools.ai/tools/sanerai)) | Cloud; **explicit no-train** ([privacy](https://hub.saner.ai/en/help/articles/9983529-security-and-privacy)) | **Inbound only** — no outbound MCP | Young, narrow, cloud-locked |

### 1f. The AI-memory-layer set (the direct competitive frame for the wedge)

| Product | Human-writable notes? | MCP read/write? | Org model | Pricing | Data | The gap vs "notes app = shared AI memory" |
|---|---|---|---|---|---|---|
| **Pieces** | ✗ auto-capture | Official, **read-only** | Activity timeline + snippets | Free; Pro $18.99 ([plans](https://docs.pieces.app/products/paid-plans)) | **Local-first; SOC2; no-train** ([sec](https://docs.pieces.app/products/privacy-security-your-data)) | Not a notes app; no write-back; dev-only |
| **mem0** | ✗ | Official (OpenMemory), R/W | Vector + facts + graph | OSS free; cloud $19+ ([pricing](https://mem0.ai/pricing)) | Self-host or cloud; **trains free-tier data** | Developer infra — no human surface |
| **Supermemory** | ~ (thin app) | Official, R/W (cloud) | RAG + facts + graph | Free; Pro $19 ([pricing](https://supermemory.ai/pricing)) | Cloud default; OSS self-host; no-train **unverified** | A RAG store, not a Markdown editor |
| **Letta** (MemGPT) | ✗ | **Inbound only (can't be a backend)** | Tiered agent memory | Free; Pro $20 ([pricing](https://docs.letta.com/letta-code/pricing)) | Self-host/cloud; no-train **unverified** | Build-your-own-agent platform |
| **Notion + MCP** | ✓✓ | **Official hosted, R/W, cross-tool** | DB blocks → Markdown | (as above) | Cloud; no-train | **The benchmark.** Missing: memory semantics, provenance, local posture |
| **Obsidian + MCP** | ✓✓ | Community, R/W | Plain Markdown | (as above) | Local-first | Fragmented, unofficial, desktop-only, assembly-required |
| **Native (ChatGPT/Claude/Cursor/Windsurf/Codex)** | ✗ | **No cross-vendor access — hard silos** | KV facts / rules files | bundled | per-vendor | Zero interop; `AGENTS.md` shared only among coding tools |

---

## Part 2 — Structural patterns (not just the table)

**1. Capture / structure / synthesis — and almost nobody does all three.** Capture-first apps (Mem, Keep, Apple Notes) make input frictionless but can't produce output. Structure-first apps (Notion, Tana) are queryable but impose a filing tax. Synthesis-first apps (NotebookLM, Atlas) generate great output but are **source-bound and can't author or export** — you can't *live* in them. The few that span two axes (Notion = structure+capture; Heptabase = capture+synthesis) are weak on the third. **The triple is open.** Noto already spans capture (notes + lecture) and light structure (wiki-graph); synthesis is partially present (summarize/flashcards).

**2. "AI-native" is mostly marketing; real woven-in AI is rare.** Across ~25 apps, only **Mem** (ambient auto-organize) and the **meeting tools** (transcription *is* the product) genuinely weave AI into the core loop. Everyone else — Reflect, Apple, Keep, Notion (mostly), Craft, Capacities, Heptabase — ships **invoke-on-selection assistants**: rewrite/summarize/make-a-list in a panel. The "sidebar-widget problem" is the norm. And tellingly, **the one app that fully committed to AI-native auto-organize (Mem) is the category's trust cautionary tale** — proof that auto-organization without an audit trail erodes confidence.

**3. The seams where users run 2–3 tools in parallel — every one is an opening:**
- **fast-capture + meeting-notetaker + synthesis** (e.g., Apple Notes + Granola + NotebookLM): three silos, three search boxes, nothing links.
- **PKM vault + meeting notes**: *no meeting tool unifies with a knowledge base* — Granola/Otter/Fathom/Fireflies/Limitless all keep transcripts in their own cloud, links-free, separate from where you actually think. This is the most-cited structural complaint in meeting-tool reviews.
- **notes silo + AI-tool silo** *(the new and biggest seam)*: you work inside Claude Code / Cursor / ChatGPT all day, but your notes — and the AIs' own memories — live in separate boxes the other tools can't see.

**4. The 2026 inflection nobody has capitalized on yet.** MCP went from exotic to table stakes: Notion, Tana, Capacities, Craft, Roam, Evernote, and all five meeting tools now expose official MCP/connectors; Obsidian/Logseq/OneNote/Bear have mature community ones. **So "an AI tool can reach my notes" is solved. What is *not* solved** is making those notes behave like *memory* — shared across tools, written back automatically, deduped/decayed/ranked, and auditable. Everyone shipped the pipe; nobody shipped the memory.

---

## Part 3 — Ranked gaps (pain × poor-coverage)

**G1 — The cross-vendor AI-memory silo. (Pain: very high for the AI-heavy worker · Coverage: very poor.)** People live in Claude Code, Cursor, and ChatGPT; each keeps its own private memory; **none can read another's**, and you re-explain context every session. The only shared layer is the `AGENTS.md` file convention — coding-tools-only, manual, no recall semantics. *This is Noto's opening and the least-served high-pain gap in the entire landscape.*

**G2 — The note graveyard (retrieval by description). (Pain: universal/high · Coverage: partial.)** The honest test — *"find the note from six months ago by describing the topic, not the title"* — is failed by every folder/tag app (Apple Notes, Keep, OneNote, Evernote, Bear, Craft) and most link apps unless you maintained the links by hand. Semantic search exists in pockets (Mem, NotebookLM-within-sources, Noto's own Smart Search), but **retrieval still doesn't resurface the right note at the moment of need inside the tool where you're working.** The killer is proactive recall, not a better search box.

**G3 — The capture→meeting→synthesis seam. (Pain: high · Coverage: poor.)** Three tools, three silos; meeting notes never join the knowledge base. Noto already has lecture capture + notes + graph in one app — it's *structurally* positioned to close this, where pure meeting tools are not.

**G4 — Auto-organize distrust / the provenance gap. (Pain: high for those burned · Coverage: nil.)** Auto-filing misfiles and hallucinates (Mem's reputation); **no competitor shows provenance** ("which AI wrote this, when, from what, and can I revert it?"). The cost of distrusting your own system is that you stop using it.

**G5 — The synthesis gap. (Pain: med-high · Coverage: partial.)** Capture apps can't turn notes into a draft/output; NotebookLM can synthesize but is source-bound and can't author/export.

**G6 — Cold-start / critical mass. (Pain: medium · Coverage: poor.)** Linked-thought tools (Roam/Logseq/Obsidian) only pay off past ~100 interconnected notes. Most have no answer. *An AI-memory write-back loop is a novel answer:* memory accrues from your AI sessions automatically, so the vault is useful at 5 notes because the AI brings the context and the vault just persists it.

**G7 — Privacy / ownership. (Pain: medium; acute for a vocal minority · Coverage: split.)** Who trains on your notes; what happens when the vendor dies or hikes prices (Evernote). Local-first (Obsidian/Logseq/Pieces) owns this. **This is a Noto *weakness*, not a wedge** — Noto is cloud/hosted.

**Ranking:** G1 > G2 > G3 > G4 > G5 > G6 > G7. The top four all converge on the same product: **a trustworthy, shared, proactive memory.**

---

## Part 4 — Idea catalog (each tied to a gap + a goal + impact/effort)

Numbers match the impact-vs-effort plot. **Blue (1–6) = the high-impact / low-to-medium-effort cluster — and they are all facets of one thing: the AI shared-memory loop.**

### Save time
- **#6 Describe-don't-remember retrieval** — *Problem:* can't find old notes (G2). *How:* extend Noto's existing semantic Smart Search to "find where I worked out X." *Goal:* save time. **Impact H · Effort L–M** (mostly built; server-side semantic = Phase 4 of the MCP spec).
- **#2 Auto-surface past notes *inside the AI tool*** — *Problem:* relevant prior context never appears when you need it (G1+G2). *How:* MCP `recall`/`search_notes` injects the right prior decisions automatically when you start a task in Claude Code/Cursor. *Goal:* save time. **Impact V.High · Effort M** (needs the MCP layer — designed, not built).
- **#10 One-shot synthesis on demand** — *Problem:* can't get an output from what you know (G5). *How:* "summarize everything I know about X" across the vault. *Goal:* save time. **Impact M–H · Effort L** (summarize exists; add multi-note retrieval).

### Increase productivity
- **#3 Notes that write themselves back** — *Problem:* decisions made in AI tools evaporate (G1+G6). *How:* when you resolve a problem in Claude Code/Cursor, the decision + rationale lands in Noto's `Memory/` automatically. *Goal:* productivity. **Impact V.High · Effort M** (MCP write + steering; designed).
- **#4 Stop re-explaining (shared cross-tool memory)** — *Problem:* re-pasting context across tools (G1). *How:* what Cursor learned, Claude recalls — one shared store. *Goal:* productivity. **Impact V.High · Effort M.**
- **#8 Cluster-to-draft** — *Problem:* a cluster of notes won't become an artifact (G5). *How:* turn linked notes into a PRD/spec/post. *Goal:* productivity. **Impact M–H · Effort M.**
- **#12 Action/decision extraction** — *Problem:* lectures/meetings yield no structured output (G3+G5). *How:* transcript → decisions + action items into notes. *Goal:* productivity. **Impact M · Effort L–M** (lecture capture exists).
- **#11 Close capture→meeting→synthesis in one vault** — *Problem:* three tools (G3). *How:* add meeting-mode + cross-source synthesis to Noto's existing capture+graph. *Goal:* productivity. **Impact H · Effort H** (broad surface).

### Stay organized
- **#9 Emergent organization (AI maintains links)** — *Problem:* manual filing tax (G4+G6). *How:* AI proposes wiki-links/backlinks as you write; you don't file. *Goal:* organized. **Impact H · Effort M.**
- **#5 The trust / provenance layer** — *Problem:* you can't trust auto-organization (G4). *How:* every AI-written/organized note shows source-client + timestamp + pre-image, auditable & revertible. *Goal:* organized. **Impact H · Effort M** (audit table designed in spec). *This is the defensibility pillar.*
- **#7 Zero-decision capture** — *Problem:* capture costs too many decisions (G2+G4). *How:* drop a thought in one inbox; AI proposes folder/links/tags with a visible accept/reject provenance chip. *Goal:* organized. **Impact M–H · Effort M.**
- **#13 Queryable structure without Tana's setup cost** — *Problem:* structure is powerful but expensive to set up (structure-first complexity). *How:* lightweight properties the AI fills in, queried in natural language. *Goal:* organized. **Impact M · Effort M–H.**
- **#14 Gentle cold-start positioning** — *Problem:* tools useless until 100 notes (G6). *How:* lean on the write-back loop so memory accrues from AI sessions; useful at 5 notes. *Goal:* organized. **Impact M–H · Effort L** (positioning + #3).

### Non-obvious ideas that ONLY Noto's AI-memory position makes possible
*(These are the ones no capture/structure/synthesis competitor can copy without being wired into your AI workflow.)*
- **#1 Bidirectional memory = capture and recall are the same surface (flagship).** You write in Noto; the AI recalls from Noto; the AI writes back to Noto. One loop, not three tools. Notion has the pipe but no memory loop; Pieces/Limitless are read-only; mem0/Letta have no writing surface. **Impact V.High · Effort M.**
- **Provenance-filtered recall.** "Show me only what *I* decided, not what the AI inferred" / "what did Cursor write last week." Impossible without `source_client` tagging + audit (both designed). Folds into #5.
- **Memory hygiene as a visible product surface.** Dedup/decay/supersede with an auditable consolidation log — directly attacks Mem's misfile distrust. Folds into #5/#9.
- **Cross-tool decision log.** A living `Memory/Decisions.md` every AI tool appends to and reads — institutional memory the AIs maintain. Folds into #3.
- **Context handoff between tools.** Start in ChatGPT, continue in Claude Code — the decision thread persists because it lives in Noto, not in either silo. Folds into #4.

---

## Part 5 — Prioritization & the recommended wedge

The plot makes the cluster obvious: **#1–#6 sit in the high-impact / low-to-medium-effort corner, and they are all facets of one product — the AI shared-memory loop.** They also exploit the worst-served high-pain gaps (G1, G2, G4) and reuse Noto's real assets and the already-designed MCP spec. The heavier or lower-impact ideas (#7–#14) are good roadmap, not the wedge.

### Recommended wedge
> **"Noto is the app that remembers — the notes vault that doubles as the live, shared, auditable memory your Claude Code, Cursor, and ChatGPT read from and write back to, so you stop re-explaining context."**

Three things make it defensible beyond "we have an MCP," each attacking a specific competitor failure:
1. **Purpose-built memory semantics** (dedup, decay, scope, rank, supersede) — Notion's MCP is generic page CRUD with none of this.
2. **A provenance / trust layer** (auditable, revertible AI writes) — nobody has this; it directly attacks the Mem auto-organize distrust.
3. **The write-back loop as default behavior** — turns the vault into accruing memory with zero manual effort, softening cold-start; Pieces and Limitless are read-only, most others are manual-save.

### Why it beats the alternatives
- **vs. "best retrieval / graveyard-killer" (G2 only):** retrieval alone is copyable and partly served; the cross-vendor *memory loop* is the unfilled, highest-pain gap. Retrieval is a feature *of* the wedge, not the wedge.
- **vs. "capture+meeting+synthesis unifier" (G3):** a much bigger surface with more incumbents, and Noto would be *weaker* than Granola at meetings and NotebookLM at synthesis on their own axes. Less sharp.
- **vs. "local-first privacy vault" (G7):** Noto is **not** local-first — claiming this corner would be dishonest and architecturally false. Pieces/Obsidian own it.

### Most likely to copy it — and Noto's defensibility
- **Notion (highest risk):** already ships the official, hosted, read+write, cross-tool MCP, plus tens of millions of users. If it adds memory-hygiene UX and reframes the MCP as "your AI's shared memory," it closes the gap from strength. **Noto's defense:** be *purpose-built* (memory semantics + provenance are the whole thesis, not a side feature on a database app) and *faster/sharper*; Notion's MCP today is page CRUD with no memory model.
- **Obsidian (tier-2):** one official-MCP decision away from collapsing the community-bridge friction. **Noto's defense:** hosted + zero-setup + an actual memory model (Obsidian would still ship plain files, not deduped/decayed/provenanced memory).
- **Platform absorption (existential):** if Anthropic/OpenAI open native memory to a read-write cross-tool API, the third-party layer thins. As of June 2026 they pointedly have **not** — native memory is a hard silo — which is exactly the opening. **Speed matters.**

---

## Part 6 — Risks & honest failure modes (top ideas)

- **Steering is best-effort.** `CLAUDE.md` / `AGENTS.md` / `.mdc` only *encourage* the recall/remember loop; no client hard-enforces it. If the AIs don't reliably call `recall`/`remember`, the magic doesn't happen. (The companion spec acknowledges this.)
- **Cold-start still bites the wrong segment.** Write-back only accrues memory if the user is AI-heavy. For a light AI user, the vault stays empty and the wedge doesn't land. → The wedge is sharpest for **developers / AI power users first**.
- **Notion ships memory UX first** and eats the positioning with distribution. → Speed + a sharper, trust-led story.
- **Concurrency clobber.** Last-write-wins means an AI write can stomp a note open in a browser tab — directly erodes the trust the wedge is sold on. Mitigations are designed (`Memory/` confinement, section edits, `expectUpdatedAt`) but it's a sharp edge.
- **Privacy ceiling.** Cloud-only posture loses the privacy segment to Pieces/Obsidian and undercuts the "you own it / vendor can't die" promise (the Evernote fear). A local/self-host path would neutralize this — but it's a real architecture decision.
- **Token-efficiency must actually hold.** The whole ROI is "retrieve a slice instead of re-pasting everything" (spec models ~75% reduction). If retrieval isn't meaningfully leaner in practice, the core value evaporates.
- **The MCP layer is vapor until shipped.** Notion's is live today; Noto's is a spec. The wedge is unproven until Phase 0–1 of the companion doc exists.

---

## Part 7 — Open questions (for you to decide; Stage B will resolve scope one-at-a-time)

1. **Beachhead segment:** AI-heavy developers (Claude Code/Cursor) first — sharpest fit, smaller TAM — vs. knowledge workers (ChatGPT) — bigger TAM, softer fit? *(Lean: developers first.)*
2. **v1 ambition:** read-only **recall first** (prove token savings, lowest concurrency risk) vs. the full **read + write-back loop** (the magic, more risk)?
3. **Local-first stance:** stay hosted (Notion-like, accept the privacy ceiling) or add a local/self-host path to claim the empty privacy corner? *(Architecturally significant.)*
4. **Provenance/trust layer in v1 or later?** It's the defensibility, but it's added scope.
5. **MCP dependency:** the layer is designed, not built — is building Phase 0–1 the first plan, or is there an interim bridge?
6. **Meeting/lecture unification (#11):** in or out of the wedge's v1?
7. **First client:** companion-spec default is Claude Code — confirm?

---

## Sign-off gate

Stage A ends here. **No design or code until the wedge is approved.** On approval, Stage B invokes **superpowers:brainstorming** (loaded, not paraphrased; hard design-gate honored; one question at a time), seeded with this artifact, and hands off to **superpowers:writing-plans** for the implementation plan.
