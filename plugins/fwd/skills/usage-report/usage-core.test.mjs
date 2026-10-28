// node --test usage-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { projectOf, render, tally, weigh } from './usage-core.mjs';

test('weights follow the price ratios', () => {
  assert.equal(
    weigh({
      input_tokens: 10,
      cache_creation_input_tokens: 4,
      cache_read_input_tokens: 100,
      output_tokens: 2,
    }),
    10 + 5 + 10 + 10,
  );
});

test('a worktree counts as its repository', () => {
  assert.equal(projectOf('/h/P/app/.worktrees/feat-x/src', '/h'), '~/P/app');
  assert.equal(projectOf('/h/P/app/.claude/worktrees/w', '/h'), '~/P/app');
  assert.equal(projectOf('/h/P/app', '/h'), '~/P/app');
});

const turn = (
  id,
  {
    session = 's1',
    cwd = '/h/P/a',
    side = false,
    out = 10,
    read = 1000,
    at = '2026-10-28T10:00:00Z',
    model = 'claude-opus-5-5',
  } = {},
) =>
  JSON.stringify({
    type: 'assistant',
    sessionId: session,
    cwd,
    isSidechain: side,
    timestamp: at,
    requestId: 'r' + id,
    message: {
      id,
      model,
      usage: {
        input_tokens: 0,
        cache_read_input_tokens: read,
        output_tokens: out,
      },
    },
  });

test('a turn written as several lines counts once; old turns and other lines are skipped', () => {
  const acc = tally(
    [
      turn('a'),
      turn('a'),
      turn('b'),
      turn('old', { at: '2020-01-01T00:00:00Z' }),
      '{"type":"user"}',
      '{"type":"assis',
    ],
    { since: Date.parse('2026-10-01'), home: '/h' },
  );
  assert.equal(acc.total, 2 * (10 * 5 + 1000 * 0.1));
  assert.equal(acc.sessions.get('s1').turns, 2);
});

test('splits by project, model and side, and names sessions', () => {
  const acc = tally(
    [
      JSON.stringify({
        type: 'agent-name',
        sessionId: 's1',
        agentName: 'lane-a',
      }),
      turn('a'),
      turn('b', {
        session: 's2',
        cwd: '/h/P/b/.worktrees/x',
        model: 'claude-sonnet-5-5',
      }),
      turn('c', { side: true }),
    ],
    { home: '/h' },
  );
  assert.deepEqual([...acc.byProject.keys()].sort(), ['~/P/a', '~/P/b']);
  assert.ok(acc.bySide.get('subagent') > 0);
  assert.equal(
    acc.sessions.get('s1').turns,
    1,
    'a subagent turn does not deepen its session',
  );
  const md = render(acc, { days: 7 });
  assert.match(md, /\| lane-a \| ~\/P\/a \|/);
  assert.match(md, /sonnet-5-5/);
});

test('a turn whose later lines raise its output count counts once, at the largest reading', () => {
  const line = (out) =>
    JSON.stringify({
      type: 'assistant',
      sessionId: 's',
      cwd: '/h/P/a',
      timestamp: '2026-10-28T10:00:00Z',
      requestId: 'r',
      message: { id: 'm', usage: { input_tokens: 100, output_tokens: out } },
    });
  const acc = tally([line(1), line(1000), line(1000), line(5)], { home: '/h' });
  assert.equal(acc.total, 100 + 1000 * 5);
  assert.equal(acc.sessions.get('s').turns, 1);
  assert.equal(acc.sessions.get('s').weight, 5100);
});
