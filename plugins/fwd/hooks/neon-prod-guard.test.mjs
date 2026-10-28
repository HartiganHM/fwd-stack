// node --test neon-prod-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('./neon-prod-guard.mjs', import.meta.url));
const run = (fwdJson, payload) => {
  const dir = mkdtempSync(join(tmpdir(), 'neon-hook-'));
  if (fwdJson !== undefined) writeFileSync(join(dir, 'fwd.json'), fwdJson);
  return execFileSync('node', [hook], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_PROJECT_DIR: '' },
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
};
const call = {
  tool_name: 'mcp__neon__run_sql',
  tool_input: { branch_id: 'br-dev', sql: 'delete from x' },
};

test('an unreadable fwd.json denies every Neon call', () => {
  const out = JSON.parse(run('{ not json', call));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(
    out.hookSpecificOutput.permissionDecisionReason,
    /not a readable JSON object/,
  );
});

test('no fwd.json leaves an unprotected branch free', () => {
  assert.equal(run(undefined, call), '');
});
