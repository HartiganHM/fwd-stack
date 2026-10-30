#!/usr/bin/env node
// The 20-cell bar for one feature line in the progress chart.
//
//   node bar.mjs <done> <inFlight> <total>
//
// Each segment is round(count * 20 / total); the rounding is then fixed so the bar is exactly 20
// cells. Ties go to the not-started segment first, so a tie never overstates progress.
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

export const WIDTH = 20;
export const GLYPHS = ['█', '▒', '░'];

// Cell counts for [done, in flight, not started], always summing to WIDTH.
export function cells(done, inFlight, total) {
  for (const n of [done, inFlight, total]) {
    if (!Number.isInteger(n) || n < 0)
      throw new Error(`not a whole count: ${n}`);
  }
  if (total === 0) throw new Error('a line needs at least one step');
  if (done + inFlight > total)
    throw new Error(`${done} + ${inFlight} is more than ${total}`);

  const exact = [done, inFlight, total - done - inFlight].map(
    (c) => (c * WIDTH) / total,
  );
  const out = exact.map(Math.round);
  // Each segment is off by at most half a cell, so the total is off by at most one.
  const order = [2, 1, 0];
  let sum = out[0] + out[1] + out[2];
  while (sum !== WIDTH) {
    const dir = sum > WIDTH ? -1 : 1;
    // Move the segment the rounding pushed furthest the wrong way.
    const pick = order.reduce((best, i) =>
      dir * (exact[i] - out[i]) > dir * (exact[best] - out[best]) ? i : best,
    );
    out[pick] += dir;
    sum += dir;
  }
  return out;
}

export function bar(done, inFlight, total) {
  return cells(done, inFlight, total)
    .map((n, i) => GLYPHS[i].repeat(n))
    .join('');
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(self)) {
  const [done, inFlight, total] = process.argv.slice(2).map(Number);
  try {
    console.log(bar(done, inFlight, total));
  } catch (e) {
    console.error(
      `${e.message}\nusage: node bar.mjs <done> <inFlight> <total>`,
    );
    process.exit(1);
  }
}
