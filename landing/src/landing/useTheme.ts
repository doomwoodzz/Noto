import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof localStorage === "undefined") return "light";
    const stored = localStorage.getItem("noto-theme");
    return stored === "dark" ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("noto-theme", theme); } catch { /* ignore */ }
  }, [theme]);
  return [theme, setTheme];
}
