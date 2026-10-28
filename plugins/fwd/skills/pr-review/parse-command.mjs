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
  // A redirection (`2>/dev/null`, `>out`, `<<'EOF'`) is not an argument: its operator, any file
  // descriptor before it and its target word are dropped, so `script.sh 2>/dev/null 42` reads 42.
  let dropNext = false;
  const endWord = () => {
    if (word !== null) {
      if (dropNext) dropNext = false;
      else words.push(word);
    }
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
        // Its output is unknown here, so the word keeps a `$`: `"4$(printf 2)"` must never read
        // as PR 4.
        word += '$';
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
    } else if (ch === '>' || ch === '<') {
      if (word !== null && /^\d+$/.test(word)) word = null; // the fd of `2>`
      endWord();
      while (cmd[i + 1] === '>' || cmd[i + 1] === '<' || cmd[i + 1] === '&')
        i++;
      // `>&2` names a descriptor, not a file: drop it like any other target.
      dropNext = true;
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

// The `NAME=value` words a command starts with: its environment. A `GH_REPO=` anywhere later is an
// argument (`--body GH_REPO=a/b`, a script's own parameter), not an assignment.
const leadingAssignments = (words) => {
  const out = [];
  for (const w of words) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) out.push(w);
    else break;
  }
  return out;
};
const ghRepoOf = (words) =>
  leadingAssignments(words)
    .map((w) => w.match(/^GH_REPO=(.*)$/)?.[1])
    .filter((v) => v !== undefined)
    .at(-1);

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
  const env = ghRepoOf(words);
  return env && new RegExp(`^${REPO}$`).test(env) ? env : null;
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
  // Every repository selector must be a plain owner/name: `--repo "$TARGET"` or `--repo
  // host/o/r` names a repository the gate cannot read, so the merge is unreadable.
  const selectors = words.flatMap((w, k) =>
    w === '-R' || w === '--repo'
      ? [words[k + 1] ?? '']
      : (w.match(/^(?:--repo=|-R)(.+)$/)?.slice(1) ?? []),
  );
  if (selectors.some((v) => !new RegExp(`^${REPO}$`).test(v)))
    return unreadable;
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
    if (a.startsWith('-') || a.includes('$')) return unreadable;
    if (pr !== null) return unreadable; // a second positional: not a form gh takes
    const n = a.match(/^#?(\d+)$/);
    const url = a.match(
      new RegExp(`^https?://github\\.com/(${REPO})/pull/(\\d+)/?$`),
    );
    if (n) pr = n[1];
    else if (url) [pr, prRepo] = [url[2], url[1]];
    else return unreadable; // a branch name, or anything else
  }
  return pr ? { action: 'merge', pr, repo: prRepo ?? repo } : unreadable;
}

function gatedIn(words) {
  const gated = gatedWords(words);
  // Any expansion left in a gated command (`$OWNER`, `"$TARGET_REPO"`, a substitution's `$`)
  // stands for a value the hook cannot see: the PR, the repository or both. The whole class is
  // unreadable, so it is denied rather than checked against a guess.
  if (gated && words.some((w) => w.includes('$')))
    return { ...gated, pr: null };
  return gated;
}

function gatedWords(words) {
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
  // `export GH_REPO=o/r; gh pr merge 42` sets the default in a command before the merge, which
  // this hook runs ahead of. A merge that names no repository of its own then cannot be read.
  const exported =
    depth === 0 &&
    simpleCommands(cmd).some(
      (words) =>
        // `export GH_REPO=…`, or a command that is nothing but assignments (`GH_REPO=…;`).
        (words[0] === 'export' &&
          words.some((w) => w.startsWith('GH_REPO='))) ||
        (words.length > 0 &&
          leadingAssignments(words).length === words.length &&
          words.some((w) => w.startsWith('GH_REPO='))),
    );
  return simpleCommands(cmd).flatMap((words) => {
    const inner = depth < 3 ? innerCommandLine(words) : null;
    if (inner !== null) {
      const raw = ghRepoOf(words);
      // A wrapper's GH_REPO that is not a plain owner/name (`github.com/o/r`) cannot be read.
      if (raw !== undefined && !new RegExp(`^${REPO}$`).test(raw))
        return parseCommand(inner, depth + 1, null).map((g) => ({
          ...g,
          pr: null,
        }));
      const env = raw;
      return parseCommand(inner, depth + 1, env ?? inheritedRepo);
    }
    const gated = gatedIn(words);
    if (!gated) return [];
    const repo = gated.repo ?? inheritedRepo;
    const own = ghRepoOf(words);
    if (own !== undefined && !new RegExp(`^${REPO}$`).test(own))
      return [{ ...gated, pr: null, repo: null }];
    const ownAssignment = own !== undefined;
    if (gated.action === 'merge' && !repo && exported && !ownAssignment)
      return [{ ...gated, pr: null, repo: null }];
    return [{ ...gated, repo }];
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
    ).length + (plain.match(/pulls\/[^/\s]+\/merge\b/g) ?? []).length;
  const merges = parseCommand(cmd).filter((g) => g.action === 'merge');
  const unresolved = merges.filter((g) => !g.pr).length;
  const read = merges.length - unresolved;
  return Math.max(unresolved, mentioned - read);
}

// The blunt end of the fail-closed rule. Review kept finding new places an expansion could hide
// (a REST path, a GH_REPO value on a wrapper, a repeated assignment), each a value the hook
// cannot see. So a command line that mentions a gated action at all, and contains an expansion
// (`$`, a backtick) or sets GH_REPO more than once, is unreadable as a whole.
// The GraphQL `requestReviews` mutation names a PR by node id, never a number, so the gate can
// never attribute it: it is always unreadable, and the hook denies it.
export function mentionsGatedAction(cmd) {
  const plain = cmd.replace(/\\\n/g, ' ').replace(/['"\\]/g, ' ');
  return (
    /\bpr\s+(?:(?:-R|--repo)\s+\S+\s+|--repo=\S+\s+|-R\S+\s+)*merge\b/.test(
      plain,
    ) ||
    /pulls\/[^/\s]+\/merge\b/.test(plain) ||
    /requested_reviewers|request-copilot-review|requestReviews/.test(plain)
  );
}
export function unreadableLine(cmd) {
  const parsed = parseCommand(cmd);
  // Anything the tokenizer found but could not resolve is unreadable, whatever the raw text says.
  if (parsed.some((g) => !g.pr)) return true;
  if (!mentionsGatedAction(cmd)) return false;
  const plain = cmd.replace(/\\\n/g, ' ').replace(/['"\\]/g, ' ');
  const rerequestsMentioned = (
    plain.match(/requested_reviewers|request-copilot-review|requestReviews/g) ??
    []
  ).length;
  const rerequestsRead = parsed.filter((g) => g.action === 'rerequest').length;
  return (
    // An expansion or a backtick: a value the hook cannot see.
    /[$`]/.test(cmd) ||
    (cmd.match(/\bGH_REPO=/g) ?? []).length > 1 ||
    // GH_REPO set anywhere (through `env`, an `export`, a wrapper) while a gated command resolved
    // no repository of its own: the hook cannot know which repository that command acts on.
    (/\bGH_REPO\b/.test(cmd) && parsed.some((g) => !g.repo)) ||
    // More than one repository selector: gh takes the last, a reader could take the first.
    (parsed.length > 0 &&
      simpleCommands(cmd).some(
        (words) =>
          words.filter(
            (w) => w === '-R' || w === '--repo' || /^(?:--repo=|-R)\S/.test(w),
          ).length > 1,
      )) ||
    unaccountedMerges(cmd) > 0 ||
    rerequestsMentioned > rerequestsRead
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const cmd = process.argv[2] ?? '';
  const parsed = parseCommand(cmd);
  if (unreadableLine(cmd)) console.log('unreadable');
  for (const g of parsed)
    if (g.pr) console.log([g.action, g.pr, g.repo].filter(Boolean).join(' '));
}
