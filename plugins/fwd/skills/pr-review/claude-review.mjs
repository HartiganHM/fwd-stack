// Whether the PR body's `## Claude review` section records a review that actually ran.
//
// Split out of pr-gate.mjs so the rule can be tested without GitHub.
//
// WHY. The gate used to accept the heading alone, so a PR merged while its section said only
// "(pending)": the heading was written before the review, and the review never happened.
//
// The rule, kept loose on purpose because real records are short ("cavecrew-reviewer: no
// findings.", "One-sentence revert to the exact text of #N; no logic change."):
//   - the section is the heading line's own text after "Claude review" plus everything up to the
//     next `## ` heading, with HTML comments, sub-heading lines (`### Findings`), markdown markup
//     and punctuation removed;
//   - it is NOT a record when nothing is left, when all that is left is a placeholder
//     (n/a, none yet, not run yet, coming, later, placeholder), or when it opens with
//     pending, tbd, tba, todo, to do or wip ("Pending: cavecrew-reviewer" has not run yet);
//   - anything else is a record.

const HEADING = /^##\s+Claude review\b([^\n]*)$/im;

const PLACEHOLDER_ONLY =
  /^(?:n a|na|none yet|not yet run|not run yet|not yet|coming|coming soon|later|placeholder)$/;
const PLACEHOLDER_OPENER = /^(?:pending|tbd|tba|todo|to do|wip)\b/;

/** The text a `## Claude review` record must hold, said where the gate refuses it. */
export const RECORD_HINT =
  'write the reviewer and what it found, e.g. "cavecrew-reviewer: no findings." or ' +
  '"cavecrew-reviewer: 2 findings (1 Medium, 1 Low), both fixed."';

const normalize = (text) =>
  text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/^\s*#{3,}\s.*$/gm, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * `{ present, recorded }` for a PR body: `present` when a `## Claude review` heading exists,
 * `recorded` when its section holds a real record (see the rule above).
 */
export function claudeReviewState(body) {
  const text = body ?? '';
  const m = HEADING.exec(text);
  if (!m) return { present: false, recorded: false };
  const rest = text.slice(m.index + m[0].length).split(/^##\s/m)[0];
  const content = normalize(`${m[1]}\n${rest}`);
  const recorded =
    content !== '' &&
    !PLACEHOLDER_ONLY.test(content) &&
    !PLACEHOLDER_OPENER.test(content);
  return { present: true, recorded };
}
