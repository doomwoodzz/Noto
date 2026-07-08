// Captures the 6 README screenshots (5 real views + 1 composited hero) by
// driving a real headless Chromium against the running dev server.
//
// Prerequisites:
//   - `npm run dev` running in another terminal (Vite :5173 + Express :8787)
//   - `npm run seed:demo-vault` already run at least once
//   - For the AI Assistant screenshot specifically: a real OPENAI_API_KEY in
//     landing/.env (see Task 6 below for the check)
//
// Usage: `npm run capture:readme`

import { chromium, type Page } from "playwright";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_URL = process.env.NOTO_APP_URL ?? "http://localhost:5173/app";
const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/readme/screenshots",
);
const VIEWPORT = { width: 1280, height: 800 };

// Long enough (3 top-level headings, >6000 chars) to trigger Dump's
// multi-note split (see splitIntoNotes in server/dump/split.ts).
const SYLLABUS = `# Week 5: Advanced Replication Patterns

This week we move past the basic quorum model and look at how production systems actually implement replication under real workloads. We'll cover multi-datacenter replication, read-your-writes consistency, and the operational tradeoffs teams make when the textbook answer isn't fast enough.

Multi-datacenter replication forces you to choose a topology: a single write region with async replicas elsewhere (simple, but cross-region reads are stale and a region failover loses recent writes), or multi-leader writes with conflict resolution (available everywhere, but you now own a merge function). Most systems we'll examine — Cassandra, DynamoDB global tables, Spanner — pick a point on this spectrum rather than a universal answer, and the choice usually tracks the product's actual latency budget rather than a principled stance on CAP.

Read-your-writes consistency is a narrower, more pragmatic guarantee than full linearizability: a client is guaranteed to see its own prior writes, even if it might see other clients' writes out of order. It's cheap to implement (route a client's reads to the replica that served its last write, or attach a version token to responses and refuse to serve a replica that hasn't caught up to it) and it eliminates the single most common user-facing consistency bug: submitting a form and not seeing your own change on the next page load.

We'll also discuss the operational reality that most outages in replicated systems aren't caused by the replication protocol being wrong — they're caused by replication lag turning an available-looking system into a slow one, or by a "read from any replica" load balancer serving stale data during a partial network partition that the protocol itself handles correctly but that operators didn't anticipate showing up as a customer-visible bug report.

Required reading: the Dynamo paper (DeCandia et al., 2007), sections 1-4. Optional: the Spanner paper if you want to see how far you can push synchronized clocks to avoid the conflict-resolution problem entirely.

# Week 6: Coordination Services in Practice

Rather than reimplementing consensus in every application that needs it, most production systems delegate coordination to a dedicated service — ZooKeeper, etcd, or Consul — and build their own logic on top of a small set of primitives that service exposes.

The core primitives are surprisingly uniform across all three: a hierarchical key-value store with strong consistency (backed by Raft or a Paxos variant internally), watches (a client can subscribe to changes on a key and get notified), and ephemeral/session-scoped keys (a key that disappears automatically if the client that created it disconnects, used for liveness detection). From just those three primitives you can build leader election (create an ephemeral sequential node, whoever has the lowest sequence number is leader), distributed locks (create an ephemeral node; if it already exists, you didn't get the lock), and service discovery (register an ephemeral node per living instance, watch the directory for the current set).

The interesting lecture material here isn't the algorithm — you already know how the underlying consensus works from earlier weeks — it's the API design question: why do these primitives, specifically, cover such a wide swath of coordination problems, and what's NOT expressible with them (arbitrary multi-key transactions, for instance, which is why some teams build more transactional systems for internal use cases that need them).

We'll walk through a real leader-election implementation against etcd in class, including the easy-to-miss failure mode: a client can win an election, get partitioned from the coordination service, and NOT immediately know it's no longer the leader — the ephemeral node expires and someone else wins, but the original leader keeps acting as leader until its next request to etcd fails. This is the fencing token problem, and the fix (attach a monotonically increasing token to every write, have downstream systems reject stale tokens) is worth understanding on its own, independent of which coordination service you use.

Required reading: the ZooKeeper paper (Hunt et al., 2010). Optional: Martin Kleppmann's "How to do distributed locking" post, which is largely a critique of getting the fencing token step wrong.

# Week 7: Testing Distributed Systems

Testing a distributed system is fundamentally different from testing a single-process program because the bugs you care about most only show up under partition, reordering, and partial failure — none of which your normal test runner will ever produce on its own.

Jepsen-style testing is the closest thing the field has to a standard methodology: run the real system under a real workload, inject network partitions and clock skew using tools like \`tc\`/\`iptables\` or a purpose-built fault injector, and check the resulting operation history against the consistency model the system claims to provide using a linearizability checker. Jepsen has found real, serious bugs in almost every well-known distributed database at some point — not because those systems are badly built, but because this class of bug is genuinely hard to find any other way.

Deterministic simulation testing (DST) is the other major approach, used by a handful of modern storage engines: run the entire system as a single-threaded simulation with a fake network and fake clock that the test harness controls completely, so you can explore an enormous space of interleavings and failure timings deterministically and reproduce any bug from a single seed. It's more work to build the harness up front, but once it exists you get orders of magnitude more coverage per CI run than you'd get from real-network integration tests, and every failure is exactly reproducible.

For the final project, you're not required to build a full Jepsen or DST harness, but you are required to write at least one test that deliberately introduces a partition or a crash mid-protocol and asserts on the resulting behavior — see the assignment doc for the exact rubric.`;

async function forceDarkThemeAndSkipOnboarding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("noto-onboarded", "1");
    window.localStorage.setItem("noto-theme", "dark");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.style.colorScheme = "dark";
  });
  // The authenticated app re-derives theme from the server-persisted
  // local-owner profile on every mount (AppRoot.tsx reads `user.theme` from
  // GET /api/auth/me and overwrites the DOM attribute + localStorage with
  // it), so localStorage alone flashes dark and then snaps back to light.
  // Rewrite the response in-browser rather than PATCHing the real dev
  // server's database, which would mutate shared state outside this
  // script's scope.
  await page.route("**/api/auth/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body?.user) body.user.theme = "dark";
    await route.fulfill({ response, json: body });
  });
}

/** Expand the "Lectures" sidebar folder if it isn't already open, then open
 *  the named note. Folders default to collapsed (see Sidebar.tsx). */
async function openLectureNote(page: Page, title: string): Promise<void> {
  const folder = page.locator(".nw-folder", { hasText: "Lectures" });
  const chevron = folder.locator(".nw-folder-chev");
  const isOpen = await chevron.evaluate((el) => el.classList.contains("is-open")).catch(() => false);
  if (!isOpen) await folder.click();
  await page.locator(".nw-file-row", { hasText: title }).first().click();
}

async function captureWorkspace(page: Page): Promise<void> {
  // "Consensus" has 7 incoming [[wiki-links]] and 4 outgoing ones in the seed
  // data — the richest note for showing both Backlinks and Outgoing links
  // in the context panel at once.
  await openLectureNote(page, "Consensus");
  await page.waitForSelector(".nw-context", { state: "visible" });
  await page.waitForTimeout(500); // let the context panel finish rendering backlinks
  await page.screenshot({ path: path.join(OUT_DIR, "02-workspace.png") });
}

async function captureDumpImport(page: Page): Promise<void> {
  const outPath = path.join(OUT_DIR, "06-dump-import.png");
  if (existsSync(outPath)) {
    // Dump's duplicate-detection means re-submitting the identical syllabus
    // on a second run leaves every manifest row disabled (nothing left to
    // commit) — this function only works once per vault. Skip it once we
    // already have the screenshot from an earlier run.
    console.log("06-dump-import.png already exists — skipping Dump import (not safely re-runnable)");
    return;
  }
  // Open the account menu, then "Dump into Noto…" (exact trailing ellipsis
  // character, not three periods — see Sidebar.tsx AccountFooter).
  await page.locator(".nw-account-btn").click();
  await page.getByText("Dump into Noto…", { exact: true }).click();

  await page.getByRole("button", { name: "Paste", exact: true }).click();
  await page
    .getByPlaceholder("Paste text or markdown to turn into atomic notes…")
    .fill(SYLLABUS);

  const [startResponse] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/dump") && res.request().method() === "POST"),
    page.getByRole("button", { name: "Start dump" }).click(),
  ]);
  const { jobId } = (await startResponse.json()) as { jobId: string };

  // Poll the job status directly (same origin the page is on, so the
  // browser context's session/CSRF cookies apply automatically) until the
  // review manifest is ready, rather than guessing at UI-state selectors.
  const jobUrl = new URL(`/api/dump/jobs/${jobId}`, page.url()).toString();
  let status = "queued";
  for (let i = 0; i < 40 && status !== "awaiting_review" && status !== "done"; i++) {
    await page.waitForTimeout(500);
    const jobRes = await page.request.get(jobUrl);
    const job = (await jobRes.json()) as { status: string };
    status = job.status;
  }
  if (status !== "awaiting_review") {
    throw new Error(`Dump job never reached awaiting_review (last status: ${status})`);
  }
  await page.waitForTimeout(1000); // let the UI's own poll pick up the status change
  await page.waitForSelector(".nw-dump-manifest", { state: "visible" });
  await page.screenshot({ path: path.join(OUT_DIR, "06-dump-import.png") });

  // Rows default to whatever the server marked `defaultSelected`, which should
  // be everything for this clean, non-redacted syllabus — but check explicitly
  // rather than assume, so the commit button is never left disabled at 0
  // selected.
  const checkboxes = page.locator(".nw-dump-row:not(.is-disabled) input[type=\"checkbox\"]");
  const count = await checkboxes.count();
  for (let i = 0; i < count; i++) {
    const box = checkboxes.nth(i);
    if (!(await box.isChecked())) await box.check();
  }

  await page.getByRole("button", { name: /^Create \d+ notes?$/ }).click();
  await page.waitForSelector(".nw-dump-manifest", { state: "hidden", timeout: 20_000 });
}

async function captureKnowledgeWeb(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Knowledge Web" }).click();
  // Canvas force-directed layout — no DOM "loaded" signal to await; a fixed
  // settle time is the pragmatic choice here.
  await page.waitForTimeout(3000);

  // The graph's camera starts at a hardcoded low zoom (cam.s = 0.6, see
  // webEngine.ts) with no auto-fit-to-content and no fit/reset button in the
  // UI — at this vault's node count the unzoomed graph is a tiny, illegible
  // blob. Zoom in by simulating a wheel scroll centered on the node cluster,
  // the same interaction a real user would use (it's the only zoom
  // mechanism the UI exposes). The engine's wheel handler computes
  // `newScale = cam.s * exp(-deltaY * 0.0014)` (webEngine.ts's onWheel), so
  // deltaY is chosen to land near a legible ~2x-2.5x scale from the 0.6
  // starting point.
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (box) {
    // Empirically (confirmed via a pre-zoom screenshot), the dense Lectures
    // cluster for this vault renders left-of-center and slightly below
    // vertical center of the canvas at the default camera position — adjust
    // these fractions if your screenshot shows the zoom centered on empty
    // space instead of the node cluster.
    const zoomX = box.x + box.width * 0.32;
    const zoomY = box.y + box.height * 0.57;
    await page.mouse.move(zoomX, zoomY);
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(500);
  }

  await page.screenshot({ path: path.join(OUT_DIR, "03-knowledge-web.png") });
}

async function captureAIAssistant(page: Page): Promise<void> {
  await openLectureNote(page, "Consensus");
  await page.locator(".nw-ask-ai").click();

  const [summarizeResponse] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/ai/summarize") && res.request().method() === "POST",
      { timeout: 30_000 },
    ),
    page.getByRole("button", { name: "Summarize note" }).click(),
  ]);
  if (!summarizeResponse.ok()) {
    throw new Error(
      `POST /api/ai/summarize -> ${summarizeResponse.status()}: ${await summarizeResponse.text()}. ` +
        "Is OPENAI_API_KEY set in landing/.env and is the dev server using it?",
    );
  }
  await page.waitForTimeout(500); // let the reply finish rendering into the panel
  await page.screenshot({ path: path.join(OUT_DIR, "04-ai-assistant.png") });
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await forceDarkThemeAndSkipOnboarding(page);

  await page.goto(APP_URL);
  await page.waitForSelector(".nw-sidebar", { state: "visible", timeout: 15_000 });

  await captureWorkspace(page);
  console.log("captured: 02-workspace.png");

  await captureDumpImport(page);
  console.log("captured: 06-dump-import.png");

  await captureKnowledgeWeb(page);
  console.log("captured: 03-knowledge-web.png");

  await captureAIAssistant(page);
  console.log("captured: 04-ai-assistant.png");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
