import { pathToFileURL } from 'node:url';

// Which gated action a shell command takes, on which PR, in which repository.
//
// This used to be a chain of greps in gate-hook.sh, and they read only one spelling of each
// command. `gh pr merge 42 --squash` was gated; `gh pr merge --squash 42` and
// `gh pr merge https://github.com/o/r/pull/42` found no number, and the hook allowed what it
// could not read — so a flag placed first skipped the merge bar and the CI check entirely.
// Here each command is tokenised, so a flag's position no longer decides whether it is gated.
//
//   node parse-command.mjs '<command>'   prints `<action> <pr> [<owner/name>]`, or nothing

const REPO = '[A-Za-z0-9._-]+/[A-Za-z0-9._-]+';

// `gh pr merge` flags that take a value, so their value is never read as the PR.
const VALUE_FLAGS = new Set([
  '-t',
  '--subject',
  '-b',
  '--body',
  '-F',
  '--body-file',
  '-R',
  '--repo',
  '-A',
  '--author-email',
  '--match-head-commit',
]);

// Splits one shell segment into words, honouring single and double quotes. Good enough for
// reading arguments; it is not a shell.
function words(segment) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (const m of segment.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// The PR a `gh pr merge` names: a number or a pull URL, wherever it sits among the flags.
// A branch name, or nothing (the current branch), yields null.
function mergeTarget(segment) {
  const at = segment.search(/\bgh\s+pr\s+merge\b/);
  const args = words(segment.slice(at).replace(/^gh\s+pr\s+merge/, ''));
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    if (/^\d+$/.test(a)) return { pr: a };
    const url = a.match(new RegExp(`github\\.com/(${REPO})/pull/(\\d+)`));
    if (url) return { pr: url[2], repo: url[1] };
    return null;
  }
  return null;
}

function repoOf(cmd) {
  return (
    cmd.match(new RegExp(`repos/(${REPO})/pulls/`))?.[1] ??
    cmd.match(new RegExp(`(?:^|\\s)(?:-R|--repo)(?:\\s+|=)(${REPO})`))?.[1] ??
    cmd.match(new RegExp(`GH_REPO=(${REPO})`))?.[1] ??
    null
  );
}

export function parseCommand(cmd) {
  // Command separators bound each `gh` invocation, so a flag from one never reaches another.
  const segments = cmd.split(/&&|\|\||[;|\n]/);
  const merge = segments.find((s) => /\bgh\s+pr\s+merge\b/.test(s));
  if (merge) {
    const target = mergeTarget(merge);
    if (!target) return null;
    return {
      action: 'merge',
      pr: target.pr,
      repo: target.repo ?? repoOf(merge) ?? repoOf(cmd),
    };
  }
  // The REST form of a merge (`gh api -X PUT repos/O/R/pulls/N/merge`) never spells
  // `gh pr merge`, and it is how orchestrated lanes merge.
  const rest = cmd.match(/pulls\/(\d+)\/merge\b/);
  if (rest) return { action: 'merge', pr: rest[1], repo: repoOf(cmd) };
  if (/requested_reviewers|request-copilot-review/.test(cmd)) {
    // Two shapes reach here. The raw API call carries the PR in its path. A project wrapper
    // hides that call inside a script, so the hook only sees the script name and its
    // arguments — one project mandates `scripts/request-copilot-review.sh <pr>`.
    const pr =
      cmd.match(/pulls\/(\d+)\/requested_reviewers/)?.[1] ??
      cmd.match(/request-copilot-review\S*\s+(\d+)/)?.[1];
    if (!pr) return null;
    return { action: 'rerequest', pr, repo: repoOf(cmd) };
  }
  return null;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const parsed = parseCommand(process.argv[2] ?? '');
  if (parsed)
    console.log(
      [parsed.action, parsed.pr, parsed.repo].filter(Boolean).join(' '),
    );
}
