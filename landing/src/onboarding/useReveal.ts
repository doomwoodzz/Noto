import { useEffect, useState } from "react";

/**
 * Reveal-on-mount flag driven by a double rAF so the initial styles paint
 * before the transition starts (capture-safe — never restarts on reflow).
 * Returns the " is-in" class suffix once revealed.
 */
export function useReveal(): string {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setOn(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);
  return on ? " is-in" : "";
}
