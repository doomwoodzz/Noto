import { useState } from "react";
import { Bell, Check } from "lucide-react";
import { submitReminder } from "./notify";

type Status = "idle" | "pending" | "done" | "error";

/** Email reminder form for the release. Fully functional client-side;
 *  the actual send is stubbed in `submitReminder` until the backend exists. */
export function NotifyForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "pending") return;
    setStatus("pending");
    setError(null);
    const result = await submitReminder(email);
    if (result.ok) {
      setStatus("done");
    } else {
      setStatus("error");
      setError(result.error ?? "Something went wrong. Try again.");
    }
  }

  if (status === "done") {
    return (
      <div className="cs-notify cs-notify-done" role="status">
        <span className="cs-notify-done-icon"><Check size={14} strokeWidth={2.4} /></span>
        <span>You're on the list — we'll email you on June 20.</span>
      </div>
    );
  }

  return (
    <form className="cs-notify" onSubmit={onSubmit} noValidate>
      <div className="cs-notify-field">
        <input
          className="cs-notify-input"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@university.edu"
          aria-label="Email"
          aria-invalid={status === "error"}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === "error") {
              setStatus("idle");
              setError(null);
            }
          }}
        />
        {error && <span className="cs-notify-error" role="alert">{error}</span>}
      </div>
      <button className="l-btn l-btn-primary" type="submit" disabled={status === "pending"}>
        <Bell size={14} strokeWidth={1.7} />
        {status === "pending" ? "Adding…" : "Notify me"}
      </button>
    </form>
  );
}
