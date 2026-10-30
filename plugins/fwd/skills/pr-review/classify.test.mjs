// node --test classify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  commentOnlyHunks,
  isCommentOnlyChange,
  isDoc,
  isDocOnly,
  isDocOnlyChange,
  isGenerated,
  isToolingConfig,
  isVersionOnlyChange,
  lineStates,
  parsePatch,
} from './classify.mjs';

const handoff = [
  'design/design_handoff_app_nav_labels/README.md',
  'design/design_handoff_app_nav_labels/ShellFrame.dc.html',
  'design/design_handoff_app_nav_labels/art/hero-master.png',
  'design/design_handoff_app_nav_labels/support.js',
];

test('a design/-only handoff PR is doc-only', () => {
  assert.equal(isDocOnly(handoff), true);
});

test('a design/ plus src/ PR is not doc-only', () => {
  assert.equal(isDocOnly([...handoff, 'src/components/shell/nav.tsx']), false);
});

test('docs alone stay doc-only, and an empty file list is not', () => {
  assert.equal(isDocOnly(['docs/superpowers/plans/x.md', 'AGENTS.md']), true);
  assert.equal(isDocOnly([]), false);
});

test('configuration JSON is not documentation', () => {
  assert.equal(isDoc('package.json'), false);
  assert.equal(isDoc('plugins/fwd/hooks/hooks.json'), false);
  assert.equal(isDocOnly(['package.json', 'README.md']), false);
  assert.equal(isDoc('docs/data/table.json'), true);
});

test('migration snapshots and lockfiles are generated, source is not', () => {
  assert.equal(isGenerated('drizzle/meta/0178_snapshot.json'), true);
  assert.equal(isGenerated('packages/db/drizzle/meta/_journal.json'), true);
  assert.equal(isGenerated('pnpm-lock.yaml'), true);
  assert.equal(isGenerated('drizzle/0178_add_column.sql'), false);
  assert.equal(isGenerated('src/lib/meta/x.json'), false);
});

test('build configuration is tooling config, so a script-plus-config PR is a tooling PR', () => {
  for (const p of [
    'tsconfig.json',
    'packages/x/tsconfig.build.json',
    'package.json',
    'eslint.config.mjs',
    '.prettierrc.json',
    'vitest.config.ts',
    '.github/workflows/ci.yml',
  ])
    assert.equal(isToolingConfig(p), true, p);
  for (const p of [
    'src/app/page.tsx',
    'src/data/config.json',
    'scripts/check.mjs',
  ])
    assert.equal(isToolingConfig(p), false, p);
});

// ---- non-runtime changes ----------------------------------------------------
const mjs = (patch, extra = {}) => ({
  filename: 'plugins/fwd/skills/pr-review/pr-gate.mjs',
  status: 'modified',
  patch,
  ...extra,
});
// The head file a one-hunk patch implies: plain code above the hunk (ending in `above`, the lines
// just before it), then the hunk's new side, then one more line of code.
const headOf = (patch, above = []) => {
  const [hunk] = parsePatch(patch);
  const filler = Array.from(
    { length: hunk.newStart - 1 - above.length },
    (_, i) => `const f${i} = ${i};`,
  );
  const after = hunk.lines.filter((l) => l.kind !== '-').map((l) => l.text);
  return [...filler, ...above, ...after, 'const end = 0;'].join('\n');
};
const commentOnly = (patch, above) =>
  isCommentOnlyChange(mjs(patch), headOf(patch, above));

test('a hunk that only rewrites // comments is comment-only', () => {
  const patch = [
    '@@ -10,4 +10,4 @@ const x = 1;',
    ' const a = 1;',
    '-// the old `reason`',
    '+// the new `reason`, reworded',
    ' const b = 2;',
  ].join('\n');
  assert.ok(commentOnlyHunks(patch));
  assert.equal(commentOnly(patch), true);
});

test('block and JSDoc comments, and blank lines, are comment-only', () => {
  const opened = [
    '@@ -3,2 +3,6 @@',
    ' const a = 1;',
    '+',
    '+/**',
    '+ * Explains b.',
    '+ */',
    ' const b = 2;',
  ].join('\n');
  assert.equal(commentOnly(opened), true);
  // A hunk that starts inside a JSDoc block opened above it.
  const inside = [
    '@@ -3,3 +3,3 @@',
    ' * first line',
    '-* old second line',
    '+* new second line',
    ' */',
  ].join('\n');
  assert.equal(commentOnly(inside, ['/**']), true);
});

test('a star-led added line outside any block comment in the head file is runtime', () => {
  // The patch reads as the inside of a JSDoc block; the head file says it is code.
  const patch = [
    '@@ -3,3 +3,3 @@',
    ' * first line',
    '-* old second line',
    '+* new second line',
    ' */',
  ].join('\n');
  assert.ok(commentOnlyHunks(patch));
  assert.equal(commentOnly(patch, ['const x = a']), false);
});

test('any changed code line makes the file runtime', () => {
  const mixed = [
    '@@ -3,2 +3,3 @@',
    ' const a = 1;',
    '+// why b changes',
    '-const b = 2;',
    '+const b = 3;',
  ].join('\n');
  assert.equal(commentOnlyHunks(mixed), null);
  assert.equal(commentOnly(mixed), false);
  // Code after a block comment closes is code.
  const trailing = [
    '@@ -1,1 +1,2 @@',
    ' const a = 1;',
    '+/* note */ run();',
  ].join('\n');
  assert.equal(commentOnlyHunks(trailing), null);
  const closing = [
    '@@ -1,2 +1,3 @@',
    ' const a = 1;',
    '+/*',
    '+ note */ run();',
  ].join('\n');
  assert.equal(commentOnlyHunks(closing), null);
});

test('a removed comment opener never makes an added code line read as comment', () => {
  const patch = [
    '@@ -1,3 +1,3 @@',
    ' const a = 1;',
    '-/*',
    '+run();',
    ' */',
  ].join('\n');
  assert.equal(commentOnlyHunks(patch), null);
});

test('a star-led line is a comment only inside a block the hunk can see', () => {
  // `* b` continuing a multiplication, with no block comment in view.
  const patch = ['@@ -1,2 +1,2 @@', ' const x = a', '-  * b;', '+  * c;'].join(
    '\n',
  );
  assert.equal(commentOnlyHunks(patch), null);
  // A regex holding `*/` does not open the hunk as if inside a block.
  const regex = [
    '@@ -1,3 +1,3 @@',
    '-* not a comment',
    '+* still not',
    ' const re = /a*/;',
  ].join('\n');
  assert.equal(commentOnlyHunks(regex), null);
});

test('a // line inside a template literal opened above the hunk is runtime', () => {
  const head = [
    'const a = 1;',
    'const script = `',
    '  line one',
    '  line two',
    '  line three',
    '  // generated',
    '  line five',
    '`;',
  ].join('\n');
  const patch = [
    '@@ -3,5 +3,5 @@',
    '   line one',
    '   line two',
    '   line three',
    '-  // old',
    '+  // generated',
    '   line five',
  ].join('\n');
  assert.ok(commentOnlyHunks(patch), 'the patch alone cannot see the template');
  assert.equal(isCommentOnlyChange(mjs(patch), head), false);
  // A removed line there is the template's text too.
  const removed = [
    '@@ -3,5 +3,4 @@',
    '   line one',
    '   line two',
    '   line three',
    '-  // old',
    '   line five',
  ].join('\n');
  assert.equal(isCommentOnlyChange(mjs(removed), head), false);
});

test('a regex holding a backtick does not open a template for the lines after it', () => {
  // The shape that broke a plain backtick count on this folder's own gate.
  const patch = [
    '@@ -3,3 +3,3 @@',
    " const t = s.replace(/`/g, '');",
    '-// old note',
    '+// new note',
    ' const b = 2;',
  ].join('\n');
  assert.equal(commentOnly(patch), true);
});

test('a changed comment with an odd number of backticks, or a ${, is runtime', () => {
  const odd = ['@@ -1,1 +1,2 @@', ' const a = 1;', '+// a lone ` here'].join(
    '\n',
  );
  assert.equal(commentOnlyHunks(odd), null);
  const expr = ['@@ -1,1 +1,2 @@', ' const a = 1;', '+// ${x} here'].join('\n');
  assert.equal(commentOnlyHunks(expr), null);
});

test('without the head file, a missing patch, or a non-script, the answer is runtime', () => {
  const patch = ['@@ -1,1 +1,2 @@', ' const a = 1;', '+// note'].join('\n');
  const head = headOf(patch);
  assert.equal(isCommentOnlyChange(mjs(patch), head), true);
  assert.equal(isCommentOnlyChange(mjs(patch), null), false);
  assert.equal(isCommentOnlyChange(mjs(undefined), head), false);
  assert.equal(
    isCommentOnlyChange(mjs(patch, { status: 'removed' }), head),
    false,
  );
  assert.equal(
    isCommentOnlyChange(mjs(patch, { status: 'renamed' }), head),
    false,
  );
  for (const filename of ['scripts/run.sh', 'src/app/page.tsx', 'src/x.jsx'])
    assert.equal(isCommentOnlyChange(mjs(patch, { filename }), head), false);
  // A head file the lexer cannot read is runtime.
  assert.equal(
    isCommentOnlyChange(mjs(patch), "const a = 'open\n// note"),
    false,
  );
  assert.equal(parsePatch('not a diff'), null);
});

test('lineStates places each line in code, a block comment, a template or a continued string', () => {
  assert.deepEqual(
    lineStates(
      [
        'const a = `x ${f({',
        '  b: `y`,',
        '})} z',
        'w`;',
        '/*',
        ' * c',
        ' */',
        "const s = 'a\\",
        "b';",
        'return /[/`]/.test(s) / 2;',
      ].join('\n'),
    ),
    [
      'code',
      'code', // inside `${`, which is code
      'code',
      'template', // after `})}` closed the `${`
      'code',
      'block',
      'block',
      'code',
      'string',
      'code',
    ],
  );
  // Unbalanced, or a quote or regex left open at a line end: unreadable.
  assert.equal(lineStates('const a = `open'), null);
  assert.equal(lineStates('}'), null);
  assert.equal(lineStates('const re = /open\n/;'), null);
  assert.equal(lineStates('/* open'), null);
});

const json = (filename, lines, status = 'modified') => ({
  filename,
  status,
  patch: ['@@ -1,5 +1,5 @@', ' {', '   "name": "fwd",', ...lines, ' }'].join(
    '\n',
  ),
});

test('a top-level version bump in plugin.json or package.json is non-runtime', () => {
  const bump = ['-  "version": "0.1.6",', '+  "version": "0.1.7",'];
  assert.equal(
    isVersionOnlyChange(json('plugins/fwd/.claude-plugin/plugin.json', bump)),
    true,
  );
  assert.equal(isVersionOnlyChange(json('package.json', bump)), true);
  assert.equal(
    isVersionOnlyChange(
      json('package.json', [
        '-\t"version": "1.0.0",',
        '+\t"version": "1.0.1",',
      ]),
    ),
    true,
  );
});

test('a version bump beside any other change, or a nested version, is runtime', () => {
  assert.equal(
    isVersionOnlyChange(
      json('package.json', [
        '-  "version": "0.1.6",',
        '+  "version": "0.1.7",',
        '+  "main": "index.js",',
      ]),
    ),
    false,
  );
  assert.equal(
    isVersionOnlyChange(
      json('package.json', ['-    "version": "1",', '+    "version": "2",']),
    ),
    false,
  );
  assert.equal(
    isVersionOnlyChange(
      json('tsconfig.json', ['-  "version": "1",', '+  "version": "2",']),
    ),
    false,
  );
  assert.equal(
    isVersionOnlyChange(json('package.json', ['+  "version": "1",'], 'added')),
    false,
  );
});

test('a doc PR with a comment-only script and a version bump is doc-only; with code it is not', () => {
  const files = [
    { filename: 'README.md' },
    { filename: 'plugins/fwd/skills/pr-review/pr-gate.mjs' },
    { filename: 'plugins/fwd/.claude-plugin/plugin.json' },
  ];
  const proven = new Set([
    'plugins/fwd/skills/pr-review/pr-gate.mjs',
    'plugins/fwd/.claude-plugin/plugin.json',
  ]);
  assert.equal(isDocOnlyChange(files, proven), true);
  assert.equal(
    isDocOnlyChange(files, new Set(['plugins/fwd/.claude-plugin/plugin.json'])),
    false,
  );
  assert.equal(isDocOnlyChange([], new Set()), false);
});

test('a block-comment delimiter added or removed around unchanged code is runtime', () => {
  // `/*` and `*/` added around `run();`: every changed line is a comment, the code is now one.
  const disabled = [
    '@@ -1,3 +1,5 @@',
    ' const a = 1;',
    '+/*',
    ' run();',
    '+*/',
    ' const b = 2;',
  ].join('\n');
  assert.equal(commentOnlyHunks(disabled), null);
  // The reverse: removing them brings the code back.
  const enabled = [
    '@@ -1,5 +1,3 @@',
    ' const a = 1;',
    '-/*',
    ' run();',
    '-*/',
    ' const b = 2;',
  ].join('\n');
  assert.equal(commentOnlyHunks(enabled), null);
  // An opener at the end of a hunk, with no line after it, comments out what follows the hunk.
  const trailingOpen = ['@@ -1,1 +1,2 @@', ' const a = 1;', '+/*'].join('\n');
  assert.equal(commentOnlyHunks(trailingOpen), null);
  // A whole JSDoc block added between two lines of code changes nothing around it.
  const jsdoc = [
    '@@ -1,2 +1,5 @@',
    ' const a = 1;',
    '+/**',
    '+ * b',
    '+ */',
    ' const b = 2;',
  ].join('\n');
  assert.ok(commentOnlyHunks(jsdoc));
});

test('a // */ inside a block comment opened above the hunk is runtime', () => {
  // A plain block comment, no JSDoc stars, opened above the hunk: `// */` would close it and
  // bring `run();` back as code.
  const patch = [
    '@@ -3,3 +3,3 @@',
    ' notes about the old code',
    '-// old',
    '+// */',
    ' run();',
  ].join('\n');
  const head = [
    'const a = 1;',
    '/*',
    ' notes about the old code',
    ' // */',
    ' run();',
    '// */',
    'const b = 2;',
  ].join('\n');
  assert.equal(isCommentOnlyChange(mjs(patch), head), false);
});

test('a block comment opened mid-line above the hunk is read from the head file', () => {
  // The patch reads `x(); /* start` as code; the head file knows a block is open after it.
  const patch = [
    '@@ -1,3 +1,3 @@',
    ' x(); /* start',
    '-  old words',
    '+  new words',
    ' end */',
  ].join('\n');
  assert.equal(
    commentOnlyHunks(patch),
    null,
    'the patch reads the words as code',
  );
  const comment = [
    '@@ -1,3 +1,3 @@',
    ' x(); /* start',
    '-// old',
    '+// new',
    ' y();',
  ].join('\n');
  // The patch alone thinks `y();` is code; the head file says it sits in the open block, so the
  // hunk does not read the way the patch claims and the answer is runtime.
  assert.ok(commentOnlyHunks(comment));
  const head = ['x(); /* start', '// new', 'y();', '*/', 'const b = 2;'].join(
    '\n',
  );
  assert.equal(isCommentOnlyChange(mjs(comment), head), false);
});

test('a slash after ) that could be a regex hiding a backtick or quote makes the file unreadable', () => {
  assert.equal(lineStates("if (true) /`/.test('');\nconst a = 1;"), null);
  // Plain division after a parenthesis still reads.
  assert.deepEqual(lineStates('const a = (b + c) / 2;\nconst d = 1;'), [
    'code',
    'code',
  ]);
});

test('a carriage return, U+2028 or U+2029 in the patch or the head file is runtime', () => {
  for (const sep of ['\r', ' ', ' ']) {
    const patch = [
      '@@ -1,1 +1,2 @@',
      ' const a = 1;',
      `+// note${sep}run();`,
    ].join('\n');
    assert.equal(commentOnlyHunks(patch), null, JSON.stringify(sep));
  }
  const patch = ['@@ -1,1 +1,2 @@', ' const a = 1;', '+// note'].join('\n');
  assert.equal(
    isCommentOnlyChange(mjs(patch), 'const a = 1;\n// note\rrun();\n'),
    false,
  );
});
