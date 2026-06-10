import { useEffect, useRef, useState } from "react";
import { useReveal } from "../useReveal";
import { Mail, ArrowRight, GoogleG } from "../icons";
import { authApi } from "../api";

type Mode = "signup" | "signin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EmailForm({
  email,
  setEmail,
  valid,
  onSubmit,
}: {
  email: string;
  setEmail: (v: string) => void;
  valid: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const reveal = useReveal();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <form className={"ob-emailform" + reveal} onSubmit={onSubmit}>
      <div className="ob-field">
        <Mail size={18} />
        <input
          ref={inputRef}
          type="email"
          placeholder="you@university.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <button type="submit" className="ob-btn ob-btn-blue ob-btn-sm" disabled={!valid}>
        Continue
        <ArrowRight size={17} />
      </button>
    </form>
  );
}

export function AccountScreen({
  mode,
  setMode,
  email,
  setEmail,
  onContinue,
  oauthError,
  googleEnabled,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  email: string;
  setEmail: (v: string) => void;
  onContinue: () => void;
  oauthError: string | null;
  googleEnabled: boolean;
}) {
  const reveal = useReveal();
  const [emailOpen, setEmailOpen] = useState(false);
  const valid = EMAIL_RE.test(email.trim());
  const signUp = mode === "signup";

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (valid) onContinue();
  }

  return (
    <div className={"ob-screen" + reveal}>
      <h1 className="ob-title">{signUp ? <>Welcome to <em>Noto</em></> : <>Welcome back</>}</h1>
      <p className="ob-sub">
        {signUp
          ? "Your notes, your disk. Create an account to sync settings across your Macs."
          : "Sign in to pick up your vault right where you left off."}
      </p>

      <div className="ob-panel">
        {oauthError && (
          <div className="ob-error" role="alert">
            We couldn't complete Google sign-in. Please try again.
          </div>
        )}

        {googleEnabled ? (
          <a className="ob-btn ob-btn-outline" href={authApi.googleLoginUrl}>
            <GoogleG className="ob-google-g" />
            Continue with Google
          </a>
        ) : (
          <button
            className="ob-btn ob-btn-outline"
            disabled
            title="Google sign-in isn't configured yet"
            style={{ opacity: 0.55, cursor: "not-allowed" }}
          >
            <GoogleG className="ob-google-g" />
            Continue with Google
          </button>
        )}

        <div className="ob-or">or</div>

        <button
          className="ob-btn ob-btn-ink"
          onClick={() => setEmailOpen(true)}
          disabled={emailOpen}
        >
          <Mail size={18} />
          Continue with email
        </button>

        {emailOpen && (
          <EmailForm email={email} setEmail={setEmail} valid={valid} onSubmit={submitEmail} />
        )}

        <p className="ob-foot">
          {signUp ? "Already have an account? " : "New to Noto? "}
          <button
            type="button"
            onClick={() => {
              setMode(signUp ? "signin" : "signup");
              setEmailOpen(false);
            }}
          >
            {signUp ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}
