Out of scope: bumping other outdated direct dependencies, and adding an audit ignore for GHSA-587h-7wmj-h5pm.

## Decisions

- Overrides are `launch-editor: 2.14.2` and `vite: ^8.3.3`, the pins the ticket named. The lockfile resolves Vite to 8.3.4, which is inside that range and past the 8.3.3 fix. `postcss@8.5.31` and `nanoid@3.3.20` came in with that Vite.
- The shell guard blocks `pnpm install` for a local agent. `pnpm update launch-editor vite` re-resolved those transitive packages and wrote the lockfile.
- Drop the two override lines once Nuxt and Vitest depend on `launch-editor` ≥ 2.14.2 and `vite` ≥ 8.3.3. The comment in `pnpm-workspace.yaml` is the reminder.

## Code review

## Standards

No hard violations. `CHARTER.md` is untouched. The commit is Conventional Commits (`AGENTS.md`). `pnpm-lock.yaml` is generated; peer-range rewrites (`vite: '*'` / `>=6.0` → `^8.3.3`) and the `postcss@8.5.31` / `nanoid@3.3.20` additions are the lockfile following the override. `docs/agents/working-rules.md` (Audit ignores) limits `ignoreGhsas` to dev-only or build-time advisories absent from the production bundle, with a why-and-when comment. This change pins instead of ignoring `GHSA-587h-7wmj-h5pm`, which fits that rule: Vite is on the production graph.

**Judgement call** — `pnpm-workspace.yaml` overrides. Not a Fowler smell, and not a hard breach (the why-and-when sentence applies only to `ignoreGhsas`).

```yaml
# launch-editor 2.14.1 (via nuxt > @nuxt/devtools) and vite 8.3.1 (via vitest) are GHSA-587h-7wmj-h5pm (#393).
overrides:
  launch-editor: 2.14.2
  vite: ^8.3.3
  web-vitals: 6.2.2
```

`launch-editor` and `web-vitals` are exact pins. `vite: ^8.3.3` stays open through the rest of 8.x, so a later 8.x can move without another edit. The comment names the advisory and the issue, and does not say when to drop the lines, unlike `minimumReleaseAgeExclude` and `ignoreGhsas` in the same file.

**Baseline smells:** none.

## Spec

**(a) Missing or partial.** None. `pnpm-workspace.yaml` adds `launch-editor: 2.14.2` and `vite: ^8.3.3` ("Add overrides in pnpm-workspace.yaml: launch-editor: 2.14.2 and vite: ^8.3.3"). The lockfile drops `launch-editor@2.14.1` and `vite@8.3.1`; devtools depends on `launch-editor: 2.14.2` and vitest is wired to `vite@8.3.4` ("launch-editor 2.14.1 … fixed in 2.14.2"; "vite 8.3.1 via vitest: fixed in 8.3.3"). Only `pnpm-lock.yaml` and `pnpm-workspace.yaml` change ("No app code changes"). `auditConfig.ignoreGhsas` is untouched ("Do not add an ignore without approval"). Audit, build, lint, typecheck, vitest, and Playwright are parent-verified, not visible in the diff ("pnpm audit --audit-level=high is green"; "build, lint, typecheck, test and test:e2e are green").

**(b) Scope creep.** None. Lockfile edits are peer-key rewrites from `vite@8.3.1` to `vite@8.3.4`, plus `postcss@8.5.31` (vite’s dependency, and `@vue/compiler-sfc` moving 8.5.28 → 8.5.31 on the same range) and `nanoid@3.3.20` under that postcss. That matches a lockfile refresh ("Run pnpm install and commit the lockfile"). The extra override comment is not behaviour.

**(c) Implemented but wrong.** None. `vite: ^8.3.3` resolving to 8.3.4 satisfies the caret and is past the fix version. `launch-editor` is the exact 2.14.2 pin.

After this review: the drop-condition comment is in `pnpm-workspace.yaml` (`4efec03`). The caret on Vite stays, because the ticket asked for `^8.3.3`.
