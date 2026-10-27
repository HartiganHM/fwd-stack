// Which rounds reviewed a head that had already moved when the review was submitted.
//
// §3 says a stale review is discarded unread and counts for nothing. The gate used to check only the LAST
// round against the current head, so a stale round that was followed by a fresh one was scored like any other.
// On one PR round 5 was requested, the author then force-pushed (19:01:09Z), and round 5 landed at
// 19:04:17Z on the previous head. It raised nothing inline, so it was scored clean, and with a clean round 6
// it made a two-round streak the PR had not earned: only one round had read the code being merged.
//
// A push is { sha, at }: the head sha and when it reached the remote (a force push's own event time, else the
// first check suite GitHub made for that sha, which is created on push). Times are ISO strings in UTC, so they
// compare as strings.

/** The head the remote held at `t`: the latest push at or before it, or null when none is known. */
export function headAt(pushes, t) {
  let best = null;
  for (const p of pushes)
    if (p.at && p.at <= t && (!best || p.at > best.at)) best = p;
  return best?.sha ?? null;
}

/**
 * Marks each round `staleAtSubmit` when its own sha has a known push time and a DIFFERENT sha was pushed after
 * it and before the review was submitted. A round whose sha has no known push time is never marked: an unknown
 * is not evidence, and marking it would discount a real round.
 */
export function markStaleRounds(rounds, pushes) {
  const pushedAt = new Map();
  for (const p of pushes)
    if (p.at && (!pushedAt.has(p.sha) || p.at < pushedAt.get(p.sha)))
      pushedAt.set(p.sha, p.at);
  return rounds.map((r) => {
    if (!pushedAt.has(r.sha) || pushedAt.get(r.sha) > r.at)
      return { ...r, staleAtSubmit: false };
    const h = headAt(pushes, r.at);
    return { ...r, staleAtSubmit: h !== null && h !== r.sha };
  });
}
