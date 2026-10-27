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
