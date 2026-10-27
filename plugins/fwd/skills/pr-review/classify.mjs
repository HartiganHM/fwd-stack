// Path classification the gate's doc-only rule reads, kept out of pr-gate.mjs so a test
// can import it (the gate runs on import).

// What a path can break decides whether fixing it earns another round. JSON is not prose:
// `package.json`, a tsconfig or a hooks.json is configuration that changes what runs, so a PR
// of JSON alone is not doc-only and a finding in one is not soft.
export const isDoc = (p) => /\.(md|mdx|txt)$/.test(p) || p.startsWith('docs/');
// A design handoff is a non-engineer's drawing package, reviewed by a design
// audit and ratified by Product. A code reviewer's opinion on it is not a
// finding, and acting on one edits somebody else's record of what they decided.
// Dropped from every round's weight, and printed so the discount is visible.
export const isHandoff = (p) => p.startsWith('design/');

// A design handoff ships nothing (its .dc.html, art and support.js are read from
// disk and never served), so a PR of handoff files alone is a doc-only PR.
export const isDocOnly = (paths) =>
  paths.length > 0 && paths.every((p) => isDoc(p) || isHandoff(p));

// Machine-written files: a migration tool's snapshots, lockfiles. Nobody reviews them line by
// line, so they never count toward the size gate — one schema snapshot is 11,000 lines of JSON
// that would otherwise read as a PR too big to review.
export const isGenerated = (p) =>
  /(^|\/)(drizzle|migrations)\/meta\//.test(p) ||
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(p);
