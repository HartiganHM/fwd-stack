import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { awayUntil, clearAway, setAway } from './away.mjs';

const env = () => ({
  CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'away-')),
});

test('a window is open until it expires, then the user is present', () => {
  const e = env();
  assert.equal(awayUntil(e), null);
  const until = setAway(10, e, 1_000);
  assert.equal(until, 1_000 + 10 * 3_600_000);
  assert.equal(awayUntil(e, until - 1), until);
  assert.equal(awayUntil(e, until), null);
});

test('clearing the window marks the user present', () => {
  const e = env();
  setAway(8, e);
  clearAway(e);
  assert.equal(awayUntil(e), null);
});

test('a window needs a positive length', () => {
  assert.throws(() => setAway(0, env()), /positive/);
  assert.throws(() => setAway(Number('x'), env()), /positive/);
});

test('extending a window replaces it and leaves no temporary file behind', () => {
  const e = env();
  setAway(1, e, 0);
  const until = setAway(10, e, 0);
  assert.equal(awayUntil(e, 1), until);
  assert.deepEqual(readdirSync(e.CLAUDE_PLUGIN_DATA), ['away.json']);
});
