import { useEffect, useRef, useState } from "react";

/**
 * Drives the kiosk's "finished? scan before this resets" countdown.
 * Call `arm(seconds)` when a result is shown; any pointer/key activity
 * resets the countdown. When it hits zero, `onReset` fires once.
 */
export function useInactivityReset(onReset: () => void) {
  const [active, setActive] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const totalRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  function clear() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function arm(totalSeconds: number) {
    totalRef.current = totalSeconds;
    setSecondsLeft(totalSeconds);
    setActive(true);
  }

  function disarm() {
    setActive(false);
    clear();
  }

  useEffect(() => {
    if (!active) return;
    clear();
    timerRef.current = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clear();
          setActive(false);
          onReset();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const bump = () => setSecondsLeft(totalRef.current);
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, bump));
    return () => events.forEach((e) => window.removeEventListener(e, bump));
  }, [active]);

  return { active, secondsLeft, arm, disarm };
}
