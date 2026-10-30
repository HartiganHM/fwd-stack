// What a fix touched, kept out of pr-gate.mjs so a test can import it (the gate runs on import).
//
// A round is weighed by where its findings were ANCHORED, which is the right question while the
// round is being triaged. Once the author has pushed past it, the question §5 asks is different:
// did the fix change production code? Copilot anchors a finding on the line it read, not the line
// that has to change. One PR's finding was anchored on a production file and fixed entirely in a
// test, and the gate demanded a round for it, so the author had to write a `## Settled` entry for
// a finding that was not declined at all. The opposite happens too: a finding on a test that is
// fixed by changing the code under test.
//
// So a pushed-past round is weighed by the files changed between the commit it reviewed and the
// head: the fix obliges a re-request only when those files reach the product tree.

// The compare API returns at most this many files; a list that long may be cut short.
export const MAX_COMPARE_FILES = 300;

// The paths a `compare/<reviewed>...<head>` response changed, or null when it cannot say. Only an
// `ahead` comparison is the fix: after a rebase or force push the reviewed commit is no longer an
// ancestor of the head, and the three-dot compare runs from a merge base, so it would also report
// every commit the rebase picked up from main. A merge of main into the branch keeps it `ahead`
// while bringing main's files in, so a merge commit, or a commit list the API cut short, says
// nothing either. A rename counts on both its paths.
export function fixPaths(compare) {
  if (!compare || compare.status !== 'ahead') return null;
  const commits = Array.isArray(compare.commits) ? compare.commits : null;
  if (
    !commits ||
    commits.length < (compare.total_commits ?? 0) ||
    commits.some((c) => (c.parents?.length ?? 1) > 1)
  )
    return null;
  const files = Array.isArray(compare.files) ? compare.files : null;
  if (!files || files.length >= MAX_COMPARE_FILES) return null;
  return [
    ...new Set(
      files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)),
    ),
  ];
}

// The weight of a round the author has pushed past.
//  - `anchorWeight`: the round's weight by where its findings were anchored (`soft` or
//    `substantive`), returned unchanged when `paths` is null.
//  - `open`: findings not answered by `## Settled` or `## Doc-sync`, nor on a design handoff. With
//    none, nothing was fixed, so nothing the push changed is a fix.
//  - `describing`: a reviewer that raised nothing inline and did not say `Changes recommended`;
//    its round is soft whatever was fixed (§5: no Crit/High/Med was claimed).
//  - `paths`: fixPaths' answer; `isProduct(path)`: whether a path is in the product tree.
export function fixWeight({
  anchorWeight,
  open,
  describing,
  paths,
  isProduct,
}) {
  if (paths === null) return anchorWeight;
  if (open === 0 || describing) return 'soft';
  return paths.some(isProduct) ? 'substantive' : 'soft';
}
