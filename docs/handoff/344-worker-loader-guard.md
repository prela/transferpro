# 344 Worker-loader guard

Out of scope: exporting `officeOnly` and `requireRole` from the tenancy module, and a role check inside the worker loaders.

## Decisions

- ADR-0050 is accepted. The mail outbox worker has no actor, so `loadInvitationAttempt`, `invitationAttemptStore`, `loadOutboxAttempt`, `outboxAttemptStore`, `mailOutboxStore`, and `readInvitationForMail` check no role. That is the exception `AGENTS.md` requires. The lint rule `transferpro/worker-loader-role` is the enforcement. The only list is `workerUsedLoaders` in `eslint/worker-used-loaders.mjs`.
- `officeOnly` and `requireRole` count only when the binding is imported from the tenancy module index (`workerLoaderRoleModule` is `tenancy`). The call has to precede the loader use in that handler, or precede a nested function in an enclosing handler. A local function, a shadowed local, a member call, and a same-named import from any other module do not count.
- An unused import is covered only by a guard in the default-exported handler. A call in a sibling function does not cover it. The review below describes the earlier file-wide carve-out; `f2626f3` closes it, and `does not let a role call in another function cover an unused loader import` locks the closed path.
- The rule message cites ADR-0050. `hit`, `remember`, and `current` are `recordLoaderUse`, `recordImportedLoader`, and `activeScope`.
- Tenancy does not yet export `officeOnly` or `requireRole`. The rule fails closed for any future HTTP route that uses these loaders. That is intended. No current route calls them.

`pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (881). `pnpm test:e2e` passed: 320 (4.8m), database `transferpro_e2e` only.

## Code review

Fixed point `73b1679`. Both subagents started with `fast=false`. The reports below are that review, of the diff before the sibling-function fix that is in `f2626f3`.

### Standards

## Standards

### Hard

**`eslint.config.mjs` (`Program:exit`) vs ADR-0050 Decision and `docs/agents/working-rules.md` (Worker-used mail loaders).** Both say a non-test file under `server/api/` or `server/routes/` may import a worker loader only when the function that uses it, or a function enclosing that use, calls `officeOnly` or `requireRole` imported from the tenancy module, that the call precedes the use, and that a call in a different function does not count. The exit path still excuses every unused import when any function in the file has a guard:

```907:909:eslint.config.mjs
        const fileGuarded = scopes.some(scope => scope.functionNode && scope.guards.length > 0)
        for (const [local, spec] of importedNodes) {
          if (!usedLocals.has(local) && !fileGuarded) {
```

That guard is not in a function enclosing the import, and it sits after the import, so it does not precede the use. `server/core/import-gate.test.ts` locks the carve-out: an unused `mailOutboxStore` import plus a later `requireRole` in the handler is expected to pass (`toEqual([])`).

### Judgement

**Duplicated Code** — `server/core/import-gate.test.ts`. `allows an imported role call that precedes the loader use` repeats the `officeOnly` fixture already asserted in `allows the loader when the same handler calls officeOnly or requireRole`. Keep the renamed `requireRole as allow` case.

**Mysterious Name** — same file. `it('reports a local no-op named officeOnly')` also asserts `tenancy.officeOnly(...)` and `officeOnly` imported from `transfers`. The title covers only the first fixture.

No test was weakened (`AGENTS.md` Workflow). The old allow (nested loader, `requireRole` after the inner function) is now a reject in `reports a role call that follows the loader use`, matching the new “precedes” sentence. Setting ADR-0050 to accepted and updating the index matches `docs/adr/README.md` (`proposed` → `accepted`). The Decision text is the text being accepted, not a later edit of an accepted ADR.

### Spec

## Spec

ADR-0050 is marked accepted. The rule message cites ADR-0050. `hit`, `remember`, and `current` are now `recordLoaderUse`, `recordImportedLoader`, and `activeScope`. The three requested tests are present.

### (a) Missing or partial

**Tenancy is not the real role module. That choice is a gap, not a match.**

Spec: "officeOnly/requireRole count only when imported from the real role module (not a local function or any same-named callee)."

The rule treats a path whose last segment is `tenancy` (`workerLoaderRoleModule`) as that module. `server/modules/tenancy/index.ts` exports neither `officeOnly` nor `requireRole`. `requireRole` does not exist under `server/` outside the lint fixtures. `officeOnly` exists only as file-local functions in other modules, which the rule correctly ignores. The passing fixtures (`import { officeOnly } from '../modules/tenancy'`) are not imports of a real binding, and the accepted ADR says a future route does exactly that import. Rejection of local and same-named callees is in place. The positive case is not an import the program can write. This diff was not required to add the exports. Until they exist, "real" is only a path segment.

### (b) Scope creep

None. The extra fixtures (shadowing, `tenancy.officeOnly`, an import from `transfers`, `requireRole as allow`, a guard written after a nested function) lock those same two sentences. Naming tenancy in the ADR is the module choice above, not a second behavior.

### (c) Implemented but wrong

**An unused loader import is covered by a guard in any other function.**

Spec: "only when the call precedes the loader use in the same handler or an enclosing function." This diff's ADR line: "a call in a different function do not count."

`fileGuarded` is true when any function contains a real guard, and that suppresses the unused-import report with no order check. A `requireRole` call in a sibling function lets `import { mailOutboxStore }` through. Uses inside a handler walk only parents, so the hole is the unused-import path. The sibling-function test still calls a local `officeOnly`, not a tenancy import, so it does not lock the real-import case.
