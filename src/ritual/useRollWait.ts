// Copy clock for the pull wait. Lives with the ritual host so leaving the page does not restart it.
// Timers run only while `rolling`; the last line stays through `stopping` and `dropping` so the hint does not jump empty.
import { useCallback, useEffect, useState } from 'react';
import type { Phase } from './reducer';
import { SLOW1_MS, SLOW2_MS, STUCK_MS, rollHint, type RollChoice } from './rollTiming';

const showing = (phase: Phase) => phase === 'rolling' || phase === 'stopping' || phase === 'dropping';

export function useRollWait(phase: Phase, count: number) {
  const [elapsed, setElapsed] = useState(0);
  const [choice, setChoice] = useState<RollChoice>(null);
  const [stuck, setStuck] = useState(false);
  const [seen, setSeen] = useState(phase);
  // A new roll, and anything outside the wait, starts the clock over. Adjusted while rendering so the hint
  // never shows the previous pull's line, and so the reset is not a setState inside an effect.
  if (phase !== seen) {
    setSeen(phase);
    if (phase === 'rolling' || !showing(phase)) {
      setElapsed(0);
      setChoice(null);
      setStuck(false);
    }
  }

  useEffect(() => {
    if (phase !== 'rolling') return;
    const timers = [
      setTimeout(() => setElapsed(SLOW1_MS), SLOW1_MS),
      setTimeout(() => setElapsed(SLOW2_MS), SLOW2_MS),
      setTimeout(() => setStuck(true), STUCK_MS),
    ];
    return () => { for (const t of timers) clearTimeout(t); };
  }, [phase]);

  const hint = showing(phase) ? rollHint(count, elapsed, choice, stuck) : { text: '', actions: false };
  const keep = useCallback(() => setChoice('keep'), []);
  const notify = useCallback(() => setChoice('notify'), []);
  return { text: hint.text, actions: phase === 'rolling' && hint.actions, keep, notify };
}
