# 247 sign-in card

Out of scope: password recovery (#241), replacing the text mark with a logo, and changing where each role lands after sign-in.

## Decisions

- The English subtitle is "Dispatch system for transfers". ADR-0038 states only the Croatian line.
- `AuthFrame` is the shared frame. The mark is the only `h1` ("Transferpro"). The invitation title is an `h2`.
- Language and theme stay `size="sm"` on this frame, including the phone.
- The invitation uses the same card as sign-in: each action button is full width, and a form error sits under that button. The owner confirmed this on 15 October 2026 after the first review had left the invite controls narrower.
- Error alerts on these screens set the description to `text-sm text-default opacity-100`. The error colour on the error wash is under 4.5:1 in light (ADR-0040).

Local check before push:

`pnpm exec nuxi build && E2E_PORT=3033 PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" pnpm test:e2e`

162 passed.

`pnpm lint`, `pnpm typecheck`, and `pnpm test` passed on the first commit (501 tests). No migration.

Changed specs, and why:

- `e2e/sign-in-card.spec.ts` — new `@phone` coverage: card on the frame, both themes, axe, English once, error under the sign-in button, no forgotten-password link.
- `e2e/fixtures/ui.ts` — sign-out now expects the Transferpro mark, which replaced the Prijava heading.
- `e2e/auth.spec.ts` — the same mark; the wrong-password alert is under the button.
- `e2e/office-shell.spec.ts` — the narrow column is the card, with the mark, the subtitle, and the invitation title as `h2`.
- `e2e/office-home.spec.ts`, `e2e/signed-out-pages.spec.ts`, `e2e/platform.spec.ts`, `e2e/audit.spec.ts`, `e2e/expected-arrival.spec.ts`, `e2e/record-landing-time.spec.ts`, `e2e/landing-time.spec.ts` — a signed-out screen is the Transferpro mark, not the Prijava heading.
- `e2e/accept-invite-invalid.spec.ts`, `e2e/accept-invite-existing.spec.ts` — the invitation title is `h2` under the mark.
- `e2e/settings-profile.spec.ts` — English on the signed-out card changes the subtitle and the Sign in button; the heading stays Transferpro.
- `e2e/password.spec.ts` — the account-opening button fills the card and the length error sits under it.

## Code review

Fixed point `origin/develop`, commit `2f81cba`. The reports below are the review as it ran. A later commit aligns the invitation button and the form error with sign-in, which is what the owner asked for after that review.

### Standards

Ref `origin/develop` (`89154ff`) resolves. Diff is non-empty (19 files, `2f81cba`).

**Hard:** none.

Checked against `AGENTS.md`, `docs/agents/working-rules.md` (i18n and theme, sign-in, invitations), ADR-0016, ADR-0038, ADR-0040, and `GLOSSARY.md`. Both locales ship `signIn.mark` and `signIn.subtitle`. The frame uses Nuxt UI (`UCard`) and `--tp-frame` / `--tp-panel`. The card is `max-w-md` (28rem). Pickers are `size="sm"` and top right. Errors keep `role="alert"`. The new spec covers phone, both themes, and an English smoke. Heading assertions were retargeted, not dropped.

**Judgement — Duplicated Code.** The contrast override is the same string on every alert in the change:

```182:182:app/pages/accept-invite.vue
      :ui="{ description: 'text-sm text-default opacity-100' }"
```

Same prop at `accept-invite.vue` (four alerts) and `app/pages/index.vue`. ADR-0040’s 4.5:1 rule is why it exists; one shared alert (or a theme slot) would keep that pair in one place. The token-pair unit test does not lock this override.

**Judgement — Duplicated Code.** “Alert sits under the button” is measured twice. `e2e/auth.spec.ts`:

```70:74:e2e/auth.spec.ts
  const submitBox = await submit.boundingBox()
  const alertBox = await alert.boundingBox()
  expect(alertBox!.y).toBeGreaterThan((submitBox?.y ?? 0) + (submitBox?.height ?? 0) - 1)
```

`expectBelow` in `e2e/sign-in-card.spec.ts` is the same shape. `expectCentredCard` also repeats the 28rem `main` measure already in `expectNarrowColumn` (`e2e/office-shell.spec.ts`); the extra checks (centring, `--tp-frame`) are new.

**Not flagged.** Comments say “Language” (`AuthFrame.vue`, `expectSmallPickers`). `GLOSSARY.md` avoids that word for Locale, but ADR-0038 uses “Language and theme” for these pickers, so the glossary does not override it.

### Spec

#### (a) Missing or partial

- **Handoff.** "Every e2e spec that pinned the old behaviour is rewritten to assert the new equivalent, never deleted without a replacement; the handoff flags each changed spec and why." The rewrites are in the diff (old "Prijava" / "Sign in" / "Prihvati pozivnicu" headings now assert "Transferpro" or the level-2 invite title; no spec file was deleted). There is no `docs/handoff/247-*.md` that names each changed spec and why.

#### (b) Scope creep

- Invitation submit buttons gained `block`, and the invitation form error moved from above the form to under the button. "a full-width \"Prijavi se\", and the error below" is the sign-in form. "The invitation screen uses the same frame and card" does not ask to change the invite form's button width or error position.

#### (c) Implemented but wrong

None. The card, mark, Croatian subtitle, full-width "Prijavi se", error under that button, top-right pickers, absent "Zaboravljena lozinka?" link, shared invitation frame, `@phone` light/dark axe coverage, and one English pass match the sign-in paragraph and the other acceptance criteria. Role landings are unchanged and still match "office staff land on Home, a Driver on their Rides, and the Superadmin on the platform."
