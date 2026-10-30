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

// Which lines of one side of a hunk are comments or blank, read from `startInBlock` (whether a
// block comment is open where the hunk starts). The old side (context and removed lines) and the
// new side (context and added lines) are read apart: a removed `/*` must not make the added line
// after it read as comment text. Each line reports:
//  - `comment`: the line is a comment or blank;
//  - `delimiters`: every `/*` and `*/` on it is one this reading opened or closed with. A `// */`
//    inside a block comment opened somewhere this reading cannot see would close it;
//  - `start` and `open`: whether a block comment is open before and after the line.
function commentFlags(lines, startInBlock) {
  let inBlock = startInBlock;
  return lines.map(({ text }) => {
    const t = text.trim();
    const start = inBlock;
    let comment = false;
    let delimiters = true;
    if (inBlock) {
      const close = t.indexOf('*/');
      if (close !== -1) inBlock = false;
      // Code after the comment closes (`*/ run()`) is code.
      comment = close === -1 || t.slice(close + 2).trim() === '';
    } else if (t === '' || t.startsWith('//')) {
      comment = true;
      delimiters = !/\/\*|\*\//.test(t);
    } else if (t.startsWith('/*')) {
      const close = t.indexOf('*/', 2);
      if (close === -1) inBlock = true;
      comment = close === -1 || t.slice(close + 2).trim() === '';
    }
    return { comment, delimiters, start, open: inBlock };
  });
}

// One hunk, both sides, from the block state each side starts in. Null unless every changed line
// is a comment, and every unchanged line reads the same on both sides.
//
// Changed lines alone are not enough. Adding `/*` above unchanged code and `*/` below it comments
// the code out without one changed line being code. So every unchanged line must read the same on
// both sides, comment or code, with a block comment open after it or not, and each side must end
// the hunk in the same state, so the lines after the hunk read the same too.
function checkHunk(lines, startFor) {
  const sides = {};
  let changed = 0;
  for (const side of ['-', '+']) {
    const own = lines.filter((l) => l.kind === ' ' || l.kind === side);
    const start = startFor(own);
    const flags = commentFlags(own, start);
    for (const [i, { kind, text }] of own.entries()) {
      if (kind === ' ') continue;
      changed++;
      const f = flags[i];
      // A changed line that is not a comment, carries a comment delimiter this reading did not
      // consume, or could move a template literal's boundary (an odd count of backticks, or a
      // `${`), is runtime.
      if (
        !f.comment ||
        !f.delimiters ||
        backticks(text) % 2 !== 0 ||
        text.includes('${')
      )
        return null;
    }
    sides[side] = {
      flags,
      context: flags.filter((_, i) => own[i].kind === ' '),
      end: flags.at(-1)?.open ?? start,
    };
  }
  if (sides['-'].end !== sides['+'].end) return null;
  for (const [i, before] of sides['-'].context.entries()) {
    const after = sides['+'].context[i];
    if (before.comment !== after.comment || before.open !== after.open)
      return null;
  }
  return { changed, newSide: sides['+'].flags };
}

// Whether every changed line of a JavaScript or TypeScript patch is a comment or blank, read from
// the patch alone, guessing each hunk's starting state from its own lines (startsInsideBlock).
// Returns the hunks, or null. A pre-filter: isCommentOnlyChange reads the real starting state from
// the head file and checks again.
export function commentOnlyHunks(patch) {
  const hunks = parsePatch(patch);
  if (!hunks) return null;
  let changed = 0;
  for (const { lines } of hunks) {
    const r = checkHunk(lines, startsInsideBlock);
    if (!r) return null;
    changed += r.changed;
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
// The body a regex starting at `text[at]` would have, to the slash that would close it on the same
// line (escapes and character classes honoured), or '' when no slash would close it.
function regexBody(text, at) {
  let inClass = false;
  for (let i = at + 1; i < text.length && text[i] !== '\n'; i++) {
    const ch = text[i];
    if (ch === '\\') i++;
    else if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) return text.slice(at + 1, i);
  }
  return '';
}

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
      // After `)` or `}` a slash may be division or a regex (`if (x) /a`/.test(s)`). Read as
      // division, unless read as a regex it would hold a quote or a backtick: then the file is
      // unreadable, because the two readings disagree about what follows.
      if ((prev === ')' || prev === '}') && /['"`]/.test(regexBody(text, i)))
        return null;
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

// Whether a comment-only patch is really comment-only once the whole file is known. The patch
// cannot see what a hunk starts inside: a `//` line inside a multi-line template literal is the
// template's text, and a block comment opened above the hunk changes what every line in it means.
// So the head file is read with lineStates, and:
//  - each hunk starts where the head file says, which must be code or a block comment. Lines
//    above a hunk are the same in both files, and every earlier hunk ends both sides in the same
//    state, so that is the old file's starting state too;
//  - the hunk is read again from that state (checkHunk), and every line of its new side must
//    start in the state the head file says it does, so a comment opened or closed mid-line, which
//    the line reading cannot see, is caught;
//  - a removed line must sit where the head file is in code or a block comment.
// Without the head file's text, or when it does not lex, the answer is runtime.
export function isCommentOnlyChange({ filename, status, patch }, headText) {
  if (!isScript(filename) || status === 'removed' || status === 'renamed')
    return false;
  const hunks = commentOnlyHunks(patch);
  if (!hunks || typeof headText !== 'string') return false;
  const states = lineStates(headText);
  if (!states) return false;
  const quiet = (s) => s === 'code' || s === 'block';
  for (const { newStart, lines } of hunks) {
    const first = states[newStart - 1];
    if (!quiet(first) || !lines.some((l) => l.kind !== '-')) return false;
    const r = checkHunk(lines, () => first === 'block');
    if (!r) return false;
    let next = newStart; // the head-file line number of the next context or added line
    let k = 0; // its index on the new side
    for (const { kind } of lines) {
      const state = states[next - 1];
      if (kind === '-') {
        // The head file's state where this line used to be: the start of its next line.
        if (!quiet(state)) return false;
        continue;
      }
      if (!quiet(state) || (state === 'block') !== r.newSide[k].start)
        return false;
      next++;
      k++;
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
