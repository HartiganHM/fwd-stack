// `## Settled` parsing and the rule for which rounds an entry discounts.
//
// Split out of pr-gate.mjs so the rule can be tested without GitHub.
//
// WHY ROUNDS. An entry used to discount its file in EVERY round, which let it
// swallow findings it was never written for. That faked a green twice:
//   - An entry written for round 2's duplicate discounted round 4's
//     genuine Critical-class defect on the same file.
//   - An entry naming fill.ts for a deferred round-1 item
//     discounted round 3's new High on fill.ts.
// A decline is about ONE finding, so it may only discount the round it answers.
//
// The rule, per path an entry names in backticks:
//   - the line says which round(s) it settles ("round 3", "rounds 2, 4",
//     "rounds 3-5"), in its FIRST round phrase: the file is discounted in
//     exactly those rounds, and rounds its prose mentions later are not read;
//   - the line names no round: the file is discounted only in the first round
//     that flagged it, which is the finding a bare entry was written for.
// A repeat that a later round posts as a NEW inline comment counts again until
// the entry adds that round. That is the §6 escape valve kept visible: each
// round the author discounts is written in the PR body.

// Any extension the gate can score a finding on, shell scripts included: a Settled line naming a
// `.sh` file used to be ignored, so a ruling on a shell script could never release its block.
const PATH =
  /`([^`\s]+\.(?:m?[jt]sx?|mts|cts|md|mdx|json|txt|css|sql|ya?ml|sh|bash|py|html))`/g;
const ROUNDS = /\brounds?\s+(\d+(?:\s*(?:,|&|and|to|-|–|—)\s*\d+)*)/gi;

const section = (body, heading) =>
  (body ?? '')
    .split(new RegExp(`^##\\s+${heading}\\s*$`, 'mi'))[1]
    ?.split(/^##\s+/m)[0] ?? '';

// Only the line's FIRST round phrase is its declaration. Prose after it may
// mention other rounds ("…deletes them in its own transaction (round 2's fix)"),
// and reading those too scoped one PR's round-3 entry to round 2 as well,
// which discounted round 2's real Medium on the same file.
const roundsOn = (line) => {
  const out = new Set();
  for (const [, list] of [...line.matchAll(ROUNDS)].slice(0, 1)) {
    // "3-5" and "3 to 5" are ranges; commas and "and" are lists.
    const parts = list.split(/\s*(?:,|&|and)\s*/);
    for (const part of parts) {
      const range = part.match(/^(\d+)\s*(?:to|-|–|—)\s*(\d+)$/);
      if (range) {
        const [a, b] = [Number(range[1]), Number(range[2])].sort(
          (x, y) => x - y,
        );
        for (let n = a; n <= b; n++) out.add(n);
      } else if (/^\d+$/.test(part)) out.add(Number(part));
    }
  }
  return out;
};

/**
 * Map of each path the Settled section names to the rounds it settles, or
 * `null` for a path no line gives a round for. A path named on several lines
 * takes the union; one bare mention does not widen a path another line scopes.
 */
export function parseSettled(body) {
  const settled = new Map();
  // One entry per Settled line naming the path: a decline answers one finding, so the
  // lines are counted (isDeclinedIn) rather than only unioned into the Map's value.
  const lines = new Map();
  Object.defineProperty(settled, 'lines', { value: lines });
  for (const line of section(body, 'Settled').split('\n')) {
    const rounds = roundsOn(line);
    // A line naming one file twice is still one decline: counting each mention let a single
    // entry discount two findings on that file.
    const paths = new Set(
      [...line.matchAll(PATH)].map(([, raw]) => raw.replace(/^\.\//, '')),
    );
    for (const path of paths) {
      const prior = settled.get(path);
      lines.set(path, [
        ...(lines.get(path) ?? []),
        rounds.size ? rounds : null,
      ]);
      if (rounds.size === 0) {
        if (!settled.has(path)) settled.set(path, null);
      } else {
        settled.set(path, new Set([...(prior ?? []), ...rounds]));
      }
    }
  }
  return settled;
}

/** Paths a `## Doc-sync` section names. Unchanged: doc-sync is not round-scoped. */
export function parseDocSync(body) {
  return new Set(
    [...section(body, 'Doc-sync').matchAll(PATH)].map((m) =>
      m[1].replace(/^\.\//, ''),
    ),
  );
}

const base = (p) => p.split('/').pop();
const lookup = (settled, path) =>
  settled.has(path)
    ? settled.get(path)
    : settled.has(base(path))
      ? settled.get(base(path))
      : undefined;

/** Whether the Settled section mentions the file at all, whatever round. */
export const mentions = (settled, path) => lookup(settled, path) !== undefined;

/**
 * Whether a finding on `path` in round `n` is discounted. `rounds` is every
 * scored round, each `{ n, paths }`, used to find the round that first flagged
 * the file when an entry names no round.
 */
export function isDeclinedIn(settled, path, n, rounds) {
  const entry = lookup(settled, path);
  if (entry === undefined) return false;
  const first = rounds.find((r) => r.paths.includes(path));
  const applies = (e) =>
    e !== null ? e.has(n) : first !== undefined && first.n === n;
  if (!applies(entry)) return false;
  // A decline answers ONE finding, never its file: when the round raised more findings
  // on the path than Settled lines answer it, the rest still count (one PR: a fixed
  // Medium rode a decline on the same file and the bar read met).
  const raised = rounds.find((r) => r.n === n)?.findings?.[path];
  if (raised === undefined) return true;
  const key = settled.lines?.has(path) ? path : base(path);
  const answered = (settled.lines?.get(key) ?? []).filter(applies).length;
  return raised <= answered;
}
