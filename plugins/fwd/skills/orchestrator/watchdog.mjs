#!/usr/bin/env node
// The orchestrator's stall watchdog. Run it with the Bash tool's `run_in_background`: it polls
// GitHub (no model cost) and EXITS only when something needs the orchestrator, and that exit is
// what wakes the session:
//   - an open PR has been quiet for `--stall` minutes (default 30), or
//   - the hourly heartbeat, so idle lanes with queued work get checked even when nothing stalls.
// On every exit it prints the stalled PRs and the lane-context table. Re-arm it after acting.
// A foreground wait loop blocks the user's messages behind it; never run this in the foreground.
//
//   node watchdog.mjs [--repo owner/name] [--stall 30] [--heartbeat 60] [--interval 120]
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { stalledPrs } from './watchdog-core.mjs';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const repo = flag('repo');
const stall = Number(flag('stall', 30));
const heartbeat = Number(flag('heartbeat', 60));
const interval = Number(flag('interval', 120)) * 1000;

const openPrs = () =>
  JSON.parse(
    execFileSync(
      'gh',
      [
        'pr',
        'list',
        '--state',
        'open',
        '--json',
        'number,title,updatedAt,isDraft,headRefName',
        ...(repo ? ['--repo', repo] : []),
      ],
      { encoding: 'utf8', timeout: 30_000 },
    ),
  );

const laneTable = () => {
  try {
    return execFileSync(
      'node',
      [fileURLToPath(new URL('./lane-context.mjs', import.meta.url))],
      { encoding: 'utf8', timeout: 30_000 },
    );
  } catch {
    return '(lane-context unavailable)\n';
  }
};

const report = (why, stalled) => {
  console.log(`watchdog: ${why}`);
  for (const p of stalled)
    console.log(
      `  #${p.number} quiet ${p.quietMinutes}m: ${p.title} (${p.headRefName})`,
    );
  process.stdout.write(laneTable());
  process.exit(0);
};

const until = Date.now() + heartbeat * 60_000;
let failures = 0;
for (;;) {
  try {
    const stalled = stalledPrs(openPrs(), Date.now(), stall);
    failures = 0;
    if (stalled.length)
      report(
        `${stalled.length} open PR(s) quiet for ${stall}+ minutes`,
        stalled,
      );
  } catch (e) {
    // A few failed reads are noise; a run of them is something the orchestrator should hear.
    if (++failures >= 5)
      report(
        `GitHub unreadable 5 times running (${String(e.message).split('\n')[0]})`,
        [],
      );
  }
  if (Date.now() + interval > until) report('heartbeat', []);
  await new Promise((r) => setTimeout(r, interval));
}
