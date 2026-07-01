import { useEffect, useState } from "react";
import { useTheme } from "../landing/useTheme";
import { authApi, ApiError } from "./api";
import { BrandMark } from "./icons";
import { AccountScreen } from "./screens/AccountScreen";
import { PasswordScreen } from "./screens/PasswordScreen";
import { ThemeScreen } from "./screens/ThemeScreen";
import { CommandTutorial } from "./screens/CommandTutorial";
import { AllSetScreen } from "./screens/AllSetScreen";

type Mode = "signup" | "signin";
const STEPS = ["account", "password", "theme", "command", "done"] as const;
type Step = (typeof STEPS)[number];

// Where users land once authentication is complete: the real Noto workspace
// (served by app.html). The workspace re-checks the session and the notes API
// is independently session-protected.
const POST_AUTH_DEST = "/app";

export function Onboarding() {
  const [stepIdx, setStepIdx] = useState(0);
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [theme, setTheme] = useTheme();
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(true);
  const [ready, setReady] = useState(false);

  // On load: honour an OAuth return (?step / ?error) and adopt any saved theme.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stepParam = params.get("step");
    const errorParam = params.get("error");
    const modeParam = params.get("mode");
    if (errorParam) setOauthError(errorParam);
    if (modeParam === "signin" || modeParam === "signup") setMode(modeParam);

    let cancelled = false;
    // Reflect whether Google OAuth is configured so we don't dead-end users on
    // an unconfigured button.
    authApi.health().then((h) => { if (!cancelled) setGoogleEnabled(h.googleConfigured); }).catch(() => {});
    authApi
      .me()
      .then(({ user }) => {
        if (cancelled) return;
        if (user) {
          if (user.theme === "light" || user.theme === "dark") setTheme(user.theme);
          // Authenticated via OAuth → drop the user into the post-account flow.
          const target = (stepParam as Step) ?? "theme";
          const idx = STEPS.indexOf(target);
          setStepIdx(idx >= 0 ? idx : STEPS.indexOf("theme"));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setReady(true);
          // Clean the URL so a refresh doesn't re-trigger the OAuth branch.
          if (stepParam || errorParam || modeParam) {
            window.history.replaceState({}, "", window.location.pathname);
          }
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = STEPS[stepIdx];
  const goNext = () => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
  const goBack = () => setStepIdx((i) => Math.max(0, i - 1));
  const goto = (i: number) => { if (i <= stepIdx) setStepIdx(i); };

  function redirectToApp() {
    window.location.href = POST_AUTH_DEST;
  }

  // Account → password (email captured). For sign-in, password screen logs in
  // and we redirect; for sign-up it advances through the rest of the flow.
  function handleEmailContinue() {
    setOauthError(null);
    setStepIdx(STEPS.indexOf("password"));
  }

  async function handlePasswordSubmit(password: string): Promise<string | null> {
    try {
      if (mode === "signup") {
        await authApi.signup(email, password);
        setStepIdx(STEPS.indexOf("theme"));
        return null;
      } else {
        await authApi.login(email, password);
        redirectToApp();
        return null;
      }
    } catch (err) {
      if (err instanceof ApiError) return err.message;
      return "Network error. Please check your connection and try again.";
    }
  }

  // Skip sign-in entirely: spin up a guest session, then drop straight into the
  // workspace. Returns an error string for the screen to surface on failure.
  async function handleGuest(): Promise<string | null> {
    try {
      await authApi.guest();
      redirectToApp();
      return null;
    } catch (err) {
      if (err instanceof ApiError) return err.message;
      return "Network error. Please check your connection and try again.";
    }
  }

  async function handleThemeContinue() {
    // Persist the choice server-side (best-effort — the local theme already applied).
    authApi.savePreferences(theme).catch(() => {});
    goNext();
  }

  const showSkip = step === "theme" || step === "command";

  return (
    <div className="ob-root" style={{ visibility: ready ? "visible" : "hidden" }}>
      <header className="ob-top">
        <div className="ob-brand">
          <span className="ob-brand-mark"><BrandMark /></span>
          NOTO
        </div>
        {showSkip && (
          <button className="ob-skip" onClick={() => setStepIdx(STEPS.indexOf("done"))}>
            Skip for now
          </button>
        )}
      </header>

      <main className="ob-stage">
        {step === "account" && (
          <AccountScreen
            key="account"
            mode={mode}
            setMode={setMode}
            email={email}
            setEmail={setEmail}
            onContinue={handleEmailContinue}
            oauthError={oauthError}
            googleEnabled={googleEnabled}
            onSkip={handleGuest}
          />
        )}
        {step === "password" && (
          <PasswordScreen
            key="password"
            mode={mode}
            email={email}
            onBack={goBack}
            submit={handlePasswordSubmit}
          />
        )}
        {step === "theme" && (
          <ThemeScreen
            key="theme"
            theme={theme}
            setTheme={setTheme}
            onNext={handleThemeContinue}
            onBack={goBack}
          />
        )}
        {step === "command" && (
          <CommandTutorial key="command" onNext={goNext} onBack={goBack} />
        )}
        {step === "done" && (
          <AllSetScreen key="done" onOpen={redirectToApp} onBack={goBack} />
        )}
      </main>

      <div className="ob-dots">
        {STEPS.map((s, i) => (
          <button
            key={s}
            className={"ob-dot" + (i === stepIdx ? " is-active" : i < stepIdx ? " is-done" : "")}
            onClick={() => goto(i)}
            aria-label={"Step " + (i + 1)}
          />
        ))}
      </div>
    </div>
  );
}
