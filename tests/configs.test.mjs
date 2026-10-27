// Proves each shared config loads and does what it claims. A config that fails to import breaks
// every project that extends it, so the cheap check is worth having before anything is published.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

const read = (path) =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

for (const preset of ['base', 'node', 'next']) {
  test(`eslint preset ${preset} loads as a flat config array`, async () => {
    const { default: config } = await import(
      `@fwd-stack/eslint-config/${preset}`
    );
    assert.ok(Array.isArray(config));
    assert.ok(config.length > 0);
  });
}

test('the node preset reports an unused variable and allows an underscored one', async () => {
  const { default: config } = await import('@fwd-stack/eslint-config/node');
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: config,
  });
  const [result] = await eslint.lintText(
    'export const f = (_unused: number, used: number) => { const dead = 1; return used }\n',
    { filePath: 'example.ts' },
  );
  const ids = result.messages.map((message) => message.ruleId);
  assert.deepEqual(ids, ['@typescript-eslint/no-unused-vars']);
  assert.match(result.messages[0].message, /'dead'/);
});

test('the next preset applies the shared type-import rule', async () => {
  const { default: config } = await import('@fwd-stack/eslint-config/next');
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: config,
  });
  const [result] = await eslint.lintText(
    "import { Stats } from 'node:fs'\nexport const f = (stats: Stats) => stats.size\n",
    { filePath: 'example.ts' },
  );
  const ids = result.messages.map((message) => message.ruleId);
  assert.ok(
    ids.includes('@typescript-eslint/consistent-type-imports'),
    ids.join(', '),
  );
});

test('every tsconfig export resolves to a file that extends base or is base', () => {
  const pkg = read('packages/tsconfig/package.json');
  for (const target of new Set(Object.values(pkg.exports))) {
    const config = read(`packages/tsconfig/${target.slice(2)}`);
    if (target !== './base.json')
      assert.ok(config.extends, `${target} has no extends`);
    assert.ok(config.compilerOptions, `${target} has no compilerOptions`);
  }
});

test('the baseline pins Node to the same major as .nvmrc', () => {
  const baseline = read('baseline.json');
  const nvmrc = readFileSync(
    new URL('../.nvmrc', import.meta.url),
    'utf8',
  ).trim();
  assert.equal(baseline.node, nvmrc);
});

// Every preset must type-check a file on its own, with nothing added by the project. `base`
// once carried `resolveJsonModule` without a module resolution, which fails with TS5070 for any
// project that extends it directly.
for (const preset of ['base', 'strictest', 'nextjs', 'node']) {
  test(`tsconfig preset ${preset} type-checks a file with no overrides`, () => {
    const dir = mkdtempSync(join(tmpdir(), `fwd-stack-${preset}-`));
    try {
      writeFileSync(
        join(dir, 'index.ts'),
        'export const answer: number = 42;\n',
      );
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
          extends: fileURLToPath(
            new URL(`../packages/tsconfig/${preset}.json`, import.meta.url),
          ),
          compilerOptions: { noEmit: true, incremental: false, plugins: [] },
          include: ['index.ts'],
        }),
      );
      const result = spawnSync(process.execPath, [tsc, '-p', dir], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
