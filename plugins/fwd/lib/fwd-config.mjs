// The per-project settings the fwd plugin's skills and hooks read: `.claude/fwd.json` in the
// project, layered over `fwd.json` in the Claude config folder (`~/.claude`, or
// CLAUDE_CONFIG_DIR) for settings that hold on this machine whatever the project.
//
//   {
//     "ownApp": true,                                   // one of the owner's own apps
//     "neon": {
//       "protected": { "br-…": "production" },          // read-only Neon branches/endpoints
//       "readOnlyRole": "agent_reader"                  // run_sql there must use this role
//     },
//     "sessionBudget": { "warn": 20, "critical": 35 }     // assistant turns
//   }
//
// Objects merge key by key, and the project wins on a conflict. Protected Neon branches are a
// union, so a machine-wide list can never be narrowed by a project file. A missing or unreadable
// file is an empty one: a hook that crashed on a typo would stop guarding anything.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// A missing file is no config. A file that exists but cannot be read or parsed throws: reading it
// as empty would drop its protected ids, so a typo in fwd.json would lift the Neon guard.
const readJson = (path) => {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
  return JSON.parse(text);
};

export function mergeConfig(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {}))
    out[k] = isObject(v) && isObject(out[k]) ? mergeConfig(out[k], v) : v;
  return out;
}

export function loadConfig(
  env = process.env,
  home = homedir(),
  read = readJson,
) {
  const configDir = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  // `invalid` lists the files that exist but are not a JSON object. The Neon hook denies while it
  // is non-empty; everything else reads the rest of the config as usual.
  const invalid = [];
  const load = (path) => {
    let v;
    try {
      v = read(path);
    } catch {
      v = undefined;
    }
    if (isObject(v)) return v;
    invalid.push(path);
    return {};
  };
  const machine = load(join(configDir, 'fwd.json'));
  const project = env.CLAUDE_PROJECT_DIR
    ? load(join(env.CLAUDE_PROJECT_DIR, '.claude', 'fwd.json'))
    : {};
  const merged = mergeConfig(machine, project);
  // Only objects join the union: a project setting `protected` to null or [] cannot wipe the
  // machine's list, which mergeConfig alone would let it do.
  const ids = (v) => (isObject(v) ? v : {});
  merged.neon = {
    ...(isObject(merged.neon) ? merged.neon : {}),
    protected: {
      ...ids(machine.neon?.protected),
      ...ids(project.neon?.protected),
    },
  };
  // A role is per database, so a project may name its own; it cannot clear the machine's by
  // setting it to null or an empty string.
  const role = (v) => (typeof v === 'string' && v ? v : undefined);
  const readOnlyRole =
    role(project.neon?.readOnlyRole) ?? role(machine.neon?.readOnlyRole);
  if (readOnlyRole) merged.neon.readOnlyRole = readOnlyRole;
  else delete merged.neon.readOnlyRole;
  merged.invalid = invalid;
  return merged;
}
