// scripts/mint-pat.mjs
// Dev helper: mint a PAT for an existing user by email.
// Usage: npm run mint-pat -- <email> [read,write,destructive]
import { getUserByEmail, createPat } from "../server/db.ts";
import { generatePatToken, hashPatToken } from "../server/auth/pat.ts";

const [, , email, scopesArg = "read,write"] = process.argv;
if (!email) {
  console.error("Usage: node scripts/mint-pat.mjs <email> [read,write,destructive]");
  process.exit(1);
}
const user = getUserByEmail(email);
if (!user) {
  console.error(`No user with email ${email}. Sign up in the app first.`);
  process.exit(1);
}
const scopes = scopesArg.split(",").map((s) => s.trim()).filter(Boolean);
const VALID = ["read", "write", "destructive"];
const invalid = scopes.filter((s) => !VALID.includes(s));
if (invalid.length) { console.error(`Unknown scopes: ${invalid.join(", ")}`); process.exit(1); }
const token = generatePatToken();
createPat({ tokenHash: hashPatToken(token), userId: user.id, name: "cli", scopes });
console.log(token);
