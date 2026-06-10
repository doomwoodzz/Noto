/**
 * Noto server entrypoint. Builds the app (see app.ts) and binds the port.
 */
import { env } from "./env.ts";
import { createApp } from "./app.ts";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`▶ Noto server on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  if (!env.googleConfigured) {
    console.log("  Google OAuth: not configured (set GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI to enable).");
  }
});
