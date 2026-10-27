// Where the pre-open pass ledger lives.
//
// It used to sit beside these scripts. Installed as a plugin, this folder is replaced on every
// update, and the ledger holds finding text from private repositories that must never be
// committed here. So it lives in the plugin's persistent data folder instead.
//
// Claude Code exports CLAUDE_PLUGIN_DATA to hooks, but not to commands Claude runs through
// Bash, so the folder is also derived from its documented name: `~/.claude/plugins/data/<id>`,
// where <id> is `fwd@fwd-stack` with every character outside [A-Za-z0-9_-] replaced by `-`.
//
// A ledger left at the old location is still read until it is moved, so nothing recorded
// before the move is lost and nothing has to happen on the day the plugin is installed.
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const FILE = 'precheck-ledger.json';

export function ledgerPath(
  env = process.env,
  home = homedir(),
  exists = existsSync,
) {
  if (env.FWD_PRECHECK_LEDGER) return env.FWD_PRECHECK_LEDGER;
  const data =
    env.CLAUDE_PLUGIN_DATA ||
    join(home, '.claude', 'plugins', 'data', 'fwd-fwd-stack');
  const current = join(data, FILE);
  const legacy = join(home, '.claude', 'skills', 'pr-review', FILE);
  if (!exists(current) && exists(legacy)) return legacy;
  return current;
}

export function ensureLedgerDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}
