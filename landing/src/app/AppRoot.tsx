import { useEffect, useState } from "react";
import { api, type PublicUser } from "./api";
import { NotoWorkspace } from "./NotoWorkspace";
import { AppLoading } from "./AppStatus";
import type { Theme } from "../landing/useTheme";

const SIGN_IN_DEST = "/get-started";

/**
 * Auth gate for the app. Resolves the session via /api/auth/me; anonymous
 * visitors are bounced to the sign-in flow. (The notes API is independently
 * session-protected server-side — this is the UX half of defense in depth.)
 */
export function AppRoot() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(({ user }) => {
        if (cancelled) return;
        if (!user) {
          window.location.href = SIGN_IN_DEST;
          return;
        }
        const t: Theme = user.theme === "dark" ? "dark" : "light";
        applyTheme(t);
        setTheme(t);
        setUser(user);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) window.location.href = SIGN_IN_DEST;
      });
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

  function logout() {
    api.logout().finally(() => {
      window.location.href = SIGN_IN_DEST;
    });
  }

  if (!ready || !user) {
    return <AppLoading message="Loading Noto…" />;
  }

  return <NotoWorkspace user={user} theme={theme} onToggleTheme={toggleTheme} onLogout={logout} />;
}
