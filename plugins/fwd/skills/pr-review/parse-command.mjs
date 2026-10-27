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
  const substitutions = [];
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
    // A backslash-newline is a line continuation, removed before anything else reads the line.
    if (ch === '\\' && cmd[i + 1] === '\n' && quote !== "'") {
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else if (
        quote === '"' &&
        (ch === '`' || (ch === '$' && cmd[i + 1] === '('))
      ) {
        // Double quotes still run a command substitution: its contents are a command line of
        // their own, read as one, while the quoted text around it stays argument data.
        const end = substitutionEnd(cmd, i);
        const body = ch === '`' ? cmd.slice(i + 1, end) : cmd.slice(i + 2, end);
        substitutions.push(...simpleCommands(body));
        i = end;
      } else if (ch === '\\' && quote === '"' && i + 1 < cmd.length)
        word += cmd[++i];
      else word += ch;
      continue;
    }
    // An unquoted `#` starting a word is a comment to the end of the line. Read as text, an
    // apostrophe in it (`# don't`) opened a quote that swallowed the command after it.
    if (ch === '#' && word === null) {
      while (i + 1 < cmd.length && cmd[i + 1] !== '\n') i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      word ??= '';
    } else if (ch === '\\' && i + 1 < cmd.length) {
      word = (word ?? '') + cmd[++i];
    } else if (';\n|&()`'.includes(ch)) {
      // Command separators, and the grouping and substitution marks that start a new command:
      // `(…)`, `$(…)` and backticks run their contents as commands of their own.
      if ((ch === '&' || ch === '|') && cmd[i + 1] === ch) i++;
      if (ch === '(' && word === '$') word = null;
      endCommand();
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      word = (word ?? '') + ch;
    }
  }
  endCommand();
  return [...commands, ...substitutions];
}

// Index of the character that closes the substitution opened at `start` (`$(` or a backtick),
// counting nested parentheses for `$(`. An unclosed one runs to the end.
function substitutionEnd(cmd, start) {
  if (cmd[start] === '`') {
    const end = cmd.indexOf('`', start + 1);
    return end === -1 ? cmd.length : end;
  }
  let depth = 0;
  for (let i = start + 1; i < cmd.length; i++) {
    if (cmd[i] === '(') depth++;
    else if (cmd[i] === ')' && --depth === 0) return i;
  }
  return cmd.length;
}

// A command's repository, most explicit first: an API path, then `-R`/`--repo`, then a
// `GH_REPO=` that only sets the default.
const repoIn = (words) => {
  // Only a word that IS an API path: `repos/a/b/pulls/7` quoted inside a --body value is text.
  for (const w of words) {
    const path = w.match(
      new RegExp(`^(?:https://api\\.github\\.com)?/?repos/(${REPO})/pulls/`),
    );
    if (path) return path[1];
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (
      (w === '-R' || w === '--repo') &&
      new RegExp(`^${REPO}$`).test(words[i + 1] ?? '')
    )
      return words[i + 1];
    // `--repo=o/r` and the attached short form `-Ro/r`.
    const eq = w.match(new RegExp(`^(?:--repo=|-R)(${REPO})$`));
    if (eq) return eq[1];
  }
  for (const w of words) {
    const env = w.match(new RegExp(`^GH_REPO=(${REPO})$`));
    if (env) return env[1];
  }
  return null;
};

// The PR a `gh … pr merge` names: a number (`42` or `#42`) or a pull URL, wherever it sits
// among the flags. A branch name, or nothing (the current branch), yields no PR.
// Flags `gh pr merge` takes with no value. With VALUE_FLAGS this is the whole allowlist: any other
// option (a cluster such as `-st 9`, a flag this table does not know) makes the merge unreadable
// rather than risking a value being read as the PR.
const BOOLEAN_FLAGS = new Set([
  '-s',
  '--squash',
  '-m',
  '--merge',
  '-r',
  '--rebase',
  '-d',
  '--delete-branch',
  '--auto',
  '--disable-auto',
  '--admin',
]);
const isRepoFlag = (w) =>
  w === '-R' || w === '--repo' || /^(?:--repo=|-R)\S/.test(w);

function mergeOf(words) {
  // By basename, so `/usr/local/bin/gh` is gh too.
  const gh = words.findIndex((w) => w.split('/').at(-1) === 'gh');
  if (gh === -1) return null;
  const repo = repoIn(words);
  const unreadable = { action: 'merge', pr: null, repo };
  // Only a repository flag may sit before `pr` or between `pr` and `merge`
  // (`gh -R o/r pr merge 42`, `gh pr --repo=o/r merge 42`).
  const skipRepoFlags = (i) => {
    while (i < words.length && isRepoFlag(words[i]))
      i += words[i] === '-R' || words[i] === '--repo' ? 2 : 1;
    return i;
  };
  let i = skipRepoFlags(gh + 1);
  if (words[i] !== 'pr') {
    // Something other than a repository flag before the subcommand: if this is a merge at all,
    // it is not one the gate can read.
    return words.slice(i).includes('merge') && words.slice(i).includes('pr')
      ? unreadable
      : null;
  }
  i = skipRepoFlags(i + 1);
  if (words[i] !== 'merge')
    return words.slice(i).includes('merge') ? unreadable : null;
  let pr = null;
  let prRepo = null;
  for (let j = i + 1; j < words.length; j++) {
    const a = words[j];
    if (VALUE_FLAGS.has(a)) {
      j++;
      continue;
    }
    if (BOOLEAN_FLAGS.has(a) || isRepoFlag(a) || /^--[a-z-]+=/.test(a))
      continue;
    if (a.startsWith('-')) return unreadable;
    if (pr !== null) return unreadable; // a second positional: not a form gh takes
    const n = a.match(/^#?(\d+)$/);
    const url = a.match(new RegExp(`github\\.com/(${REPO})/pull/(\\d+)`));
    if (n) pr = n[1];
    else if (url) [pr, prRepo] = [url[2], url[1]];
    else return unreadable; // a branch name, or anything else
  }
  return pr ? { action: 'merge', pr, repo: prRepo ?? repo } : unreadable;
}

function gatedIn(words) {
  // A merge whose PR the parser cannot resolve is still reported, with pr null, so it is
  // counted as unreadable rather than dropped.
  const merge = mergeOf(words);
  if (merge) return merge;
  const text = words.join(' ');
  // The REST form of a merge (`gh api -X PUT repos/O/R/pulls/N/merge`) never spells
  // `gh pr merge`, and it is how orchestrated lanes merge.
  const rest = words
    .map((w) =>
      w.match(
        /^(?:https:\/\/api\.github\.com)?\/?repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/merge$/,
      ),
    )
    .find(Boolean);
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
// `bash -c '…'`, `sh -lc '…'`, `zsh -c '…'` and `eval '…'` run their argument as a command line,
// so it is parsed as one rather than read as a single quoted word. Only at the command's
// executable position, past assignments and transparent prefixes: `--subject eval` is a value.
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const PREFIXES = new Set([
  'env',
  'command',
  'exec',
  'nohup',
  'time',
  'sudo',
  'nice',
]);
function innerCommandLine(words) {
  let at = 0;
  while (
    at < words.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[at]) || PREFIXES.has(words[at]))
  )
    at++;
  const exe = words[at]?.split('/').at(-1);
  if (exe === 'eval') return words.slice(at + 1).join(' ');
  if (!SHELLS.has(exe)) return null;
  const flag = words.findIndex((w, i) => i > at && /^-[a-z]*c[a-z]*$/.test(w));
  return flag === -1 ? null : (words[flag + 1] ?? null);
}

// Every gated command in the line, each with the repository its own words name (a flag on one
// command never lends its repository to another). A `GH_REPO=` set on a shell wrapper is the
// default for the commands it runs, as it is in their environment.
export function parseCommand(cmd, depth = 0, inheritedRepo = null) {
  return simpleCommands(cmd).flatMap((words) => {
    const inner = depth < 3 ? innerCommandLine(words) : null;
    if (inner !== null) {
      const env = words
        .map((w) => w.match(new RegExp(`^GH_REPO=(${REPO})$`))?.[1])
        .find(Boolean);
      return parseCommand(inner, depth + 1, env ?? inheritedRepo);
    }
    const gated = gatedIn(words);
    if (!gated) return [];
    return [{ ...gated, repo: gated.repo ?? inheritedRepo }];
  });
}

// FAIL CLOSED. Shell is too rich to parse completely: heredocs, redirections, substitutions in
// every position, wrapper options. Three review rounds each found new forms, and every form the
// parser misread was a merge the hook ALLOWED. So instead of chasing them, the hook counts the
// merges the raw text mentions and the merges the parser could attribute to a PR; when the text
// mentions more, the command is unreadable and is denied with the form to use instead. A miss
// now costs a rewritten command, never an ungated merge. (A mention in a heredoc or a commit
// message is denied too; rephrase it.) This is not a security boundary, only a check that an
// agent cannot skip by accident.
export function unaccountedMerges(cmd) {
  // Counted on the text with quotes and line continuations removed, so `gh pr 'merge'` is a
  // mention too and a merge the parser did read cannot cancel one it did not.
  const plain = cmd.replace(/\\\n/g, ' ').replace(/['"\\]/g, ' ');
  const mentioned =
    (
      plain.match(
        /\bpr\s+(?:(?:-R|--repo)\s+\S+\s+|--repo=\S+\s+|-R\S+\s+)*merge\b/g,
      ) ?? []
    ).length + (plain.match(/pulls\/\d+\/merge\b/g) ?? []).length;
  const merges = parseCommand(cmd).filter((g) => g.action === 'merge');
  const unresolved = merges.filter((g) => !g.pr).length;
  const read = merges.length - unresolved;
  return Math.max(unresolved, mentioned - read);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const cmd = process.argv[2] ?? '';
  if (unaccountedMerges(cmd) > 0) console.log('unreadable');
  for (const g of parseCommand(cmd))
    if (g.pr) console.log([g.action, g.pr, g.repo].filter(Boolean).join(' '));
}
