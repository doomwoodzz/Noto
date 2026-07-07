// scripts/mint-pat.mjs
// Dev helper: mints a PAT for the local owner (Noto has no accounts — a single
// local owner is auto-provisioned on first boot).
// Usage: npm run mint-pat -- [read,write,destructive]
import { ensureLocalOwner, createPat } from "../server/db.ts";
import { generatePatToken, hashPatToken } from "../server/auth/pat.ts";

const [, , scopesArg = "read,write"] = process.argv;
const user = ensureLocalOwner();
const scopes = scopesArg.split(",").map((s) => s.trim()).filter(Boolean);
const VALID = ["read", "write", "destructive"];
const invalid = scopes.filter((s) => !VALID.includes(s));
if (invalid.length) { console.error(`Unknown scopes: ${invalid.join(", ")}`); process.exit(1); }
const token = generatePatToken();
createPat({ tokenHash: hashPatToken(token), userId: user.id, name: "cli", scopes });
console.log(token);
