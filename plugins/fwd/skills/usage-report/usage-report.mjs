#!/usr/bin/env node
// The weekly-allowance split across every project on this machine, from Claude Code's local
// transcripts. Reads only `<config>/projects/**/*.jsonl`; costs no model tokens.
//
//   node usage-report.mjs [--days 7] [--top 10]
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline';

import { newTally, render, tally } from './usage-core.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : Number(args[i + 1]);
};
const days = flag('days', 7);
const top = flag('top', 10);
const since = Date.now() - days * 86_400_000;
const root = join(
  process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
  'projects',
);

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p);
    else if (name.name.endsWith('.jsonl') && statSync(p).mtimeMs >= since)
      files.push(p);
  }
};
walk(root);

// A worktree kept outside its repository (`../app-feature`) counts as the repository: git names
// the shared folder. A folder since deleted keeps its own name.
const roots = new Map();
const resolve = (cwd) => {
  if (!roots.has(cwd)) {
    let root = cwd;
    try {
      if (existsSync(cwd)) {
        const common = execFileSync(
          'git',
          ['-C', cwd, 'rev-parse', '--git-common-dir'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim();
        root = dirname(resolvePath(cwd, common));
      }
    } catch {
      // Not a repository: the folder itself.
    }
    roots.set(cwd, root);
  }
  return roots.get(cwd);
};

const acc = newTally();
for (const f of files) {
  const rl = createInterface({
    input: createReadStream(f),
    crlfDelay: Infinity,
  });
  const batch = [];
  for await (const line of rl) batch.push(line);
  tally(batch, { since, home: homedir(), resolve }, acc);
}
process.stdout.write(render(acc, { days, top }));
