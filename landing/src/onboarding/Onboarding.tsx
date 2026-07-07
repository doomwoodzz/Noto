import { useEffect, useState } from "react";
import { useTheme } from "../landing/useTheme";
import { authApi } from "./api";
import { BrandMark } from "./icons";
import { ThemeScreen } from "./screens/ThemeScreen";
import { CommandTutorial } from "./screens/CommandTutorial";
import { AllSetScreen } from "./screens/AllSetScreen";

const STEPS = ["theme", "command", "done"] as const;

const ONBOARDED_KEY = "noto-onboarded";
// Where the tour sends you once it's done: the real Noto workspace.
const POST_TOUR_DEST = "/app";

/**
 * First-run tour, shown once per install (see AppRoot's ONBOARDED_KEY check).
 * There are no accounts to create — this is purely a short welcome/orientation
 * flow: pick a theme, see the command-palette tutorial, then open the app.
 */
export function Onboarding() {
  const [stepIdx, setStepIdx] = useState(0);
  const [theme, setTheme] = useTheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then(({ user }) => {
        if (cancelled || !user) return;
        if (user.theme === "light" || user.theme === "dark") setTheme(user.theme);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
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

  function finishTour() {
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      /* ignore — worst case the tour shows again next launch */
    }
    window.location.href = POST_TOUR_DEST;
  }

  async function handleThemeContinue() {
    authApi.savePreferences(theme).catch(() => {});
    goNext();
  }

  return (
    <div className="ob-root" style={{ visibility: ready ? "visible" : "hidden" }}>
      <header className="ob-top">
        <div className="ob-brand">
          <span className="ob-brand-mark"><BrandMark /></span>
          NOTO
        </div>
        <button className="ob-skip" onClick={finishTour}>
          Skip for now
        </button>
      </header>

      <main className="ob-stage">
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
          <AllSetScreen key="done" onOpen={finishTour} onBack={goBack} />
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
