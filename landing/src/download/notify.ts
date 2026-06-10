// Email reminder sign-up.
//
// The UI is fully wired: validation, pending/success/error states, and this
// single submission entry point. The actual email backend is NOT set up yet —
// when it is, replace the stubbed body of `submitReminder` with a real request
// (e.g. POST to /api/notify or your ESP) and keep the same return contract.

export interface ReminderResult {
  ok: boolean;
  error?: string;
}

// Reasonable email shape check — deliberately permissive.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/**
 * Register an email for the "notify me on release" reminder.
 *
 * STUB: no email service is connected yet. This validates the address and
 * resolves successfully so the UI is ready to demo. Swap the marked section
 * for a real network call once the backend exists.
 */
export async function submitReminder(email: string): Promise<ReminderResult> {
  const trimmed = email.trim();
  if (!isValidEmail(trimmed)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  // --- BACKEND NOT SET UP -------------------------------------------------
  // Replace this block with the real call, e.g.:
  //
  //   const res = await fetch("/api/notify", {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ email: trimmed }),
  //   });
  //   if (!res.ok) return { ok: false, error: "Something went wrong. Try again." };
  //
  // For now, simulate a short round-trip so the pending state is visible.
  await new Promise((resolve) => setTimeout(resolve, 600));
  // ------------------------------------------------------------------------

  return { ok: true };
}
