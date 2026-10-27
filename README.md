# fwd-stack

The shared stack for Featherweight projects (Concert Crawl, The 99 and whatever comes next): the
configs every project extends, the CI gate every project calls, and the version baseline every
project is held to.

The design and the reasoning behind it are in the
[audit and design doc](https://claude.ai/artifact/Tah89KVLvYZKj7cATrYzwZ).

## What is here

| Path                            | What it is                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/tsconfig`             | `base`, `strictest`, `nextjs` and `node` TypeScript configs                                   |
| `packages/eslint-config`        | `base`, `node` and `next` ESLint flat configs                                                 |
| `packages/prettier-config`      | The shared Prettier config                                                                    |
| `packages/commitlint-config`    | Conventional commits with the shared type list                                                |
| `.github/workflows/node-ci.yml` | Reusable CI gate: install, then typecheck, lint, test and build                               |
| `baseline.json`                 | The majors every project is held to (Node, pnpm, Next, React, Zod, Vitest, Sentry, Drizzle …) |
| `plugins/fwd`                   | Claude Code plugin: the shared agent skills and their guard hooks                             |
| `tests/`                        | Proves each config loads and enforces what it claims                                          |

Planned, in order: the `stack` generator with opt-in capabilities, `stack doctor` (drift against
`baseline.json`), and a cross-project cost check.

## Using it in a project

The packages are not on npm yet. Until they are, install them from this repo by path:

```sh
pnpm add -D "@fwd-stack/eslint-config@github:HartiganHM/fwd-stack#path:/packages/eslint-config"
```

TypeScript:

```json
{ "extends": "@fwd-stack/tsconfig/nextjs" }
```

ESLint (a project's own rules go after the shared ones):

```js
import next from '@fwd-stack/eslint-config/next';

export default [...next, { rules: {/* project guards */} }];
```

Prettier, in `package.json`: `"prettier": "@fwd-stack/prettier-config"`.

CI, in the project's `.github/workflows/ci.yml`:

```yaml
jobs:
  gate:
    uses: HartiganHM/fwd-stack/.github/workflows/node-ci.yml@main
    with:
      scripts: typecheck lint test build
```

## The Claude Code plugin

This repo is also a Claude Code plugin marketplace. The `fwd` plugin carries the skills and hooks
every project's agents share, so each repo runs the same review gate instead of its own copy.

```sh
/plugin install fwd --marketplace HartiganHM/fwd-stack
```

| Skill       | What it does                                                                   |
| ----------- | ------------------------------------------------------------------------------ |
| `pr-review` | The Copilot review cycle and merge bar, computed by `pr-gate.mjs` and its hook |

State the skills keep, such as the pre-open pass ledger, lives in the plugin's data folder
(`~/.claude/plugins/data/fwd-fwd-stack/`), never in this repo.

## Working on the kit

```sh
pnpm install
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test
```

Raising a version: change `baseline.json` first, then each project. A config change that would
fail an existing project lands with that project's fix PR linked in the description.
