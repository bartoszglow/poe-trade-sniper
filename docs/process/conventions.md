# Engineering conventions

## Quality gates

- `pnpm verify` = lint + typecheck + test. **Nothing lands red.**
- Pre-commit: lint-staged (ESLint --fix + Prettier on staged files).
- Pre-push: `format:check` + `pnpm audit --audit-level=high` + gitleaks
  (hard-fails if gitleaks is missing — no unscanned pushes).
- CI mirrors verify + build + audit + secret scan on every push.

## Git

- Stage files **one by one with explicit full paths** — never `git add -A`,
  `git add .` or `-am`. Verify with `git show --stat HEAD` after committing.
- English commit messages, conventional-commits style (`feat(server): …`).
- **No `Co-Authored-By` lines.**
- Commit per logical group; CHANGELOG line in the same commit as the feature.

## TypeScript

- Strict everywhere incl. `noUncheckedIndexedAccess`; no `any` escapes.
- Full descriptive identifiers — no `e`/`idx`/`val` abbreviations.
- Comments state constraints the code can't show, nothing else.

## Testing

- Vitest unit tests live next to the code (`*.test.ts`).
- Pure domain logic (normalization, governor math, engine diffing) is
  unit-tested as it lands, in the same commit.
- Playwright e2e drives the server API against recorded/mock PoE fixtures —
  **never against live GGG**, and fixtures never contain real account data.

## The no-guessing rule

The GGG API is undocumented. Discovered behaviour goes to
[`../integration/api-notes.md`](../integration/api-notes.md) with evidence +
date; assumptions in code are marked `TODO(verify)`. Never silently assume an
endpoint shape.

## Config, not constants

Tunables (poll floor, fetch spacing, backoff, budgets) live in the Zod env
schema with defaults — never as magic numbers at the call site.

## Secrets

The PoE session (cookies + UA) is a credential: never logged, never returned
by the API, never committed. `.env*` and `session.json` are gitignored.
