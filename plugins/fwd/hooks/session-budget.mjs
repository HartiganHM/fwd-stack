#!/usr/bin/env node
// UserPromptSubmit: warn as a session grows. Each turn re-reads the whole context, so per-turn
// cost rises with session depth; assistant turns in the transcript stand in for that depth.
// Thresholds come from `sessionBudget` in fwd.json (default 20 and 35 turns). An orchestrator
// that measures lanes' real context replaces this where one runs; this is the backstop for a
// session nobody is watching.
import { readFileSync } from 'node:fs';

import { loadConfig } from '../lib/fwd-config.mjs';

export function budgetMessage(turns, { warn = 20, critical = 35 } = {}) {
  if (turns >= critical)
    return `[SESSION BUDGET CRITICAL] ~${turns} assistant turns logged. The session context is very large. Suggest the user run /compact now, or start a fresh session if switching to a new task.`;
  if (turns >= warn)
    return `[SESSION BUDGET WARNING] ~${turns} assistant turns logged. Suggest /compact if the user is switching tasks or recent work was heavy debugging; CLAUDE.md and committed code carry context across sessions.`;
  return null;
}

if (import.meta.main) {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    process.exit(0);
  }
  let transcript = '';
  try {
    transcript = readFileSync(payload.transcript_path ?? '', 'utf8');
  } catch {
    process.exit(0);
  }
  const turns = (transcript.match(/"role":"assistant"/g) ?? []).length;
  const message = budgetMessage(turns, loadConfig().sessionBudget);
  if (message) console.log(message);
}
