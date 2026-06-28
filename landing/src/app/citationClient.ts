// The real, server-backed citation client used by the authenticated app.
// Mirrors `realAIClient`: thin adapters over the `api.links.*` endpoints, which
// proxy the outbound link fetches through the server (CSP forbids the browser
// from reaching third-party origins directly).

import { api } from "./api";
import type { CitationClient } from "../workspace/citationClient";

export const realCitationClient: CitationClient = {
  simulated: false,
  metadata: (url) => api.links.metadata(url),
  image: (url) => api.links.image(url).then((r) => r.dataUrl),
};
