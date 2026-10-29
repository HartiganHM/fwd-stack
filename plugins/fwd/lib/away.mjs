#!/usr/bin/env node
// Whether the user is away: one window shared by every session, so lanes, the orchestrator and the
// session-budget hook agree without each remembering a flag. While it is open no lane stops for
// context, and rotation waits for the user's return. It closes on its own when it expires, or when
// the orchestrator clears it on the user's return.
//
//   node away.mjs set <hours>   open a window from now
//   node away.mjs clear         the user is back
//   node away.mjs status        print the window, or "present"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { isMain } from './is-main.mjs';
import { pluginDataDir } from './plugin-data.mjs';

const file = (env) => join(pluginDataDir(env), 'away.json');

export function awayUntil(env = process.env, now = Date.now()) {
  try {
    const { until } = JSON.parse(readFileSync(file(env), 'utf8'));
    return typeof until === 'number' && until > now ? until : null;
  } catch {
    return null; // no window, or an unreadable one: treat the user as present
  }
}

export function setAway(hours, env = process.env, now = Date.now()) {
  if (!(hours > 0)) throw new Error('hours must be a positive number');
  mkdirSync(pluginDataDir(env), { recursive: true });
  const until = now + hours * 3_600_000;
  writeFileSync(file(env), JSON.stringify({ until }));
  return until;
}

export function clearAway(env = process.env) {
  rmSync(file(env), { force: true });
}

if (isMain(import.meta.url)) {
  const [command, hours] = process.argv.slice(2);
  if (command === 'set') {
    const until = setAway(Number(hours));
    console.log(`away until ${new Date(until).toISOString()}`);
  } else if (command === 'clear') {
    clearAway();
    console.log('present');
  } else if (command === 'status') {
    const until = awayUntil();
    console.log(
      until ? `away until ${new Date(until).toISOString()}` : 'present',
    );
  } else {
    console.error('usage: away.mjs set <hours> | clear | status');
    process.exit(1);
  }
}
