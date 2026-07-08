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
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_URL = process.env.NOTO_APP_URL ?? "http://localhost:5173/app";
const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/readme/screenshots",
);
const VIEWPORT = { width: 1280, height: 800 };

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

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
