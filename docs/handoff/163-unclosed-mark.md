# 163 Unclosed mark

Out of scope: the day board is #29; the settings reorg is later.

## Decisions

- The mark is `unclosedMark` on an in-progress row from `buildOfficeHome`. It is `nowMs - pickup >= 60 minutes`, from the scheduled pickup, including an earlier day. Do not read a landing time, and do not add a Tenant setting.
- #29 uses that same flag when the day board is built. Do not define a second clock.
- The office home shows the locale string only. No fourth list, no extra count, no mail, and no change to done, no-show, cancel, or assignment.

## Code review

## Standards

**Hard violations: none.** Judgement calls: 2.

### `shared/office-home.ts`
(a) None. The flag is derived at read (`nowMs - pickup >= UNCLOSED_MARK_MS`), fixed, not stored, and not a fourth list or eighth count (ADR-0027). One snapshot still returns the three lists and seven counts (ADR-0024). Zod stays on the response.
(b) Judgement — **Repeated Switches**. The same `list` cascade counts, then pushes:

```196:209:shared/office-home.ts
    if (list === 'unassigned') {
      unassigned.push({ ...shown, unassignedAlarm: ... })
    }
    else if (list === 'waitingOnAcceptance') {
      waitingOnAcceptance.push(shown)
    }
    else if (list === 'inProgress') {
      inProgress.push({ ...shown, unclosedMark: nowMs - pickup >= UNCLOSED_MARK_MS })
    }
```

### `shared/office-home.test.ts`
(a) None. (b) None. Expected guests are literals.

### `server/api/office-home.rls.test.ts`
(a) None. Driver 403, the other Tenant’s empty snapshot, and no audit write on the read still hold (AGENTS.md). (b) None.

### `app/components/OfficeHome.vue`
(a) None. `officeHome.unclosedMark` is text, not color. Refresh is one click; no timer (ADR-0024, ADR-0027). `UButton` / `UAlert` and theme tokens; no second UI kit (`docs/agents/working-rules.md`, i18n and theme).
(b) Judgement — **Duplicated Code**. The new mark copies the alarm paragraph, inside a third copy of the same article shell:

```192:197:app/components/OfficeHome.vue
              <p v-if="ride.unassignedAlarm" class="mt-1">
                {{ t('officeHome.unassignedAlarm') }}
              </p>
```

```272:277:app/components/OfficeHome.vue
              <p v-if="ride.unclosedMark" class="mt-1">
                {{ t('officeHome.unclosedMark') }}
              </p>
```

### `i18n/locales/en.json`, `i18n/locales/hr.json`
(a) None. Both ship `unclosedMark`. Copy avoids glossary terms warning, unassigned alarm, and overdue. (b) None.

### `e2e/office-home.spec.ts`
(a) None. The spec covers hr and en, and light and dark (working-rules). (b) None. Edits across locale, e2e, ADR, and glossary are required by those standards, so Shotgun Surgery is suppressed.

### `docs/adr/0027-unclosed-mark.md`, GLOSSARY Unclosed mark, ADR-0027 row
(a) None. Term, avoid-line, and the accepted README row match the decision. (b) None.

## Spec

**(a) Missing or partial:** None.

**(b) Not asked for:** None. No day board, no fourth list, no extra count, no setting, no stored or audited flag, no mail, and no change to done, no-show, cancel, or assignment.

**(c) Implemented but wrong:** None.

Checked against the spec: `nowMs - pickup >= 60 minutes` is inclusive of pickup+60 and uses scheduled `pickup_at` only, so a landing or a late assignment cannot move the instant. The first 60 minutes stay on the in-progress list with the flag off. Unassigned rides and rides waiting on acceptance have no flag. The flag is computed in the office-home read for admin and dispatcher, including earlier days.
