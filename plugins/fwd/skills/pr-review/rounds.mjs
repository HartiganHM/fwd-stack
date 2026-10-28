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

// The copy-only bar (§9's single verification round), judged on every round with findings from the
// one that broke the clean streak onward. Judging only the last scored round made it unreachable
// once a clean round landed; judging only the breaker missed a successful round that still carried
// copy findings, a suppressed-only one.
export function copyOnly(scored, cleanStreak, isCopy, isDeclined) {
  const withFindings = scored
    .slice(-1 - cleanStreak)
    .filter((r) => r.count > 0);
  return (
    withFindings.length > 0 &&
    withFindings.every((r) =>
      r.paths.every((p) => isCopy(p) || isDeclined(p, r.n)),
    )
  );
}
