# Engineering conventions

## Quality gates

- `pnpm verify` = lint + typecheck + test. **Nothing lands red.** Fast gate — **no e2e**.
- `pnpm verify:full` = build + verify + Playwright e2e — the pre-push / CI mirror. Run it
  before pushing: it catches runtime API-contract drift that `verify` can't (e2e is
  CI-only otherwise). Needs the **node ABI** like the server tests — flip with
  `pnpm abi:node` (+ re-sign on macOS) if you just ran `pnpm dev:desktop`.
- Pre-commit: lint-staged (ESLint --fix + Prettier on staged files).
- Pre-push: `format:check` + `pnpm audit --audit-level=high` + gitleaks
  (hard-fails if gitleaks is missing — no unscanned pushes). `auditConfig.ignoreGhsas`
  in `pnpm-workspace.yaml` acknowledges known transitive build-tooling advisories.
- CI mirrors `verify:full` + audit + secret scan on every push.

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
- **NestJS DI: every constructor param gets an explicit `@Inject(Token)`** —
  the tsx dev runner (esbuild) emits no decorator metadata, so implicit
  type-based injection resolves to `undefined` at runtime. Discovered
  2026-06-12 the hard way; tests don't catch it (they construct manually).

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
