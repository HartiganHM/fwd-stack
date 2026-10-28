#!/usr/bin/env node
// Every recently active session in a project, with the context its next turn will re-read and
// what to do about it. Reads local transcripts only, so it costs no model tokens: the
// orchestrator runs it on every watchdog wake instead of measuring lanes by hand.
//
//   node lane-context.mjs [--project <dir>] [--active <minutes>] [--away] [--json]
//
// Thresholds come from `orchestrator.rotateAt` and `orchestrator.awayAt` in fwd.json
// (default 300k and 450k tokens).
import { openSync, readSync, closeSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadConfig } from '../../lib/fwd-config.mjs';
import { projectDirName, sessionSummary, verdict } from './lane-core.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const project = resolve(flag('project') ?? process.cwd());
const activeMinutes = Number(flag('active') ?? 120);
const away = args.includes('--away');

const config = loadConfig({ ...process.env, CLAUDE_PROJECT_DIR: project });
const limits = { ...config.orchestrator, away };
const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const dir = join(configDir, 'projects', projectDirName(project));

// The tail is enough: the last turn's usage and the session's name are both near the end, and
// a long transcript runs to tens of megabytes.
const TAIL = 4 * 1024 * 1024;
const tail = (path, size) => {
  const fd = openSync(path, 'r');
  try {
    const len = Math.min(size, TAIL);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
};

let files = [];
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
} catch {
  console.error(`no transcripts for ${project} (looked in ${dir})`);
  process.exit(1);
}
const since = Date.now() - activeMinutes * 60_000;
const lanes = files
  .map((f) => ({ f, stat: statSync(join(dir, f)) }))
  .filter(({ stat }) => stat.mtimeMs >= since)
  .map(({ f, stat }) => {
    const s = sessionSummary(tail(join(dir, f), stat.size));
    return {
      session: f.replace(/\.jsonl$/, ''),
      name: s.name ?? f.slice(0, 8),
      model: s.model,
      context: s.context,
      idleMinutes: Math.round((Date.now() - stat.mtimeMs) / 60_000),
      verdict: verdict(s.context, limits),
    };
  })
  .sort((a, b) => (b.context ?? 0) - (a.context ?? 0));

if (args.includes('--json')) {
  console.log(JSON.stringify(lanes, null, 2));
} else if (lanes.length === 0) {
  console.log(`no session active in the last ${activeMinutes} min`);
} else {
  const k = (n) => (n === null ? '—' : `${Math.round(n / 1000)}k`);
  for (const l of lanes)
    console.log(
      `${l.name.padEnd(18)} ${String(l.model ?? '').padEnd(18)} ${k(l.context).padStart(6)}  idle ${String(l.idleMinutes).padStart(3)}m  ${l.verdict}`,
    );
}
