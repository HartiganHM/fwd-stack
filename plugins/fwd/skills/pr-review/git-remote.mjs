// `owner/name` of a git remote URL, so the gate can tell whether the session's `origin` is the
// PR's own repository. Kept out of pr-gate.mjs so a test can import it (the gate runs on import).

export function repoFromRemoteUrl(url) {
  // The last two path segments, whatever the host: `git@github-personal:O/r.git` (an SSH host
  // alias) and `ssh://git@github.com:22/O/r.git` name O/r as surely as the https form does.
  const m = (url ?? '')
    .trim()
    .match(/[:/]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export const sameRepo = (a, b) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());

// Whether a precheck ledger row belongs to `repo`. The ledger is one file for every repository,
// and rows were keyed by branch or PR number alone, so two repositories' PR #101 shared a row.
// Rows now carry their repository. A row written before that, or a lookup made outside any
// checkout, matches as it always did rather than orphaning the trial's history.
export const entryMatchesRepo = (entry, repo) =>
  !entry.repo || !repo || sameRepo(entry.repo, repo);
