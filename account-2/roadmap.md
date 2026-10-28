# fwd-stack roadmap and status

Where the kit stands and what comes next, as account 2 left it. The design is in
[design.md](design.md). The incoming account keeps its own copy current in its own folder.

Last updated: 2026-10-28.

## Done

- **Kit v0** (#1): `@fwd-stack/tsconfig` (`base`, `strictest`, `nextjs`, `node`),
  `@fwd-stack/eslint-config` (`base`, `node`, `next`), `@fwd-stack/prettier-config`,
  `@fwd-stack/commitlint-config`, the reusable `node-ci.yml` gate, `baseline.json`, and tests
  proving each config loads and enforces what it claims.
- **Lint rules relaxed for real idioms** (#2): `no-unused-vars` ignores `_`-prefixed names and
  rest siblings; `consistent-type-imports` allows `typeof import()` annotations (Vitest's
  `importActual` and mock factories).
- **The `fwd` Claude Code plugin** (#3 onward): the shared agent skills (`pr-review` and its gate,
  design review, feature acceptance, orchestrator and lane, and others) and their guard hooks.

## In progress

- **The 99 adopts the shared tsconfig and ESLint presets**: `HartiganHM/the-99#2281`. Config
  only. It also removed 31 unused imports and variables the shared rules surfaced. The kit's
  base raises The 99's `target` from ES2017 to ES2022 and turns on `noImplicitOverride`; neither
  changes shipped output.

## Next, in order

1. **The generator** with `core`, `database`, `auth` and `errors` and the `static` and `app`
   presets (see design.md). Its first real test case is a new Next.js site on Vercel, the
   Featherweight Design website, whose build waits on the generator. Tell Hugh when the kit can
   scaffold it.
2. **Concert Crawl adopts the shared configs and CI gate**, after The 99. Its own
   `packages/config` is replaced by the kit's presets, with its copy lint layered after.
3. **Version alignment**: Concert Crawl to Next 16, Zod 4 and Sentry 11; The 99 to Vitest 5 and
   the Prettier, Husky and Dependabot setup. One PR per upgrade, each behind its own CI run.
4. **Prettier reformat** of The 99 (semicolons, single quotes) as its own PR, timed to avoid
   conflicting with open work; then enforce `format:check` in its CI.
5. **`stack doctor`** in both repos, plus the remaining capabilities (`payments`, `email`,
   `analytics`, `ai`, `push`, `jobs`, `worker`, `monorepo`, `switches`).
6. **Cross-project cost check**, replacing The 99's single-project one.

## Decisions made

| Date       | Decision                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-26 | The kit lives in its own public repo, `HartiganHM/fwd-stack`.                                                                      |
| 2026-10-26 | Vendor accounts are already shared across apps; no consolidation needed.                                                           |
| 2026-10-26 | The 99 adopts first, then Concert Crawl.                                                                                           |
| 2026-10-26 | Prettier: semicolons on, single quotes, trailing commas, width 80.                                                                 |
| 2026-10-26 | License: MIT.                                                                                                                      |
| 2026-10-26 | Every PR gets at least two GitHub Copilot review rounds. If round 2 has findings, run two more; any new push gets two more rounds. |
| 2026-10-26 | Packages install from GitHub by path until they are published (see the README).                                                    |
| 2026-10-26 | fwd-stack is for full applications. Simple brochure sites are built elsewhere, not from the kit.                                   |
| 2026-10-28 | The Featherweight Design website is the generator's first new-app test case.                                                       |

## Open questions

- **Publishing**: when, and under which scope, the packages go to npm (today they are
  `@fwd-stack/*`, installed from GitHub).
- **PostHog**: no account exists yet. Concert Crawl's code no-ops without a key. Hugh would create
  the org before the `analytics` capability is used.
- **Secrets tool**: adopting one source of truth for env vars (Infisical recommended). Unverified:
  whether its free plan caps the number of syncs.
- **Concert Crawl's Vercel plan**: confirm it fits commercial use, since that app takes payments.
- **Generator form**: whether the CLI ships as a package (`pnpm dlx`) or a script run from a clone.
