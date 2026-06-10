import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drives a smooth, frame-based "typing" reveal of a string.
 *
 * `run(full)` starts streaming `full` one slice at a time at ~`cps`
 * characters per second; the returned `text` grows until complete, then
 * `done` flips true. `reset()` clears everything. Timing is wall-clock
 * based (not per-frame) so the speed stays stable regardless of frame rate.
 */
export function useTypewriter(cps = 46) {
  const [text, setText] = useState("");
  const [done, setDone] = useState(true);
  const rafRef = useRef<ReturnType<typeof setInterval> | number>(0);
  const doneRef = useRef<(() => void) | undefined>(undefined);

  const stop = useCallback(() => {
    if (rafRef.current) clearInterval(rafRef.current);
  }, []);

  const run = useCallback((full: string, onDone?: () => void) => {
    stop();
    doneRef.current = onDone;
    setDone(false);
    setText("");
    const start = performance.now();
    // Wall-clock driven: progress is derived from elapsed time, so the speed
    // stays stable regardless of frame rate, and (unlike rAF) it keeps
    // advancing even if the tab is briefly backgrounded.
    rafRef.current = window.setInterval(() => {
      const n = Math.min(full.length, Math.floor(((performance.now() - start) / 1000) * cps));
      setText(full.slice(0, n));
      if (n >= full.length) {
        clearInterval(rafRef.current);
        setDone(true);
        doneRef.current?.();
      }
    }, 1000 / 60);
  }, [cps, stop]);

  const reset = useCallback(() => {
    stop();
    setText("");
    setDone(true);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { text, done, run, reset };
}
