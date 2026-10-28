#!/usr/bin/env node
// merge-ledgers.mjs <into> <newer>...
// Merges pre-open pass ledgers into <into>. A row is identified by what precheck.mjs never changes
// once written (repo, branch, its creation time, and PR for an unrun row, which is written with it);
// scoring edits a row in place and adds its PR, so the PR is not part of a scored row's identity.
// Rows are reconciled by identity, and a later file's version replaces an earlier one: a row scored
// in the newer ledger is kept once, scored, never twice. Unreadable files contribute nothing.
import { readFileSync, writeFileSync } from 'node:fs';

const [into, ...from] = process.argv.slice(2);
const read = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};
const id = (e) =>
  JSON.stringify([
    e.repo ?? null,
    e.branch ?? null,
    e.at ?? null,
    e.unrun ? e.pr : null,
  ]);
const rows = new Map();
for (const p of [into, ...from])
  for (const e of read(p)?.entries ?? []) rows.set(id(e), e);
const base = read(into) ?? from.map(read).find(Boolean) ?? {};
writeFileSync(
  into,
  `${JSON.stringify({ ...base, entries: [...rows.values()] }, null, 2)}\n`,
);
