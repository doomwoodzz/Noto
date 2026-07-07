/**
 * Noto server entrypoint. Builds the app (see app.ts) and binds the port.
 */
import { env } from "./env.ts";
import { createApp } from "./app.ts";
import { warm } from "./search/embedder.ts";
import { backfillEmbeddings } from "./search/semantic.ts";
import { rebuildStaleVaultGraphs } from "./graph/build.ts";
import { startDumpWorker } from "./dump/jobs.ts";

const app = createApp();

const HOST = "127.0.0.1";
app.listen(env.PORT, HOST, () => {
  console.log(`▶ Noto server on http://${HOST}:${env.PORT} (${env.NODE_ENV})`);
  warm();
  startDumpWorker();
  void (async () => {
    try { await backfillEmbeddings(); } catch { /* best-effort; never crash boot */ }
    try { await rebuildStaleVaultGraphs(); } catch { /* best-effort; never crash boot */ }
  })();
});
