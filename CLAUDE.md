# fwd-stack: agent notes

The shared configs, CI gate and version baseline for Concert Crawl (`HartiganHM/concert-crawl`)
and The 99 (`HartiganHM/the-99`). Design doc: https://claude.ai/artifact/Tah89KVLvYZKj7cATrYzwZ

- pnpm only. Gate before every push: `pnpm format:check && pnpm typecheck && pnpm lint && pnpm test`.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `perf:`, `ci:`).
- Never commit to `main`; every change is a PR. Review cycles and the merge bar follow the
  `pr-review` skill (`plugins/fwd/skills/pr-review/`); run its gate rather than recalling the state.
- `plugins/fwd` is public. Never put private repositories' code, finding text, PR numbers or costs
  in it; skill state belongs in the plugin's data folder.
- A change here reaches every project that extends it. Before changing a shared rule or option,
  check what it does to both apps, and land their fixes alongside.
- Project-specific rules (Concert Crawl's copy lint, The 99's hover-state guard) stay in those
  projects, layered after the shared config. Only what both apps share belongs here.
- `baseline.json` is the source of truth for version majors; raise it first, then each project.
