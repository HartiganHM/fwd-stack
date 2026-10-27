// Round arithmetic the gate reads, kept out of pr-gate.mjs so a test can import it (the gate
// runs on import).

// A round's findings: every inline and suppressed comment, not the files they landed on. Four
// findings on one file are four findings — counting files once let a round of four read as one.
export const findingsIn = (round) =>
  Object.values(round.findings ?? {}).reduce((t, n) => t + n, 0);

// §8's diminishing returns, made reachable. An agent that obeys the gate could never invoke a
// clause only the gate could grant, so the gate computes it: four or more rounds, and the last
// three between them produced at most one finding.
export function diminishingReturns(scored, destructive) {
  const recent = scored.slice(-3);
  return {
    recent,
    total: recent.reduce((t, r) => t + findingsIn(r), 0),
    applies:
      scored.length >= 4 &&
      recent.length === 3 &&
      recent.reduce((t, r) => t + findingsIn(r), 0) <= 1 &&
      !destructive,
  };
}
