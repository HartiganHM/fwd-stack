# Handover: account 2 to account 1 (2026-10-28)

Read this first at the start of account 1's next session. Repo: `HartiganHM/fwd-stack`. Scope:
the kit only. Other sessions handle The 99 and Concert Crawl themselves.

Then read, in this folder:

- [design.md](design.md): what the kit is for, the shared stack, the generator and its
  capabilities, how existing projects stay consistent, cost principles, scaling and the
  improvements to investigate. It mirrors the design doc in account 2's workspace, which account 1
  cannot open.
- [roadmap.md](roadmap.md): what is done, the order of what comes next, the decisions made and
  the open questions.

## State on GitHub

`main` tip at handover: `3a54cd2`. `design-assets` branches from it and never merges into main.

| Work                                                                                                                          | Status                                                                                                                | Commits                | PR                               |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------- |
| Kit v0: shared tsconfig, ESLint, Prettier and commitlint packages, reusable `node-ci.yml` gate, `baseline.json`, config tests | Merged                                                                                                                | `d5f8f65`              | fwd-stack#1                      |
| ESLint rules relaxed for `_` names, rest siblings and `typeof import()`                                                       | Merged                                                                                                                | `93bc69c`              | fwd-stack#2                      |
| The 99 extends the shared tsconfig and ESLint presets                                                                         | Open, ready to merge: CI green, two Copilot rounds (round 2 clean), mergeable. The 99's own sessions own it from here | head `8a856a9`         | the-99#2281                      |
| The `fwd` Claude Code plugin (skills and hooks)                                                                               | Merged, built by other sessions, not by account 2                                                                     | `0766ac8` to `3a54cd2` | fwd-stack#3, #7 to #10, #14, #15 |

No canvases: this is code work, not design work. Nothing is uncommitted.

## Next step

Build the **generator** (roadmap item 1): `core`, `database`, `auth` and `errors`, the `static`
and `app` presets, and `stack.json`, tested in the kit's CI by generating a static site and an app
and building both. Its first real test case is the Featherweight Design website, a new Next.js
site on Vercel. That build waits on the generator, so tell Hugh as soon as the kit can scaffold
it. Concert Crawl's adoption of the shared configs comes after that.

Not started on the generator yet: no branch, no code.

## Standing rules

- Every PR gets at least two GitHub Copilot review rounds before merge. If round 2 has findings,
  run two more; any new push gets two more rounds. Request them with the GitHub MCP
  `request_copilot_review` tool. Review cycles otherwise follow the `pr-review` skill in
  `plugins/fwd`.
- Gate before every push: `pnpm format:check && pnpm typecheck && pnpm lint && pnpm test`.
- Conventional commits. Never commit to `main`; every change is a PR. Assign Hugh on each PR.
- Prettier: semicolons, single quotes. License: MIT.
- The repo is public. Keep business details, pricing, client names, personal information and
  secrets out of it, in docs and handover notes as well as code.
- A change to a shared rule reaches every project that extends it. Check what it does to both
  apps first, and land their fixes alongside (that is how fwd-stack#2 came about).
- `baseline.json` is the source of truth for version majors; raise it first, then each project.
- Packages install from GitHub by path until they are published:
  `github:HartiganHM/fwd-stack#path:/packages/<name>`.

## Handover rules (Hugh's, same as The 99)

1. `design-assets` never merges into main. Each account writes only to its own folder
   (`account-1/` or `account-2/`) and reads the other's.
2. Commit messages name the account, the date and what changed, for example
   `account-1 2026-11-04: generator core preset`.
3. Finished work goes to main through normal PRs from a working branch.
4. Accounts switch around the Friday usage reset. Before switching, the outgoing account writes
   `HANDOVER-to-account-N.md` in its own folder, covering each piece of open work with its status,
   links, commits and PRs, the standing rules, and anything in progress.
5. The incoming account starts by reading the other account's folder and its handover note.
