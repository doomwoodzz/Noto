import { useEffect, useState } from "react";
import { api, type PublicUser } from "./api";
import { NotoWorkspace } from "./NotoWorkspace";
import { AppLoading } from "./AppStatus";
import type { Theme } from "../landing/useTheme";

const ONBOARDED_KEY = "noto-onboarded";
const FIRST_RUN_DEST = "/get-started";

/**
 * Loads the local owner's profile + theme on mount, then renders the
 * workspace. There is no login: the server auto-provisions the local
 * owner's session on the very first request (see
 * server/auth/localSession.ts), so `/api/auth/me` always resolves.
 * First-ever launch is instead detected client-side and sent through a
 * short first-run tour once.
 */
export function AppRoot() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARDED_KEY)) {
        window.location.href = FIRST_RUN_DEST;
        return;
      }
    } catch {
      /* localStorage unavailable — skip the first-run tour, don't block the app */
    }

    let cancelled = false;
    api
      .me()
      .then(({ user }) => {
        if (cancelled || !user) return;
        const t: Theme = user.theme === "dark" ? "dark" : "light";
        applyTheme(t);
        setTheme(t);
        setUser(user);
        setReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function applyTheme(t: Theme) {
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t;
    try {
      localStorage.setItem("noto-theme", t);
    } catch {
      /* ignore */
    }
  }

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    api.savePreferences(next).catch(() => {});
  }

  if (!ready || !user) {
    return <AppLoading message="Loading Noto…" />;
  }

  return <NotoWorkspace user={user} theme={theme} onToggleTheme={toggleTheme} />;
}
