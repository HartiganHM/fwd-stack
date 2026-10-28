// Where the pre-open pass ledger lives.
//
// It used to sit beside these scripts. Installed as a plugin, this folder is replaced on every
// update, and the ledger holds finding text from private repositories that must never be
// committed here. So it lives in the plugin's persistent data folder instead.
//
// The folder itself is resolved in lib/plugin-data.mjs, shared with every script that keeps state.
//
// A ledger left at the old location is still read until it is moved, so nothing recorded
// before the move is lost and nothing has to happen on the day the plugin is installed.
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { pluginDataDir } from '../../lib/plugin-data.mjs';

const FILE = 'precheck-ledger.json';

export function ledgerPath(
  env = process.env,
  home = homedir(),
  exists = existsSync,
) {
  if (env.FWD_PRECHECK_LEDGER) return env.FWD_PRECHECK_LEDGER;
  const config = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  const current = join(pluginDataDir(env, home), FILE);
  const legacy = join(config, 'skills', 'pr-review', FILE);
  if (!exists(current) && exists(legacy)) return legacy;
  return current;
}

export function ensureLedgerDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}
