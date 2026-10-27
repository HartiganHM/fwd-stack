#!/usr/bin/env node
// Autonomous-run guard.
//
// THE PROBLEM IT SOLVES: a turn ends whenever the model stops emitting tool calls.
// "Work autonomously, don't stop" is a prompt-level instruction with no enforcement —
// so an agent can intend to continue and still stop, because stopping is the harness's
// default state rather than an action anyone takes. Runs died silently that way: a
// milestone got reported, nothing was in flight to re-invoke the model, and hours passed.
//
// It also covers the second failure: a background command that dies without notifying.
// The wake signal never arrives, and the silence is indistinguishable from progress.
// This hook kicks the session instead of letting it sit.
//
// HOW: on Stop, if this session has an armed sentinel, return decision:"block" with the
// run's own reason. The model is re-invoked and re-reads its state.
//
// THREE RAILS, because a hook that can refuse to stop can also trap a session:
//   1. Opt-in per session — nothing happens without an armed sentinel for THIS session_id.
//   2. Wall-clock expiry — an armed run stops being armed on its own.
//   3. A continuation cap — counted per session, never reset by the hook.
// Any one of them firing disarms the run and allows the stop.
//
// CLI: arm <reason> [--minutes N] [--max N] | disarm | status   (session id via $1 or env)

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

// State lives in the Claude config folder, not beside this script: an installed plugin's folder is
// replaced on every update, and a sentinel lost mid-run is a run that silently stops.
const DIR = join(
  process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
  'autonomous',
);
const SELF = fileURLToPath(import.meta.url);
const file = (sid) =>
  join(DIR, `${String(sid).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

const read = (sid) => {
  try {
    return JSON.parse(readFileSync(file(sid), 'utf8'));
  } catch {
    return null;
  }
};
const write = (sid, state) => {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file(sid), JSON.stringify(state, null, 2));
};
const clear = (sid) => {
  try {
    rmSync(file(sid));
  } catch {
    // Already gone.
  }
};

const [cmd, ...rest] = process.argv.slice(2);

// ---- CLI surface, for the agent to arm and disarm its own run -------------------
if (cmd === 'arm' || cmd === 'disarm' || cmd === 'status') {
  const sid =
    process.env.CLAUDE_SESSION_ID ||
    rest.find((a) => a.startsWith('--session='))?.slice(10);
  if (!sid) {
    console.error(
      'no session id: pass --session=<id> or set CLAUDE_SESSION_ID',
    );
    process.exit(2);
  }
  if (cmd === 'disarm') {
    clear(sid);
    console.log('disarmed');
    process.exit(0);
  }
  if (cmd === 'status') {
    console.log(JSON.stringify(read(sid) ?? { armed: false }, null, 2));
    process.exit(0);
  }
  const arg = (flag, dflt) => {
    const hit = rest.find((a) => a.startsWith(`--${flag}=`));
    return hit ? Number(hit.split('=')[1]) : dflt;
  };
  const minutes = arg('minutes', 120);
  const max = arg('max', 40);
  const reason =
    rest.filter((a) => !a.startsWith('--')).join(' ') ||
    'Autonomous run in progress.';
  write(sid, {
    armed: true,
    reason,
    count: 0,
    max,
    expiresAt: Date.now() + minutes * 60_000,
  });
  console.log(`armed for ${minutes}m, max ${max} continuations`);
  process.exit(0);
}

// ---- Hook path: stdin is the Stop payload ---------------------------------------
let raw = '';
try {
  raw = readFileSync(0, 'utf8');
} catch {
  // No stdin: not a hook call.
}
let payload = {};
try {
  payload = JSON.parse(raw || '{}');
} catch {
  // Unreadable payload: behave as an ordinary session.
}
const sid = payload.session_id;

// No session id, or no sentinel for it: this is an ordinary session. Say nothing.
if (!sid) process.exit(0);
const state = read(sid);
if (!state?.armed) process.exit(0);

// A run that has already been told to stop once does not get to block again on the
// same stop — `stop_hook_active` is the harness telling us we are in a continuation
// it already granted.
if (payload.stop_hook_active) process.exit(0);

const disarm = (why) => {
  clear(sid);
  console.log(
    JSON.stringify({ systemMessage: `Autonomous guard released: ${why}` }),
  );
  process.exit(0);
};

if (Date.now() > state.expiresAt) disarm("the run's time window expired");
if (state.count >= state.max) disarm(`hit its ${state.max}-continuation cap`);

state.count += 1;
write(sid, state);

// Kept to ONE short line on purpose: the harness prints the reason in the terminal on every
// block, and the full run description plus instructions made each idle wake a paragraph of
// noise (2026-09-28). The run's own description is still on disk (`status`), and the
// line below is enough to act on. `suppressOutput` hides what the harness allows it to.
const left = state.max - state.count;
console.log(
  JSON.stringify({
    decision: 'block',
    suppressOutput: true,
    reason:
      `Autonomous run armed (${left} left): take the next action, or disarm ` +
      `(\`node "${SELF}" disarm --session=${sid}\`) if the run is done. ` +
      `Run: ${state.reason.slice(0, 80)}${state.reason.length > 80 ? '…' : ''}`,
  }),
);
