# fwd-stack design

How the kit is meant to work and why, written from the 2026-10-25 audit of Concert Crawl and The 99. It mirrors the original design doc, which lives in account 2's Claude workspace and can't be
opened from account 1. Status and next steps are in
[roadmap.md](roadmap.md).

## What the kit is for

Concert Crawl (`HartiganHM/concert-crawl`) and The 99 (`HartiganHM/the-99`) already share most of
a stack, but they had drifted on versions and tooling. The kit does three jobs:

1. **Scaffold new projects** from a core plus opt-in capabilities. A static site takes none of
   the database pieces.
2. **Keep existing projects consistent** by having them consume shared config packages and
   reusable CI workflows, instead of copying them.
3. **Keep cost visible**: one vendor account per service shared by every project, free tiers
   where they hold, and one cost check across all projects.

## The shared stack

| Layer         | Choice                                                              |
| ------------- | ------------------------------------------------------------------- |
| Package mgr   | pnpm (pinned via `packageManager`), Node 24                         |
| Language      | TypeScript, strict                                                  |
| Web           | Next.js 16 (App Router), React 19, Tailwind 4                       |
| Validation    | Zod 4                                                               |
| Auth          | Clerk                                                               |
| Database      | Postgres on Neon, Drizzle ORM, a Neon branch per environment        |
| Hosting       | Vercel; Render only for long-running or browser work (crawlers)     |
| Errors        | Sentry, errors only, with scrubbing                                 |
| Payments      | Stripe, one shared account, every object tagged with `metadata.app` |
| Email         | Resend                                                              |
| Analytics     | PostHog (opt-in)                                                    |
| LLM           | Anthropic SDK                                                       |
| Tests         | Vitest, Testing Library, Playwright for browser work                |
| Lint / format | ESLint 9 flat config, Prettier, Husky, lint-staged, commitlint      |
| CI            | GitHub Actions, through the reusable gate in this repo              |
| Dependencies  | Dependabot, grouped                                                 |

`baseline.json` records the majors every project is held to.

### Deliberate differences that stay project-specific

- Concert Crawl is a Turborepo monorepo with a Hono API and crons on Render, because Playwright
  crawls need a long-running Node process.
- The 99 is a single Next.js app with Vercel crons, CI test selection and its catalog pipelines.

The kit offers these shapes as capabilities (`monorepo`, `worker`) and never forces them on a
project. Project-specific lint rules (Concert Crawl's copy lint, The 99's hover-state guard) stay
in those projects, layered after the shared config.

## Generator with opt-in capabilities (planned)

A small CLI in this repo builds a new project from `core` plus the capabilities it needs, and
writes a `stack.json` into the project recording the kit version and the capabilities chosen.
That file lets the CLI add or remove a capability later, and lets CI check for drift.

Each capability is a folder in the kit with four parts:

- the files it plants, kept under its own `src/lib/<capability>/` so removing it is mostly a
  delete;
- its dependencies;
- its environment variables, with descriptions for `.env.example`;
- a manifest naming what it needs and which vendor it uses.

| Capability      | What it adds                                                                                                                           | Needs          | Vendor                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------- |
| `core` (always) | Next.js, TypeScript strict, Tailwind, ESLint, Prettier, Husky, commitlint, Vitest, CI, Dependabot, ignored builds for docs-only pushes | none           | Vercel, GitHub Actions                |
| `database`      | Drizzle, Neon driver, migrate on production build, `/api/health` reporting migration state, branch-per-environment scripts             | core           | Neon                                  |
| `auth`          | Clerk provider, middleware, webhook with an account purge hook                                                                         | core           | Clerk                                 |
| `errors`        | Sentry with scrubbing rules (no user, headers, body or message)                                                                        | core           | Sentry                                |
| `payments`      | Stripe webhook, required `metadata.app` tagging, Checkout helpers                                                                      | auth, database | Stripe                                |
| `email`         | Resend client and a template folder                                                                                                    | core           | Resend                                |
| `analytics`     | PostHog                                                                                                                                | core           | PostHog                               |
| `ai`            | Anthropic client, an input boundary for player-typed text, a spend ledger                                                              | database       | Anthropic                             |
| `push`          | web-push, service worker, VAPID setup                                                                                                  | database       | none                                  |
| `jobs`          | Vercel cron routes guarded by `CRON_SECRET`                                                                                            | core           | Vercel                                |
| `worker`        | A Node service and Render cron template, for long-running or browser work                                                              | database       | Render, only when Vercel can't run it |
| `monorepo`      | Turborepo layout with `apps/` and `packages/`                                                                                          | core           | none                                  |
| `switches`      | Feature switch registry with per-reader resolution                                                                                     | database       | none                                  |

Presets bundle these:

- `static`: core only;
- `app`: core, database, auth, errors;
- `commercial`: app plus payments and email.

A static site therefore never sees Neon, Clerk or their environment variables.

Adding a capability is reliable, since it only plants files. Removing one is reliable only while
its files are untouched. When they have been edited, `stack remove` deletes what is unchanged and
prints a checklist for the rest instead of guessing.

The first release covers `core`, `database`, `auth` and `errors`. The kit's own CI tests it by
generating a static site and an app and building both.

## Keeping existing projects consistent

Projects consume the kit; they never copy it. There are three layers, from least to most effort
to adopt:

1. **Shared config packages** (built): `@fwd-stack/tsconfig`, `@fwd-stack/eslint-config`,
   `@fwd-stack/prettier-config` and `@fwd-stack/commitlint-config`. A project extends them and
   layers its own rules on top. A Vitest config package is still to come.
2. **Reusable GitHub Actions workflows** (built: `node-ci.yml`), called with `workflow_call`.
   Each repo's `ci.yml` shrinks to a call plus its project-specific jobs (Concert Crawl's e2e,
   The 99's test selection). Planned: the cost check and Dependabot auto-merge.
3. **`stack doctor`** (planned), run weekly and on PRs that touch config. It reads `stack.json`,
   compares pinned majors and required files against `baseline.json`, and fails with a short list
   of what drifted. It reports in the job summary and never opens issues, which keeps it inside
   Concert Crawl's intake rule.

The agent skills and hooks both projects share live in the `fwd` Claude Code plugin under
`plugins/fwd` (see the README).

## Cost principles

- One account per vendor, shared by every project, with a project, application or workspace per
  app inside it. Hugh confirmed on 2026-10-26 that the vendor accounts are already shared this
  way. PostHog is the exception: no account exists yet.
- Prefer free tiers where they hold; each capability's manifest names its free-tier limit and what
  pushes it to paid, and the generator prints the expected change before anything is provisioned.
- `core` ships The 99's ignored-builds rule, no preview builds unless asked for, and a daily
  staging sync by default.
- The 99's weekly cost check becomes a kit workflow that reads each shared account once and
  reports per project.
- Stripe is one shared account, so `metadata.app` on every object is a required field.
- Render is used only by the `worker` capability; prefer Vercel crons.

## Scaling

Scaling calls are made when a measured trigger fires, not up front. The kit's job is to make
those triggers visible and the exits cheap.

| Part             | Revisit when                                                         | The exit                                                                                          |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Vercel           | Spend climbs faster than users, or work needs long-running processes | Next.js runs on any Node host; only Vercel crons and the ignored-build script are Vercel-specific |
| Render           | p95 latency or memory near the limit                                 | Raise the plan or instance count; the API holds no state                                          |
| Neon             | CU-hours or connection errors climb                                  | Raise the autoscale ceiling, then add a read replica for public reads                             |
| Third-party APIs | A free-tier limit is near                                            | The cost manifest names the limit; the cost check warns ahead of it                               |

Optimizations one app already has that the kit will share: CDN caching of public reads,
per-user page caching keyed on a data stamp (a capability, since it needs triggers), Neon
connection handling (retire pooled sockets early; never bundle a second Neon `Pool`), payload and
load measurement scripts, and observe-only rate limits on anonymous pages. No shared cache
service (Redis or KV) until one is measured to be needed.

## Improvements to investigate

| Idea                                                                                                                          | Verdict                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| One source of truth for env vars, syncing to Vercel, Render and GitHub secrets (recommended: Infisical; alternative: Doppler) | Do. Keys are still created in each vendor once; GitHub sync covers secrets, not plain Actions variables |
| Move Concert Crawl's non-crawler API from Render to Vercel                                                                    | Investigate                                                                                             |
| External uptime check on each `/api/health` (recommended: Better Stack)                                                       | Do                                                                                                      |
| Neon backup and restore drill, with a runbook                                                                                 | Do once                                                                                                 |
| TanStack Start as a framework option                                                                                          | Try on a future new project; Next stays the default                                                     |
| Biome or oxlint in place of ESLint and Prettier                                                                               | Wait: both apps rely on custom ESLint rules                                                             |
| A queue for background jobs (Inngest; alternative: Trigger.dev)                                                               | Wait until a job outgrows a cron                                                                        |
