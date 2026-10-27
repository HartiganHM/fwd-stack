// Path classification the gate's doc-only rule reads, kept out of pr-gate.mjs so a test
// can import it (the gate runs on import).

// What a path can break decides whether fixing it earns another round.
export const isDoc = (p) =>
  /\.(md|mdx|json|txt)$/.test(p) || p.startsWith('docs/');
// A design handoff is a non-engineer's drawing package, reviewed by a design
// audit and ratified by Product. A code reviewer's opinion on it is not a
// finding, and acting on one edits somebody else's record of what they decided.
// Dropped from every round's weight, and printed so the discount is visible.
export const isHandoff = (p) => p.startsWith('design/');

// A design handoff ships nothing (its .dc.html, art and support.js are read from
// disk and never served), so a PR of handoff files alone is a doc-only PR.
export const isDocOnly = (paths) =>
  paths.length > 0 && paths.every((p) => isDoc(p) || isHandoff(p));
