import { useEffect, useRef, useState } from "react";
import { useReveal } from "../useReveal";
import { Lock, Eye, EyeOff, Check, ArrowRight, ArrowLeft } from "../icons";

type Mode = "signup" | "signin";

export function PasswordScreen({
  mode,
  email,
  onBack,
  submit,
}: {
  mode: Mode;
  email: string;
  onBack: () => void;
  /** Performs the actual auth call; resolves to an error message or null on success. */
  submit: (password: string) => Promise<string | null>;
}) {
  const reveal = useReveal();
  const signUp = mode === "signup";
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [agree, setAgree] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => pwRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  const longEnough = pw.length >= 8;
  const match = confirm.length > 0 && pw === confirm;
  const mismatch = confirm.length > 0 && pw !== confirm;
  const valid = signUp ? longEnough && match && agree : pw.length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setServerError(null);
    if (!valid || busy) return;
    setBusy(true);
    const err = await submit(pw);
    if (err) {
      setServerError(err);
      setBusy(false);
    }
    // On success the parent advances/redirects; keep busy state to avoid flicker.
  }

  return (
    <div className={"ob-screen" + reveal}>
      <h1 className="ob-title">{signUp ? "Secure your account" : "Enter your password"}</h1>
      <p className="ob-sub">
        {signUp
          ? "Choose a password. This protects your synced settings — your notes always stay local on disk."
          : <>Signing in as <strong style={{ color: "var(--page-ink)" }}>{email}</strong>.</>}
      </p>

      <form className="ob-panel" onSubmit={onSubmit}>
        <button type="button" className="ob-back" onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </button>

        {serverError && <div className="ob-error" role="alert">{serverError}</div>}

        <div className="ob-field">
          <Lock size={18} />
          <input
            ref={pwRef}
            type={show ? "text" : "password"}
            placeholder={signUp ? "Create a password" : "Your password"}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete={signUp ? "new-password" : "current-password"}
          />
          <button
            type="button"
            className="ob-field-btn"
            onClick={() => setShow((s) => !s)}
            aria-label="Toggle password visibility"
          >
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>

        {signUp && (
          <div className="ob-field">
            <Lock size={18} />
            <input
              type={show ? "text" : "password"}
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
            {match && (
              <span style={{ color: "var(--page-blue)", display: "inline-flex" }}>
                <Check size={18} />
              </span>
            )}
          </div>
        )}

        {signUp && mismatch && <div className="ob-field-error">Passwords don't match yet.</div>}
        {signUp && !mismatch && pw.length > 0 && !longEnough && (
          <div className="ob-hint-row"><Lock size={14} /> Use at least 8 characters.</div>
        )}

        {signUp && (
          <label className="ob-check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span className="ob-check-box"><Check size={14} strokeWidth={2.6} /></span>
            <span className="ob-check-label">
              I agree to Noto's{" "}
              <a href="#" onClick={(e) => e.preventDefault()}>Privacy Policy</a> and{" "}
              <a href="#" onClick={(e) => e.preventDefault()}>Terms of Service</a>.
            </span>
          </label>
        )}

        {signUp && touched && !agree && (
          <div className="ob-field-error">Please accept the Privacy Policy and Terms to continue.</div>
        )}

        <button
          type="submit"
          className="ob-btn ob-btn-blue"
          disabled={!valid || busy}
          style={{ marginTop: 4 }}
        >
          {busy ? "Please wait…" : signUp ? "Create account" : "Sign in"}
          {!busy && <ArrowRight size={17} />}
        </button>
      </form>
    </div>
  );
}
