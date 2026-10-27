#!/usr/bin/env node
// PreToolUse guard for the Neon MCP server, written after a production restore_snapshot incident.
// Production and staging are read-only to agents: the branches and endpoints listed under
// `neon.protected` in fwd.json (see lib/fwd-config.mjs), plus any call that names no branch,
// which Neon runs against the default branch. The rule itself is in neon-guard.mjs.
import { readFileSync } from 'node:fs';

import { loadConfig } from '../lib/fwd-config.mjs';
import { neonDecision } from './neon-guard.mjs';

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const name = String(input.tool_name ?? '');
if (!name.startsWith('mcp__neon__')) process.exit(0);

const reason = neonDecision(
  name.slice('mcp__neon__'.length),
  input.tool_input ?? {},
  loadConfig().neon.protected,
);
if (reason)
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `neon-prod-guard: ${reason} Production and staging are read-only (run_sql SELECT only). Ask the user to lift this guard for a deliberate operation.`,
      },
    }),
  );
