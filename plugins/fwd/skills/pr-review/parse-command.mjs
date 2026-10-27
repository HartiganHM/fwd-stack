// Which gated actions a shell command takes, on which PRs, in which repositories.
//
// This used to be a chain of greps in gate-hook.sh, and they read only one spelling of each
// command. `gh pr merge 42 --squash` was gated; `gh pr merge --squash 42` and
// `gh pr merge https://github.com/o/r/pull/42` found no number, and the hook allowed what it
// could not read, so a flag placed first skipped the merge bar and the CI check entirely.
//
// Here the command is split into its simple commands the way a shell would (separators inside
// quotes do not count), each one is tokenised, and EVERY gated command in a chain is reported:
// stopping at the first let `gh pr merge feat/x; gh pr merge 42` through on the unreadable one.
//
//   node parse-command.mjs '<command>'   prints `<action> <pr> [<owner/name>]` per gated command
import { pathToFileURL } from 'node:url';

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

// The simple commands in a command line, each as its words with quotes removed. Separators
// (`&&`, `||`, `;`, `|`, `&`, newline) end a command only outside quotes. Good enough for reading
// arguments; it is not a shell.
export function simpleCommands(cmd) {
  const commands = [];
  let words = [];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < cmd.length)
        word += cmd[++i];
      else word += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      word ??= '';
    } else if (ch === '\\' && i + 1 < cmd.length) {
      word = (word ?? '') + cmd[++i];
    } else if (ch === ';' || ch === '\n' || ch === '|' || ch === '&') {
      if ((ch === '&' || ch === '|') && cmd[i + 1] === ch) i++;
      endCommand();
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      word = (word ?? '') + ch;
    }
  }
  endCommand();
  return commands;
}

const repoIn = (words) => {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (
      (w === '-R' || w === '--repo') &&
      new RegExp(`^${REPO}$`).test(words[i + 1] ?? '')
    )
      return words[i + 1];
    const eq = w.match(new RegExp(`^(?:--repo=|GH_REPO=)(${REPO})$`));
    if (eq) return eq[1];
    const path = w.match(new RegExp(`repos/(${REPO})/pulls/`));
    if (path) return path[1];
  }
  return null;
};

// The PR a `gh … pr merge` names: a number (`42` or `#42`) or a pull URL, wherever it sits
// among the flags. A branch name, or nothing (the current branch), yields no PR.
function mergeOf(words) {
  const gh = words.indexOf('gh');
  if (gh === -1) return null;
  // gh's own flags may come before the subcommand: `gh -R o/r pr merge 42`.
  let i = gh + 1;
  while (i < words.length && words[i].startsWith('-'))
    i += VALUE_FLAGS.has(words[i]) ? 2 : 1;
  if (words[i] !== 'pr' || words[i + 1] !== 'merge') return null;
  const repo = repoIn(words);
  for (let j = i + 2; j < words.length; j++) {
    const a = words[j];
    if (VALUE_FLAGS.has(a)) {
      j++;
      continue;
    }
    if (a.startsWith('-')) continue;
    const n = a.match(/^#?(\d+)$/);
    if (n) return { action: 'merge', pr: n[1], repo };
    const url = a.match(new RegExp(`github\\.com/(${REPO})/pull/(\\d+)`));
    if (url) return { action: 'merge', pr: url[2], repo: url[1] };
    return { action: 'merge', pr: null, repo };
  }
  return { action: 'merge', pr: null, repo };
}

function gatedIn(words) {
  const merge = mergeOf(words);
  if (merge) return merge.pr ? merge : null;
  const text = words.join(' ');
  // The REST form of a merge (`gh api -X PUT repos/O/R/pulls/N/merge`) never spells
  // `gh pr merge`, and it is how orchestrated lanes merge.
  const rest = text.match(/pulls\/(\d+)\/merge\b/);
  if (rest) return { action: 'merge', pr: rest[1], repo: repoIn(words) };
  // Two re-request shapes. The raw API call carries the PR in its path. A project wrapper hides
  // that call inside a script, so the hook only sees the script name and its arguments — one
  // project mandates `scripts/request-copilot-review.sh <pr>`.
  const pr =
    text.match(/pulls\/(\d+)\/requested_reviewers/)?.[1] ??
    text.match(/request-copilot-review\S*\s+#?(\d+)/)?.[1];
  if (pr) return { action: 'rerequest', pr, repo: repoIn(words) };
  return null;
}

// Every gated command in the line, each with the repository its own words name (a flag on one
// command never lends its repository to another).
export function parseCommand(cmd) {
  return simpleCommands(cmd).map(gatedIn).filter(Boolean);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  for (const g of parseCommand(process.argv[2] ?? ''))
    console.log([g.action, g.pr, g.repo].filter(Boolean).join(' '));
}
