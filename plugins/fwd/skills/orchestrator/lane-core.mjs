// What lane-context.mjs reads out of a session transcript, kept pure so it is testable.
//
// A session's context is what its NEXT turn will re-read: the last assistant turn's input plus
// cache reads plus cache writes. Per-turn context size, not session length, drives cost, so this
// is the number a lane is rotated on.

import { resolve } from 'node:path';

/**
 * Claude Code's folder name for a project's transcripts: every non-alphanumeric of the ABSOLUTE
 * path becomes `-`. Resolved first, so `.` or a trailing slash names the same folder as the cwd.
 */
export const projectDirName = (path) =>
  resolve(path).replace(/[^A-Za-z0-9]/g, '-');

export function sessionSummary(jsonl) {
  // The latest of each: a session renamed twice shows its current name. A lane's agent name, when
  // it has one, wins over a title.
  let agentName = null;
  let title = null;
  let model = null;
  let context = null;
  let at = null;
  for (const line of jsonl.split('\n')) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // a partial first line from a tail read, or a line being written
    }
    if (e.type === 'agent-name' && e.agentName) agentName = e.agentName;
    else if (e.type === 'custom-title' && e.customTitle) title = e.customTitle;
    // A subagent's turns are written to the same transcript; they do not grow this session.
    if (e.type !== 'assistant' || e.isSidechain) continue;
    const u = e.message?.usage;
    if (!u) continue;
    context =
      (u.input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0);
    model = e.message.model ?? model;
    at = e.timestamp ?? at;
  }
  return { name: agentName ?? title, model, context, at };
}

/**
 * What to do about a lane. Busy lanes over `rotateAt` rotate at their next PR boundary. While the
 * user is away a lane over `rotateAt` keeps working with tight reads, because a rotation nobody is
 * there to restart leaves work sitting; at `awayAt` it stops at its next PR boundary with a handoff
 * written, and the rotation waits for the user.
 */
export function verdict(
  context,
  { rotateAt = 300_000, awayAt = 450_000, away = false } = {},
) {
  if (context === null) return 'no turns yet';
  if (away) {
    if (context >= awayAt)
      return 'over the away line: stop at its next PR boundary, handoff written';
    if (context >= rotateAt) return 'over rotateAt: keep working, reads tight';
    return 'ok';
  }
  return context >= rotateAt ? 'rotate at its next PR boundary' : 'ok';
}
