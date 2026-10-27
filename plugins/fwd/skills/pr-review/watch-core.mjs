// What a PR watcher reports, decided from one snapshot of the PR and what it has already reported.
//
// The defect this replaces: lanes armed their own watcher as "wait until the bot's review count rises, then exit".
// That wakes on round 1 and then nothing is watching. After the re-request the next round lands in silence, and
// silence reads as waiting. On one PR round 1 landed at 20:40, the author pushed and re-requested at
// 20:53-20:54, and round 2 landed at 21:01 with no watcher armed (four other PRs missed it the same
// way). A watcher has to outlive a round.
//
// So the state is the set of things already said, never a count taken once: every bot review not yet reported is
// an event (fresh when its commit_id is the PR's head, stale otherwise, which §3 says to discard and re-request),
// a head's CI is reported once all of its runs have completed, and the PR merging or closing is the last event.
// A snapshot is { state: "open" | "closed" | "merged", head, reviews: [{ id, commit_id, submitted_at, body }],
// ciRuns: [{ head_sha, status, conclusion, name }] }.

export function initialState() {
  return { reviews: new Set(), ci: new Set(), round: 0, ended: false };
}

/** Mark everything already in `snap` as reported, so a watcher armed mid-PR wakes only on what comes next. */
export function primeState(snap) {
  const state = initialState();
  for (const r of snap.reviews) state.reviews.add(r.id);
  state.round = snap.reviews.length;
  if (ciDone(snap)) state.ci.add(snap.head);
  return state;
}

function ciDone(snap) {
  const runs = snap.ciRuns.filter((r) => r.head_sha === snap.head);
  return runs.length > 0 && runs.every((r) => r.status === 'completed');
}

/** The events this snapshot adds, and the state after reporting them. Pure: `state` is not modified. */
export function watchStep(prev, snap) {
  const state = {
    reviews: new Set(prev.reviews),
    ci: new Set(prev.ci),
    round: prev.round,
    ended: prev.ended,
  };
  const events = [];
  if (state.ended) return { state, events };
  const fresh = [...snap.reviews]
    .filter((r) => !state.reviews.has(r.id))
    .sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1));
  for (const r of fresh) {
    state.reviews.add(r.id);
    state.round += 1;
    const errored = /encountered an error/i.test(r.body ?? '');
    const kind = errored
      ? 'errored'
      : r.commit_id === snap.head
        ? 'fresh'
        : 'stale';
    events.push({
      type: 'review',
      round: state.round,
      kind,
      sha: r.commit_id,
      head: snap.head,
      id: r.id,
    });
  }
  if (!state.ci.has(snap.head) && ciDone(snap)) {
    state.ci.add(snap.head);
    const runs = snap.ciRuns.filter((r) => r.head_sha === snap.head);
    const failed = runs.filter(
      (r) => !['success', 'skipped', 'neutral'].includes(r.conclusion ?? ''),
    );
    events.push({
      type: 'ci',
      head: snap.head,
      ok: failed.length === 0,
      failed: failed.map((r) => r.name),
    });
  }
  if (snap.state !== 'open') {
    state.ended = true;
    events.push({ type: 'end', state: snap.state });
  }
  return { state, events };
}

/** One line per event, the line a Monitor notification shows. */
export function describe(pr, e) {
  const s = (sha) => (sha ?? '').slice(0, 7);
  if (e.type === 'review') {
    if (e.kind === 'fresh')
      return `#${pr} review round ${e.round} landed on the head ${s(e.sha)}: run pr-gate.mjs ${pr}, then triage`;
    if (e.kind === 'stale')
      return `#${pr} review round ${e.round} landed STALE (saw ${s(e.sha)}, head is ${s(e.head)}): discard it and re-request (§3)`;
    return `#${pr} review round ${e.round} ERRORED: retry the request now, then once at 120s (§4)`;
  }
  if (e.type === 'ci')
    return e.ok
      ? `#${pr} CI passed on ${s(e.head)}`
      : `#${pr} CI FAILED on ${s(e.head)}: ${e.failed.join(', ')}`;
  return `#${pr} is ${e.state}: watcher done`;
}
