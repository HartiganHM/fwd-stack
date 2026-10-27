// The per-project settings the fwd plugin's skills and hooks read: `.claude/fwd.json` in the
// project, layered over `fwd.json` in the Claude config folder (`~/.claude`, or
// CLAUDE_CONFIG_DIR) for settings that hold on this machine whatever the project.
//
//   {
//     "ownApp": true,                                   // one of the owner's own apps
//     "neon": { "protected": { "br-…": "production" } },  // read-only Neon branches/endpoints
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

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
};
// Anything but a JSON object reads as no config: a `null` file made loadConfig throw, and the Neon
// hook then exited without a decision, machine protection included.
const asConfig = (v) => (isObject(v) ? v : {});

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
  const machine = asConfig(read(join(configDir, 'fwd.json')));
  const project = env.CLAUDE_PROJECT_DIR
    ? asConfig(read(join(env.CLAUDE_PROJECT_DIR, '.claude', 'fwd.json')))
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
  return merged;
}
