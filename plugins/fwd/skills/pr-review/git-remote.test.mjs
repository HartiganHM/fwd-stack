// node --test git-remote.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  entryMatchesRepo,
  refPath,
  repoFromRemoteUrl,
  sameRepo,
} from './git-remote.mjs';

test('https and ssh remotes, with or without .git, name the same repository', () => {
  for (const url of [
    'https://github.com/O/r.js.git',
    'https://github.com/O/r.js',
    'git@github.com:O/r.js.git',
    'ssh://git@github.com/O/r.js.git\n',
    'ssh://git@github.com:22/O/r.js.git',
    'git@github-personal:O/r.js.git',
  ])
    assert.equal(repoFromRemoteUrl(url), 'O/r.js');
});

test('something that is not a remote URL names nothing', () => {
  assert.equal(repoFromRemoteUrl('not a url'), null);
  assert.equal(repoFromRemoteUrl(''), null);
});

test('repository names compare without case, and an unknown never matches', () => {
  assert.equal(sameRepo('HartiganHM/fwd-stack', 'hartiganhm/FWD-stack'), true);
  assert.equal(sameRepo('o/a', 'o/b'), false);
  assert.equal(sameRepo(null, 'o/a'), false);
});

test('a ledger row matches only its own repository, and legacy rows match any', () => {
  assert.equal(entryMatchesRepo({ repo: 'o/a' }, 'o/a'), true);
  assert.equal(entryMatchesRepo({ repo: 'o/a' }, 'o/b'), false);
  assert.equal(entryMatchesRepo({}, 'o/b'), true);
  assert.equal(entryMatchesRepo({ repo: 'o/a' }, null), true);
});

test('a branch name is encoded per segment for a REST path', () => {
  assert.equal(refPath('fix/#42'), 'fix/%2342');
  assert.equal(refPath('feat/a b?c'), 'feat/a%20b%3Fc');
  assert.equal(refPath('main'), 'main');
});
