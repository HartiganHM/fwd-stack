// node --test neon-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { neonDecision } from './neon-guard.mjs';

const prod = { 'br-prod': 'production', 'ep-prod': "production's compute" };

test('reads on a protected branch are allowed', () => {
  assert.equal(
    neonDecision('list_branches', { branch_id: 'br-prod' }, prod),
    null,
  );
  assert.equal(
    neonDecision('run_sql', { branch_id: 'br-prod', sql: 'select 1' }, prod),
    null,
  );
  assert.equal(
    neonDecision(
      'run_sql',
      { branch_id: 'br-prod', sql: "select 'drop table x'" },
      prod,
    ),
    null,
  );
});

test('writes on a protected branch or endpoint are denied', () => {
  assert.match(
    neonDecision(
      'run_sql',
      { branch_id: 'br-prod', sql: 'delete from x' },
      prod,
    ),
    /one read statement/,
  );
  assert.match(
    neonDecision(
      'run_sql',
      { branch_id: 'br-prod', sql: 'select 1; drop table x' },
      prod,
    ),
    /one read statement/,
  );
  assert.match(
    neonDecision('restart_postgres_endpoint', { endpoint_id: 'ep-prod' }, prod),
    /not a read/,
  );
  assert.match(
    neonDecision(
      'explain_sql_statement',
      { branch_id: 'br-prod', analyze: true },
      prod,
    ),
    /EXPLAIN ANALYZE/,
  );
  assert.match(
    neonDecision('get_connection_string', { branch_id: 'br-prod' }, prod),
    /password/,
  );
});

test('a call naming no branch is treated as production', () => {
  assert.match(
    neonDecision('run_sql', { sql: 'delete from x' }, {}),
    /default branch/,
  );
  assert.match(neonDecision('create_branch', {}, {}), /default branch/);
});

test('an unprotected branch is free, and some tools are always blocked', () => {
  assert.equal(
    neonDecision(
      'run_sql',
      { branch_id: 'br-scratch', sql: 'delete from x' },
      prod,
    ),
    null,
  );
  assert.match(neonDecision('restore_snapshot', {}, {}), /live branch/);
});

test('a -- inside a string literal does not hide what follows', () => {
  assert.match(
    neonDecision(
      'run_sql',
      { branch_id: 'br-prod', sql: "select '--'; drop table x" },
      prod,
    ),
    /one read statement/,
  );
});

test('a SELECT that writes or acts is not a read', () => {
  for (const sql of [
    'select * into evil from users',
    "select setval('s', 1)",
    'select pg_terminate_backend(1)',
  ])
    assert.match(
      neonDecision('run_sql', { branch_id: 'br-prod', sql }, prod),
      /one read statement/,
      sql,
    );
});

test('a branch named rather than given by id is still protected', () => {
  const byName = { production: 'production', main: 'production' };
  assert.match(
    neonDecision('get_connection_string', { branch_id: 'production' }, byName),
    /password/,
  );
  assert.match(
    neonDecision(
      'run_sql',
      { branch_id: 'main', sql: 'delete from x' },
      byName,
    ),
    /one read statement/,
  );
  assert.equal(
    neonDecision(
      'run_sql',
      { branch_id: 'br-domain-x', sql: 'delete from x' },
      byName,
    ),
    null,
  );
});

test('query tuning with no branch, and the Realtime secret, are guarded', () => {
  assert.match(
    neonDecision(
      'complete_query_tuning',
      { suggested_sql_statements: ['create index i on t(c)'] },
      {},
    ),
    /default branch/,
  );
  assert.match(
    neonDecision('get_realtime_secret', { branch_id: 'br-prod' }, prod),
    /exposes/,
  );
});

test('run_sql with quoting or comments the guard cannot read is denied', () => {
  for (const sql of [
    `select "setval"('s', 1)`,
    'select $$--$$; drop table users',
    'select 1 /* a /* nested */ ; drop table x */',
    "select E'\\'; drop table x --'",
  ])
    assert.match(
      neonDecision('run_sql', { branch_id: 'br-prod', sql }, prod),
      /cannot read/,
      sql,
    );
  assert.equal(
    neonDecision(
      'run_sql',
      { branch_id: 'br-prod', sql: "select 'a' -- note" },
      prod,
    ),
    null,
  );
});

test('a protected id stays protected whatever its label', () => {
  for (const label of [null, '', 0, false, { toString: null }])
    assert.match(
      neonDecision(
        'run_sql',
        { branch_id: 'br-prod', sql: 'delete from users' },
        { 'br-prod': label },
      ),
      /br-prod/,
      JSON.stringify(label),
    );
});

test('a line comment ends at CR, so a statement after it is seen', () => {
  assert.match(
    neonDecision(
      'run_sql',
      { branch_id: 'br-prod', sql: 'select 1 -- note\r; drop table users' },
      prod,
    ),
    /one read statement/,
  );
});

test('only read-only builtins may be called on a protected branch', () => {
  for (const sql of [
    "select pg_notify('jobs', 'run')",
    'select app.purge_everything()',
    "select nextval('s')",
  ])
    assert.match(
      neonDecision('run_sql', { branch_id: 'br-prod', sql }, prod),
      /one read statement/,
      sql,
    );
  for (const sql of [
    'select count(*), max(created_at) from users where id in (1, 2)',
    'with t as (select lower(name) from x) select * from t',
    'select exists (select 1 from x)',
  ])
    assert.equal(
      neonDecision('run_sql', { branch_id: 'br-prod', sql }, prod),
      null,
      sql,
    );
});

test('a call is checked by its whole identifier', () => {
  for (const sql of [
    "select app.lower('x')",
    "select app. lower('x')",
    "select app . lower('x')",
    "select app. -- c\n lower('x')",
    "select \u00e9lower('x')",
  ])
    assert.match(
      neonDecision('run_sql', { branch_id: 'br-prod', sql }, prod),
      /one read statement/,
      sql,
    );
  assert.equal(
    neonDecision(
      'run_sql',
      {
        branch_id: 'br-prod',
        sql: "select pg_catalog.lower('x'), 'caf\u00e9'",
      },
      prod,
    ),
    null,
  );
});

test('the Realtime secret with no branch is read from production, so it is denied', () => {
  assert.match(neonDecision('get_realtime_secret', {}, prod), /exposes/);
});

test('row-locking reads are not reads', () => {
  for (const sql of [
    'select * from users for share',
    'select * from users for key share',
    'select * from users for no key update',
  ])
    assert.match(
      neonDecision('run_sql', { branch_id: 'br-prod', sql }, prod),
      /one read statement/,
      sql,
    );
});

test('a mapped protected branch must be read through its read-only compute', () => {
  const opts = { readOnlyCompute: { 'br-prod': 'ep-ro' } };
  const read = { branch_id: 'br-prod', sql: 'select 1' };
  assert.match(neonDecision('run_sql', read, prod, opts), /compute_id "ep-ro"/);
  assert.match(
    neonDecision('run_sql', { ...read, compute_id: 'ep-prod' }, prod, opts),
    /read-only compute/,
  );
  assert.equal(
    neonDecision('run_sql', { ...read, compute_id: 'ep-ro' }, prod, opts),
    null,
  );
  // The compute does not relax the text checks.
  assert.match(
    neonDecision(
      'run_sql',
      { branch_id: 'br-prod', compute_id: 'ep-ro', sql: 'delete from x' },
      prod,
      opts,
    ),
    /one read statement/,
  );
  // With computes mapped, a protected run_sql that cannot be matched to one is denied: no branch,
  // a branch named by an alias, a call naming only an endpoint, or an unmapped protected branch.
  for (const args of [
    { sql: 'select 1' },
    { branch_id: 'main', sql: 'select 1' },
    { endpoint_id: 'ep-other', sql: 'select 1' },
    { compute_id: 'ep-ro', sql: 'select 1' },
  ])
    assert.match(
      neonDecision('run_sql', args, { ...prod, main: 'production' }, opts),
      /read-only compute/,
      JSON.stringify(args),
    );
  assert.match(
    neonDecision(
      'run_sql',
      { branch_id: 'br-stage', sql: 'select 1' },
      { 'br-stage': 'staging' },
      opts,
    ),
    /read-only compute/,
  );
  // An unprotected branch is not affected.
  assert.equal(
    neonDecision(
      'run_sql',
      { branch_id: 'br-dev', sql: 'delete from x' },
      prod,
      opts,
    ),
    null,
  );
  // Recovery and settings reads are allowed.
  assert.equal(
    neonDecision(
      'run_sql',
      {
        ...read,
        compute_id: 'ep-ro',
        sql: "select pg_is_in_recovery(), current_setting('transaction_read_only')",
      },
      prod,
      opts,
    ),
    null,
  );
});
