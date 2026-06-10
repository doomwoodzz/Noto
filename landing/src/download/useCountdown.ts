import { useCallback, useEffect, useState } from "react";

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
}

/** Live countdown to a target date, ticking once a second. */
export function useCountdown(target: Date): Countdown {
  const calc = useCallback((): Countdown => {
    const diff = Math.max(0, target.getTime() - Date.now());
    const totalSeconds = Math.floor(diff / 1000);
    return {
      days: Math.floor(totalSeconds / 86400),
      hours: Math.floor((totalSeconds % 86400) / 3600),
      minutes: Math.floor((totalSeconds % 3600) / 60),
      seconds: totalSeconds % 60,
      done: diff === 0,
    };
  }, [target]);

  const [t, setT] = useState<Countdown>(calc);
  useEffect(() => {
    const id = setInterval(() => setT(calc()), 1000);
    return () => clearInterval(id);
  }, [calc]);
  return t;
}

export const pad = (n: number) => String(n).padStart(2, "0");
