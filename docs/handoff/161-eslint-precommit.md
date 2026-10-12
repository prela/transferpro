# 161 ESLint pre-commit

Out of scope: changing lint-staged globs, Vitest's global timeout, or the import-gate assertions.

## Decisions

- The Antfu config loads on the first `lintText`, not at `new ESLint()`. That load belongs in `beforeAll` with a 30s budget. The import-gate tests stay on Vitest's default 5s. Do not put the allowance back on one `it`.

## Code review

## Standards

**File:** `server/core/import-gate.test.ts`
**Diff:** `beforeAll` warms ESLint (`lintText('export {}\n', { filePath: 'server/core/index.ts' })`, 30s); the 20s timeout comes off the first `it`.

### Hard violations

None.

The assertions are the same. `AGENTS.md` (“Never weaken or remove a test”) is about dropping or softening checks, not about where the clock sits. ADR-0011 says the pre-commit hook runs the unit script after typecheck; paying for Antfu’s first `lintText` in `beforeAll`, and leaving the tests on Vitest’s default, matches that. The new comments say why. TDD’s seam, tautology, and one-assertion rules are untouched: this hook asserts nothing and does not change what the tests check.

### Judgement calls (baseline)

None that clear the bar.

The dummy `export {}\n` is a load, not a second copy of `restrictedImports`, and not an unused abstraction (Speculative Generality). No new name, clump, switch, or delegation was added.

## Spec

Issue #161. Diff is `server/core/import-gate.test.ts` against `origin/develop` (`76c242d`). `.husky/pre-commit` still runs `pnpm exec lint-staged`, `pnpm typecheck`, `pnpm test`. `vitest.config.ts` sets no `testTimeout` or `hookTimeout` (Vitest default 5s per test).

### (a) Missing or partial

None. The only acceptance is: "Pre-commit (lint-staged + typecheck + test) finishes without ESLint timeout." Context: "an ESLint import-gate test under pre-commit was exceeding the default 5 s budget." The hook and Vitest config stay as they are; the 5s budget is the test timeout, and this file is included by `server/**/*.test.ts`. The cold load moves into `beforeAll(..., 30_000)` via one `lintText`. Later tests in this file already did more `lintText` calls than the first test and had no extra budget, so they only fit in 5s after that load.

### (b) Scope creep

None. Assertions are unchanged. The dummy `lintText` and the 30s hook budget are the timeout fix. 30s is a larger allowance than the old 20s on the first `it`; the issue does not fix a number.

### (c) Implemented but wrong

None. "The ESLint load exceeds 5s when the hook runs it after typecheck" (handoff #97, cited as history, not an extra requirement). The new comment matches that: config loads on the first `lintText`, not at `new ESLint()`. That call now sits in `beforeAll` with its own 30s budget, and the first `it` drops `20_000`, so the tests keep the default 5s. Same `ESLint` instance, tests in the file are sequential, so the warmup is shared.
