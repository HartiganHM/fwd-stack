#!/usr/bin/env node
// Warn as a session's context grows. Every turn re-reads the whole context, so the cost of a turn
// rises with its size: a turn at 300k tokens costs about ten times one at 30k. The size is read
// from the last turn's usage in the transcript, not counted in turns.
//
// Two events run it:
//   UserPromptSubmit: on every prompt over the warning line. The text goes into the model's context,
//     not onto the user's screen, so it tells the model what to suggest.
//   PostToolUse: once per band crossed (the warning line, the critical line, then every 100k
//     above it), so a session running unattended, which sees no user prompt for hours, is told too.
//
// Lines: `sessionBudget.warnTokens` (default 150k) and `orchestrator.rotateAt` (default 300k),
// the same line the orchestrator rotates lanes at.
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { isMain } from '../lib/is-main.mjs';
import { loadConfig } from '../lib/fwd-config.mjs';
import { pluginDataDir } from '../lib/plugin-data.mjs';
import { sessionSummary } from '../skills/orchestrator/lane-core.mjs';

const STEP = 100_000;

export function lines(config = {}) {
  return {
    warn: config.sessionBudget?.warnTokens ?? 150_000,
    critical: config.orchestrator?.rotateAt ?? 300_000,
  };
}

// 0 below the warning line, 1 between the lines, then 2, 3, … for each 100k past the critical line.
export function band(context, { warn, critical }) {
  if (context === null || context < warn) return 0;
  if (context < critical) return 1;
  return 2 + Math.floor((context - critical) / STEP);
}

const k = (n) => `${Math.round(n / 1000)}k`;

export function budgetMessage(context, { warn, critical }) {
  if (context === null || context < warn) return null;
  if (context >= critical)
    return `[SESSION BUDGET CRITICAL] This session's context is ~${k(context)} tokens, past the ${k(critical)} rotation line, and every turn re-reads all of it. At your next PR boundary: as a lane, write your handoff and ask the orchestrator to rotate you; otherwise suggest the user run /compact or start a fresh session. Until then, keep reads tight.`;
  return `[SESSION BUDGET WARNING] This session's context is ~${k(context)} tokens (rotation at ${k(critical)}), and every turn re-reads all of it. Keep reads tight; plan to hand off or compact at the next natural boundary.`;
}

// The last usage record sits near the end; a long transcript runs to tens of megabytes, so read a
// tail window, doubling it when one large tool result pushed the record out.
export function lastContext(path) {
  const size = statSync(path).size;
  for (let len = 1024 * 1024; ; len *= 2) {
    const n = Math.min(size, len);
    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(n);
    try {
      readSync(fd, buf, 0, n, size - n);
    } finally {
      closeSync(fd);
    }
    const { context } = sessionSummary(buf.toString('utf8'));
    if (context !== null || n >= size) return context;
  }
}

// The band last announced to a session, so PostToolUse speaks once per crossing.
const stateFile = (sessionId, env) =>
  join(
    pluginDataDir(env),
    'session-budget',
    `${sessionId.replace(/[^\w-]/g, '_')}.json`,
  );

export function crossed(sessionId, now, env = process.env) {
  const file = stateFile(sessionId, env);
  let last = 0;
  try {
    last = JSON.parse(readFileSync(file, 'utf8')).band ?? 0;
  } catch {
    // First run for this session.
  }
  if (now === last) return false;
  // A drop (after /compact) is recorded too, so growing back past a line warns again.
  mkdirSync(join(pluginDataDir(env), 'session-budget'), { recursive: true });
  writeFileSync(file, JSON.stringify({ band: now }));
  return now > last;
}

// Run as a hook, not when a test imports it.
if (isMain(import.meta.url)) {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    process.exit(0);
  }
  let context = null;
  try {
    context = lastContext(payload.transcript_path ?? '');
  } catch {
    process.exit(0);
  }
  const l = lines(loadConfig());
  const message = budgetMessage(context, l);
  if (payload.hook_event_name === 'PostToolUse') {
    // Recorded below the warning line too, so a session compacted back under it warns again.
    if (!payload.session_id || !crossed(payload.session_id, band(context, l)))
      process.exit(0);
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: message,
        },
      }),
    );
  } else if (message) {
    console.log(message);
  }
}
