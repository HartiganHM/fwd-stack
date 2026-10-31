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
//     next `#` or `##` heading, with HTML comments and sub-heading lines (`### Findings`) removed;
//   - it is split into clauses at . ; : , ! ? ( ) and dashes between words, each lowercased with
//     markup and punctuation dropped;
//   - it is NOT a record when no clause is left, when the first clause opens with pending, tbd,
//     tba, todo, to do or wip ("Pending: cavecrew-reviewer"), or when ANY clause is only a
//     placeholder ("Reviewer: n/a", "cavecrew-reviewer: TBD", "None yet, will run after CI",
//     "The review is pending.");
//   - anything else is a record, so a finding that mentions a pending state still counts.

const HEADING = /^##[ \t]+Claude review\b([^\n]*)$/im;

const PLACEHOLDER_OPENER = /^(?:pending|tbd|tba|todo|to do|wip)\b/;
const PLACEHOLDER =
  '(?:pending|tbd|tba|todo|to do|wip|n a|na|none yet|not yet run|not run yet|not yet|coming soon|placeholder)';
// A clause that is a placeholder alone, or says something "is pending" / "still TBD".
const PLACEHOLDER_CLAUSE = new RegExp(
  `^(?:(?:.+ )?(?:is|are|still|is still) )?${PLACEHOLDER}$`,
);

/** The text a `## Claude review` record must hold, said where the gate refuses it. */
export const RECORD_HINT =
  'write the reviewer and what it found, e.g. "cavecrew-reviewer: no findings." or ' +
  '"cavecrew-reviewer: 2 findings (1 Medium, 1 Low), both fixed."';

const clauses = (text) =>
  text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/^[ \t]*#{3,}(?:[ \t].*)?$/gm, ' ')
    .split(/[.;:,!?()\n]|\s[-–—]+\s/)
    .map((c) =>
      c
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
    )
    .filter(Boolean);

/**
 * `{ present, recorded, text }` for the section a heading regex opens: `present` when the heading
 * exists, `recorded` when its section holds a real record (the rule above), `text` the section's
 * own words, trimmed. Group 1 of `heading` is the heading line's own text after the fixed words.
 * Shared with risk-override.mjs, so a `## Risk: not risky` reason passes the same placeholder test.
 */
export function sectionState(body, heading) {
  const text = body ?? '';
  const m = heading.exec(text);
  if (!m) return { present: false, recorded: false, text: '' };
  const rest = text.slice(m.index + m[0].length).split(/^#{1,2}[ \t]/m)[0];
  const own = `${m[1] ?? ''}\n${rest}`;
  const parts = clauses(own);
  const recorded =
    parts.length > 0 &&
    !PLACEHOLDER_OPENER.test(parts[0]) &&
    !parts.some((c) => PLACEHOLDER_CLAUSE.test(c));
  return {
    present: true,
    recorded,
    text: own
      .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  };
}

/**
 * `{ present, recorded }` for a PR body: `present` when a `## Claude review` heading exists,
 * `recorded` when its section holds a real record (see the rule above).
 */
export function claudeReviewState(body) {
  const { present, recorded } = sectionState(body, HEADING);
  return { present, recorded };
}
