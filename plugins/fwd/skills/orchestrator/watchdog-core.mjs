// Which open PRs have gone quiet, kept pure so it is testable. A PR is quiet when nothing has
// touched it (a push, a review, a comment) for `stallMinutes`: the sign a lane has stopped,
// or is waiting on something that will never notify it.

export function stalledPrs(prs, now, stallMinutes = 30) {
  return prs
    .filter((p) => !p.isDraft)
    .map((p) => ({
      ...p,
      quietMinutes: Math.floor((now - Date.parse(p.updatedAt)) / 60_000),
    }))
    .filter((p) => p.quietMinutes >= stallMinutes)
    .sort((a, b) => b.quietMinutes - a.quietMinutes);
}
