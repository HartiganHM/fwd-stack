#!/usr/bin/env node
// UserPromptSubmit: warn as a session grows. Each turn re-reads the whole context, so per-turn
// cost rises with session depth; assistant turns in the transcript stand in for that depth.
// Thresholds come from `sessionBudget` in fwd.json (default 20 and 35 turns). An orchestrator
// that measures lanes' real context replaces this where one runs; this is the backstop for a
// session nobody is watching.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { loadConfig } from '../lib/fwd-config.mjs';

// Assistant turns: distinct assistant message ids. One turn is written as several JSONL lines
// (a line per content block), so counting lines overstated depth nearly twofold.
export function assistantTurns(jsonl) {
  const ids = new Set();
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"assistant"')) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'assistant' && entry.message?.id)
        ids.add(entry.message.id);
    } catch {
      // A partial last line while the transcript is being written.
    }
  }
  return ids.size;
}

export function budgetMessage(turns, { warn = 20, critical = 35 } = {}) {
  if (turns >= critical)
    return `[SESSION BUDGET CRITICAL] ~${turns} assistant turns logged. The session context is very large. Suggest the user run /compact now, or start a fresh session if switching to a new task.`;
  if (turns >= warn)
    return `[SESSION BUDGET WARNING] ~${turns} assistant turns logged. Suggest /compact if the user is switching tasks or recent work was heavy debugging; CLAUDE.md and committed code carry context across sessions.`;
  return null;
}

// Run as a hook, not when a test imports it. (`import.meta.main` would do, but needs Node 24.2.)
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
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
  const turns = assistantTurns(transcript);
  const message = budgetMessage(turns, loadConfig().sessionBudget);
  if (message) console.log(message);
}
