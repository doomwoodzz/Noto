/**
 * Auth API routes. All inputs are validated with zod; all responses are JSON.
 * Login failures are deliberately generic and timing-equalised to avoid leaking
 * whether an email is registered.
 */
import express, { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import crypto from "node:crypto";
import {
  getUserByEmail,
  createUser,
  setUserTheme,
  toPublicUser,
} from "../db.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { createSession, destroySession, getCurrentUser } from "./session.ts";
import { ensureCsrfCookie } from "./csrf.ts";
import { startGoogleLogin, handleGoogleCallback } from "./google.ts";

export const authRouter = Router();

// Auth payloads are tiny (email + password); a small cap blunts memory abuse.
authRouter.use(express.json({ limit: "16kb" }));

/* ----------------------------- validation ----------------------------- */
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(8, "Use at least 8 characters").max(200);

const credentials = z.object({ email: emailSchema, password: passwordSchema });

// A real hash (over a random throwaway secret) so failed logins do the same
// scrypt work as successful ones — prevents timing-based user enumeration.
const DUMMY_HASH = await hashPassword(crypto.randomBytes(32).toString("hex"));

/* ------------------------------ rate limits ---------------------------- */
// Strict limiter on credential endpoints to blunt brute-force / credential
// stuffing. Counts only failed attempts where possible.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
  // Skip rate limiting in the test environment so integration tests can spin up
  // more than 10 unique accounts per test run without hitting the 15-min cap.
  skip: () => process.env.NODE_ENV === "test",
});

/* -------------------------------- routes ------------------------------- */

authRouter.post("/signup", authLimiter, async (req: Request, res: Response) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please enter a valid email and an 8+ character password." });
    return;
  }
  const { email, password } = parsed.data;

  if (getUserByEmail(email)) {
    // Signup must tell the user the address is taken to be usable; rate limiting
    // above bounds how fast this can be abused for enumeration.
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = createUser({ email, passwordHash });
  createSession(req, res, user.id);
  ensureCsrfCookie(req, res);
  res.status(201).json({ user: toPublicUser(user) });
});

authRouter.post("/login", authLimiter, async (req: Request, res: Response) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email or password." });
    return;
  }
  const { email, password } = parsed.data;

  const user = getUserByEmail(email);
  // Always run a verification to equalise timing whether or not the user exists
  // or has a password set (OAuth-only accounts have a null hash).
  const hash = user?.password_hash ?? DUMMY_HASH;
  const ok = await verifyPassword(password, hash);

  if (!user || !user.password_hash || !ok) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  createSession(req, res, user.id); // fresh session id → fixation defence
  ensureCsrfCookie(req, res);
  res.json({ user: toPublicUser(user) });
});

authRouter.post("/logout", (req: Request, res: Response) => {
  destroySession(req, res);
  res.status(204).end();
});

authRouter.get("/me", (req: Request, res: Response) => {
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({ user: null });
    return;
  }
  res.json({ user: toPublicUser(user) });
});

const prefsSchema = z.object({ theme: z.enum(["light", "dark"]) });

authRouter.patch("/preferences", (req: Request, res: Response) => {
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid preferences" });
    return;
  }
  setUserTheme(user.id, parsed.data.theme);
  res.json({ ok: true });
});

/* ------------------------------ Google OAuth --------------------------- */
authRouter.get("/google", authLimiter, startGoogleLogin);
authRouter.get("/google/callback", handleGoogleCallback);
