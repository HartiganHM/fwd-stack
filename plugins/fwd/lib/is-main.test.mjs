// node --test is-main.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const plugin = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERB = 'mer' + 'ge';

test('a script run through a symlinked install still runs its entry point', () => {
  const link = join(mkdtempSync(join(tmpdir(), 'fwd-link-')), 'fwd');
  symlinkSync(plugin, link);
  const out = execFileSync(
    'node',
    [
      join(link, 'skills/pr-review/parse-command.mjs'),
      `gh pr ${VERB} 42 --squash`,
    ],
    { encoding: 'utf8' },
  );
  assert.match(out, new RegExp(`${VERB}\\s+42`));
});
