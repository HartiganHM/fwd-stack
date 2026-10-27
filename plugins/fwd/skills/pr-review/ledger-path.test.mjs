// node --test ledger-path.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ledgerPath } from './ledger-path.mjs';

const home = '/home/u';
const none = () => false;
const only = (path) => (p) => p === path;

test('an explicit override wins', () => {
  assert.equal(
    ledgerPath({ FWD_PRECHECK_LEDGER: '/x/l.json' }, home, none),
    '/x/l.json',
  );
});

test("a hook's CLAUDE_PLUGIN_DATA is used as given", () => {
  assert.equal(
    ledgerPath({ CLAUDE_PLUGIN_DATA: '/d' }, home, none),
    '/d/precheck-ledger.json',
  );
});

test('without CLAUDE_PLUGIN_DATA (the Bash tool) the documented data folder is derived', () => {
  assert.equal(
    ledgerPath({}, home, none),
    '/home/u/.claude/plugins/data/fwd-fwd-stack/precheck-ledger.json',
  );
});

test('CLAUDE_CONFIG_DIR moves both the data folder and the old location', () => {
  const env = { CLAUDE_CONFIG_DIR: '/cfg' };
  assert.equal(
    ledgerPath(env, home, none),
    '/cfg/plugins/data/fwd-fwd-stack/precheck-ledger.json',
  );
  const legacy = '/cfg/skills/pr-review/precheck-ledger.json';
  assert.equal(ledgerPath(env, home, only(legacy)), legacy);
});

test('a ledger still at the old skill location is read until it is moved', () => {
  const legacy = '/home/u/.claude/skills/pr-review/precheck-ledger.json';
  assert.equal(ledgerPath({}, home, only(legacy)), legacy);
});

test('once the ledger exists in the data folder, the old location is ignored', () => {
  const current =
    '/home/u/.claude/plugins/data/fwd-fwd-stack/precheck-ledger.json';
  const both = (p) =>
    p === current || p.endsWith('/skills/pr-review/precheck-ledger.json');
  assert.equal(ledgerPath({}, home, both), current);
});
