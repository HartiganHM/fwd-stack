// Which pr-gate.mjs the PreToolUse hook runs.
//
// A session's hooks are fixed when it loads, and they run the gate under ${CLAUDE_PLUGIN_ROOT}:
// the plugin version that session started with. A gate fix released later never reached it until
// someone ran /reload-plugins. So the hook asks this module first, at call time, and runs the
// newest installed gate instead: ~/.claude/fwd/skills/pr-review/pr-gate.mjs, the link kept
// pointing at the newest version in the plugin cache.
//
// The link is only trusted when it really resolves into the fwd plugin cache. Anything else (no
// link, a link into a checkout, a link to an OLDER version than the one bundled with this
// session) falls back to the bundled gate. Either way a gate runs, so the hook stays closed.
//
//   node gate-path.mjs <bundled pr-gate.mjs>   prints the path to run
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { isMain } from '../../lib/is-main.mjs';

const GATE = ['skills', 'pr-review', 'pr-gate.mjs'];

// The version folder of a gate inside the plugin cache, or null when it is not in there:
// <cache>/<marketplace>/fwd/<version>/skills/pr-review/pr-gate.mjs.
function cacheVersion(real, cache) {
  const parts = relative(cache, real).split(sep);
  if (parts.length !== 6 || parts[0] === '..' || parts[0] === '') return null;
  if (parts[1] !== 'fwd') return null;
  if (parts.slice(3).join('/') !== GATE.join('/')) return null;
  return parts[2];
}

// -1, 0 or 1 for two dotted numeric versions; null when either is not one.
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  if (![...pa, ...pb].every(Number.isInteger)) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function resolveGate(bundled, home = homedir()) {
  const link = join(home, '.claude', 'fwd', ...GATE);
  try {
    if (!existsSync(link)) return bundled;
    const real = realpathSync(link);
    const cache = realpathSync(join(home, '.claude', 'plugins', 'cache'));
    const newest = cacheVersion(real, cache);
    if (newest === null) return bundled;
    // Never step back: a session already on a newer version than the link keeps its own gate.
    const own = existsSync(bundled)
      ? cacheVersion(realpathSync(bundled), cache)
      : null;
    if (own !== null && compareVersions(newest, own) === -1) return bundled;
    return real;
  } catch {
    return bundled;
  }
}

if (isMain(import.meta.url)) {
  const bundled = process.argv[2];
  if (!bundled) {
    console.error('usage: node gate-path.mjs <bundled pr-gate.mjs>');
    process.exit(2);
  }
  console.log(resolveGate(bundled));
}
