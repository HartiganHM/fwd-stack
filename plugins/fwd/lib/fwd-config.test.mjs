// node --test fwd-config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig, mergeConfig } from './fwd-config.mjs';

const files = (map) => (path) => map[path] ?? {};

test('the project file wins over the machine file, key by key', () => {
  assert.deepEqual(
    mergeConfig(
      { sessionBudget: { warn: 20, critical: 35 }, ownApp: false },
      { sessionBudget: { warn: 30 }, ownApp: true },
    ),
    { sessionBudget: { warn: 30, critical: 35 }, ownApp: true },
  );
});

test('protected Neon branches are a union a project cannot narrow', () => {
  const cfg = loadConfig(
    { CLAUDE_PROJECT_DIR: '/p' },
    '/h',
    files({
      '/h/.claude/fwd.json': { neon: { protected: { 'br-a': 'production' } } },
      '/p/.claude/fwd.json': { neon: { protected: { 'br-b': 'staging' } } },
    }),
  );
  assert.deepEqual(cfg.neon.protected, {
    'br-a': 'production',
    'br-b': 'staging',
  });
});

test('CLAUDE_CONFIG_DIR moves the machine file, and no files is an empty config', () => {
  const cfg = loadConfig(
    { CLAUDE_CONFIG_DIR: '/cfg' },
    '/h',
    files({ '/cfg/fwd.json': { ownApp: true } }),
  );
  assert.equal(cfg.ownApp, true);
  assert.deepEqual(loadConfig({}, '/h', files({})).neon.protected, {});
});

test('a project cannot wipe the machine list by setting it to null or []', () => {
  for (const wiped of [null, [], 'none'])
    assert.deepEqual(
      loadConfig(
        { CLAUDE_PROJECT_DIR: '/p' },
        '/h',
        files({
          '/h/.claude/fwd.json': {
            neon: { protected: { 'br-a': 'production' } },
          },
          '/p/.claude/fwd.json': { neon: { protected: wiped } },
        }),
      ).neon.protected,
      { 'br-a': 'production' },
    );
});

test('a project file that is valid JSON but not an object keeps the machine list', () => {
  for (const project of [null, 7, 'x', []])
    assert.deepEqual(
      loadConfig({ CLAUDE_PROJECT_DIR: '/p' }, '/h', (path) =>
        path === '/p/.claude/fwd.json'
          ? project
          : { neon: { protected: { 'br-a': 'production' } } },
      ).neon.protected,
      { 'br-a': 'production' },
    );
});

test('a file that exists but is not a JSON object is reported, and the rest still loads', () => {
  const cfg = loadConfig({ CLAUDE_PROJECT_DIR: '/p' }, '/h', (path) => {
    if (path === '/p/.claude/fwd.json') throw new SyntaxError('bad json');
    return { neon: { protected: { 'br-a': 'production' } } };
  });
  assert.deepEqual(cfg.invalid, ['/p/.claude/fwd.json']);
  assert.deepEqual(cfg.neon.protected, { 'br-a': 'production' });
  assert.deepEqual(loadConfig({}, '/h', () => ({})).invalid, []);
});

test('a project names a read-only role only when the machine has none', () => {
  const machine = { neon: { readOnlyRole: 'machine_reader' } };
  const cfg = (project) =>
    loadConfig({ CLAUDE_PROJECT_DIR: '/p' }, '/h', (path) =>
      path === '/p/.claude/fwd.json' ? project : machine,
    ).neon.readOnlyRole;
  // A project cannot replace the machine's role, with a writer or anything else.
  assert.equal(
    cfg({ neon: { readOnlyRole: 'neondb_owner' } }),
    'machine_reader',
  );
  for (const cleared of [null, '', 0])
    assert.equal(cfg({ neon: { readOnlyRole: cleared } }), 'machine_reader');
  assert.equal(loadConfig({}, '/h', () => ({})).neon.readOnlyRole, undefined);
  assert.equal(
    loadConfig({ CLAUDE_PROJECT_DIR: '/p' }, '/h', (path) =>
      path === '/p/.claude/fwd.json'
        ? { neon: { readOnlyRole: 'app_reader' } }
        : {},
    ).neon.readOnlyRole,
    'app_reader',
  );
});
