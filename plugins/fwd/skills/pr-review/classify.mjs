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

// Build and test configuration: how a tooling PR wires its script in. It names no product surface,
// so a PR of scripts plus this configuration is still a PR whose product is the script.
export const isToolingConfig = (p) =>
  p.startsWith('.github/') ||
  /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.nvmrc|\.node-version)$/.test(
    p,
  ) ||
  /(^|\/)(tsconfig|jsconfig)(\.[\w-]+)?\.json$/.test(p) ||
  /(^|\/)\.?(vitest|vite|playwright|eslint|prettier|commitlint|lint-staged)(rc)?(\.config)?\.\w+$/.test(
    p,
  );

// ---- changes that cannot change what runs -----------------------------------
// A path rule alone scored a comment-only edit to a `.mjs` file, and a `plugin.json` version bump,
// as runtime, so a documentation PR that touched either needed two rounds instead of one. These read
// the diff itself. Each is conservative: a change is non-runtime only when every changed line is
// shown to be a comment (or the version field), and anything the patch cannot settle is runtime.

// JavaScript and TypeScript sources, whose comments these rules can read. Not JSX: its text and
// closing tags (`don't`, `</p>`) read as an open quote and a regex to the lexer below, so a `.jsx`
// or `.tsx` change is always runtime.
export const isScript = (p) => /\.[cm]?[jt]s$/.test(p);

// The hunks of a unified diff, each line with its kind (`+`, `-` or ` `) and its text.
// Returns null when a line is not one a unified diff carries, so the caller treats it as runtime.
export function parsePatch(patch) {
  if (typeof patch !== 'string' || patch === '') return null;
  const hunks = [];
  let hunk = null;
  for (const line of patch.split('\n')) {
    const header = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      hunk = { newStart: Number(header[1]), lines: [] };
      hunks.push(hunk);
      continue;
    }
    // `\ No newline at end of file` describes the line above it; it is not content.
    if (line.startsWith('\\')) continue;
    if (!hunk) return null;
    const kind = line[0] ?? ' ';
    if (kind !== '+' && kind !== '-' && kind !== ' ') return null;
    hunk.lines.push({ kind, text: line.slice(1) });
  }
  return hunks.length > 0 ? hunks : null;
}

// Unescaped backticks in a line: the template-literal delimiters a line could open or close.
const backticks = (text) => (text.match(/(?<!\\)`/g) ?? []).length;

// Whether a hunk begins inside a block comment opened above it. Only the JSDoc shape counts: every
// line before the first `*/` starts with `*` (or is blank), and the closing line is `*/` alone or a
// `*`-led line ending in it. A `*/` anywhere else (a regex such as /a*/, a string) leaves the hunk
// read as starting outside a comment, where its lines must prove themselves.
function startsInsideBlock(lines) {
  for (const { text } of lines) {
    const t = text.trim();
    if (t === '') continue;
    if (!t.startsWith('*')) return false;
    if (t.includes('*/')) return t.endsWith('*/') && !t.includes('/*');
  }
  return false;
}

// Which lines of one side of a hunk are comments or blank. The old side (context and removed
// lines) and the new side (context and added lines) are read apart: a removed `/*` must not make
// the added line after it read as comment text.
function commentFlags(lines) {
  let inBlock = startsInsideBlock(lines);
  return lines.map(({ text }) => {
    const t = text.trim();
    let comment = false;
    if (inBlock) {
      const close = t.indexOf('*/');
      if (close !== -1) inBlock = false;
      // Code after the comment closes (`*/ run()`) is code.
      comment = close === -1 || t.slice(close + 2).trim() === '';
    } else if (t === '' || t.startsWith('//')) comment = true;
    else if (t.startsWith('/*')) {
      const close = t.indexOf('*/', 2);
      if (close === -1) inBlock = true;
      comment = close === -1 || t.slice(close + 2).trim() === '';
    }
    // `open`: whether a block comment is still open after this line.
    return { comment, open: inBlock };
  });
}

// Whether every changed line of a JavaScript or TypeScript patch is a comment or blank, read from
// the patch alone. Returns the hunks (for the template-literal check) or null.
//
// Changed lines are not enough. Adding `/*` above unchanged code and `*/` below it comments the
// code out without one changed line being code. So every unchanged line must read the same on both
// sides, comment or code, with a block comment open after it or not, and each side must end the
// hunk in the same state, so the lines after the hunk read the same too.
export function commentOnlyHunks(patch) {
  const hunks = parsePatch(patch);
  if (!hunks) return null;
  let changed = 0;
  for (const { lines } of hunks) {
    const context = {};
    const end = {};
    for (const side of ['-', '+']) {
      const own = lines.filter((l) => l.kind === ' ' || l.kind === side);
      const flags = commentFlags(own);
      for (const [i, { kind, text }] of own.entries()) {
        if (kind === ' ') continue;
        changed++;
        // A changed line that is not a comment, or one that could move a template literal's
        // boundary (an odd count of backticks, or a `${`), is runtime.
        if (
          !flags[i].comment ||
          backticks(text) % 2 !== 0 ||
          text.includes('${')
        )
          return null;
      }
      context[side] = flags.filter((_, i) => own[i].kind === ' ');
      end[side] = flags.at(-1)?.open ?? false;
    }
    if (end['-'] !== end['+']) return null;
    for (const [i, before] of context['-'].entries()) {
      const after = context['+'][i];
      if (before.comment !== after.comment || before.open !== after.open)
        return null;
    }
  }
  return changed > 0 ? hunks : null;
}

// What each line of a JavaScript or TypeScript file starts inside: `code`, `block` (a block
// comment), `template` (a template literal's text) or `string` (a quoted string continued with a
// trailing backslash). Returns null when the file does not read as well-formed — a quote or regex
// left open at a line end, or a file ending inside anything — so the caller treats it as runtime.
//
// Not a parser. It knows the four things that can make a line that LOOKS like a comment be
// something else: a template literal, a continued string, a block comment, and a regex literal
// that holds a backtick or a quote (`t.replace(/`/g, '')` in this very folder broke a plain
// backtick count). A regex is told from division by the token before the slash, the usual rule.
const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'instanceof',
  'yield',
  'await',
]);
export function lineStates(text) {
  const states = ['code'];
  // A stack of contexts: `code` frames carry the brace depth that closes a `${` back into its
  // template; the bottom frame is the file's own code.
  const stack = [{ kind: 'code', braces: 0 }];
  let mode = 'code'; // code | line | block | single | double | template | regex | class
  let prev = ''; // the last significant character in code, for the regex rule
  let word = ''; // the identifier or keyword that ended at `prev`, if any
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') {
      if (mode === 'line') mode = 'code';
      // A quote or regex cannot span a line; a backslash before the newline continues a string.
      if (mode === 'single' || mode === 'double') {
        if (text[i - 1] !== '\\') return null;
        states.push('string');
        continue;
      }
      if (mode === 'regex' || mode === 'class') return null;
      states.push(mode === 'code' ? 'code' : mode);
      if (/[A-Za-z0-9_$]/.test(current)) word = current;
      current = '';
      continue;
    }
    if (mode === 'line') continue;
    if (mode === 'block') {
      if (ch === '*' && text[i + 1] === '/') {
        mode = 'code';
        i++;
      }
      continue;
    }
    if (mode === 'single' || mode === 'double') {
      // An escape skips the next character, but never a newline: the line count must see it.
      if (ch === '\\') {
        if (text[i + 1] !== '\n') i++;
      } else if (ch === (mode === 'single' ? "'" : '"')) {
        mode = 'code';
        prev = ch;
        word = '';
      }
      continue;
    }
    if (mode === 'regex' || mode === 'class') {
      // An escape skips the next character, but never a newline: the line count must see it.
      if (ch === '\\') {
        if (text[i + 1] !== '\n') i++;
      } else if (mode === 'regex' && ch === '[') mode = 'class';
      else if (mode === 'class' && ch === ']') mode = 'regex';
      else if (mode === 'regex' && ch === '/') {
        mode = 'code';
        prev = '/';
        word = '';
      }
      continue;
    }
    if (mode === 'template') {
      // An escape skips the next character, but never a newline: the line count must see it.
      if (ch === '\\') {
        if (text[i + 1] !== '\n') i++;
      } else if (ch === '`') {
        stack.pop();
        mode = 'code';
        prev = '`';
        word = '';
      } else if (ch === '$' && text[i + 1] === '{') {
        stack.push({ kind: 'code', braces: 0 });
        mode = 'code';
        prev = '{';
        word = '';
        i++;
      }
      continue;
    }
    // Code.
    if (/[A-Za-z0-9_$]/.test(ch)) {
      current += ch;
      prev = ch;
      continue;
    }
    if (current) {
      word = current;
      current = '';
    }
    if (/\s/.test(ch)) continue;
    if (ch === '/' && text[i + 1] === '/') {
      mode = 'line';
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      mode = 'block';
      i++;
      continue;
    }
    if (ch === '/') {
      const afterValue =
        /[A-Za-z0-9_$)\]}'"`]/.test(prev) && !REGEX_AFTER_WORD.has(word);
      if (!afterValue) {
        mode = 'regex';
        continue;
      }
    } else if (ch === "'") mode = 'single';
    else if (ch === '"') mode = 'double';
    else if (ch === '`') {
      stack.push({ kind: 'template' });
      mode = 'template';
      continue;
    } else if (ch === '{') stack.at(-1).braces++;
    else if (ch === '}') {
      const frame = stack.at(-1);
      if (frame.braces > 0) frame.braces--;
      else if (stack.length > 1) {
        // The `}` that closes a `${`: back into the template it opened from.
        stack.pop();
        mode = 'template';
        continue;
      } else return null;
    }
    prev = ch;
    word = '';
  }
  // A file ends in its own code, or in a line comment that ran to the end.
  if (stack.length !== 1 || (mode !== 'code' && mode !== 'line')) return null;
  return states;
}

// Whether a comment-only patch is really comment-only once the whole file is known. A line that
// starts with `//` inside a multi-line template literal is the template's text, not a comment, and
// the backtick that opened the template can sit far above the hunk. So the head file is read and
// every changed line is placed: an added line must start in code or in a block comment (and, if it
// is not `//`, `/*` or blank itself, inside a block comment), and a removed line must sit where the
// head file is in code or a block comment at the next line it still has. Changed lines carry no
// `${` and an even count of backticks (commentOnlyHunks refuses the rest), so a removed line inside
// a template would leave the line after it inside one too. Without the head file's text, or when
// it does not read as well-formed, the answer is runtime.
export function isCommentOnlyChange({ filename, status, patch }, headText) {
  if (!isScript(filename) || status === 'removed' || status === 'renamed')
    return false;
  const hunks = commentOnlyHunks(patch);
  if (!hunks || typeof headText !== 'string') return false;
  const states = lineStates(headText);
  if (!states) return false;
  const quiet = (s) => s === 'code' || s === 'block';
  for (const { newStart, lines } of hunks) {
    let next = newStart; // the head-file line number the next context or added line has
    for (const { kind, text } of lines) {
      if (kind === '-') {
        // The head file's state where this line used to be: the start of its next line.
        if (!quiet(states[next - 1] ?? 'end')) return false;
        continue;
      }
      if (kind === '+') {
        const state = states[next - 1];
        if (!quiet(state)) return false;
        const t = text.trim();
        const selfEvident =
          t === '' || t.startsWith('//') || t.startsWith('/*');
        if (!selfEvident && state !== 'block') return false;
      }
      next++;
    }
  }
  return true;
}

// A `plugin.json` or `package.json` change that only moves the top-level `version` field. Top level
// is read from the indentation: one level, two spaces or a tab, as every formatter writes it. A
// nested `"version"` (an `engines` or a config block) is indented further and stays runtime.
export function isVersionOnlyChange({ filename, status, patch }) {
  if (!/(^|\/)(plugin|package)\.json$/.test(filename)) return false;
  if (status !== 'modified') return false;
  const hunks = parsePatch(patch);
  if (!hunks) return false;
  const changed = hunks.flatMap((h) => h.lines.filter((l) => l.kind !== ' '));
  return (
    changed.length > 0 &&
    changed.every((l) => /^(?: {2}|\t)"version": *"[^"]*",?\s*$/.test(l.text))
  );
}

// A PR is doc-only when every file is prose, handoff, or a change shown above to be non-runtime.
// `nonRuntime` is the set of paths the gate proved so (it needs the API for the head file's text).
export const isDocOnlyChange = (files, nonRuntime) =>
  files.length > 0 &&
  files.every(
    (f) =>
      isDoc(f.filename) || isHandoff(f.filename) || nonRuntime.has(f.filename),
  );
