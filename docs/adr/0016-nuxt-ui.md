# UI: Nuxt UI + Tailwind v4

Status: proposed

## Context

`CHARTER.md` names Nuxt UI as the UI framework (tech stack, and WBS 0.2). The screens that shipped first were semantic HTML and `app/assets/shell.css`, and that choice was not recorded. The Transfer form (#18) and the dispatcher board (#29) need date and time pickers, modals, toasts, selects, and tables that meet WCAG 2.2 AA.

Three ways to get there were on the table. Keep writing the controls by hand. Adopt shadcn-vue. Adopt the framework the Charter already names.

The theme already follows the system unless this browser has stored `light` or `dark` under `transferpro-theme`, and that choice has to be on the page before first paint.

## Decision

We will use Nuxt UI v4 (`@nuxt/ui`) with Tailwind CSS v4. It is the only UI library. We will not mix in shadcn-vue or any other kit. When Nuxt UI lacks a component, we will build it from the Reka UI primitives Nuxt UI already depends on, and style it with Nuxt UI theme tokens.

`@nuxt/ui` 4.11.3 accepts this repo's Nuxt 4.5 (`@nuxt/schema` ^4.5.2), TypeScript ^6, Zod ^4, and Vue Router ^5. `@nuxtjs/i18n` 10 stays beside it. The module registers `@nuxtjs/color-mode`, `@nuxt/icon`, and `@nuxt/fonts`.

The theme uses `@nuxtjs/color-mode`, not the hand-written head script. `preference` is `system`, `fallback` is `light`, and `storageKey` is `transferpro-theme`. A stored `light` or `dark` value is the same string the previous script wrote, so an existing choice still applies. The module's head script sets the `light` or `dark` class on `html` before paint. A toggle writes only `light` or `dark`, never `system`. The button keeps both labels in the DOM, and the class shows one of them, so the label does not wait on hydration.

Semantic colours are Nuxt UI aliases. `primary` is Tailwind `blue`, in place of the old focus `#0b4f8a`. `neutral` is `stone`, in place of the old paper `#f4f1ea` and ink `#1c1915`. `error` is `red`, in place of the old danger `#8c1d18`. The typeface is `system-ui`. `@nuxt/fonts` is off, so no webfont is fetched.

`UApp` receives the Nuxt UI locale for the active i18n locale, `hr` or `en`. Both ship with Nuxt UI. Copy stays in `i18n/locales/hr.json` and `en.json`.

Icons are the Lucide set Nuxt UI already uses. `@iconify-json/lucide` is installed, the client bundle scans our source, the server bundle is local, and `icon.fallbackToApi` is false. An icon we have not installed is missing. It is not requested from the Iconify CDN.

Inputs stay at 16px. The input theme's `md` and `xl` sizes are `text-base`, so a phone browser does not zoom the field on focus. Controls that are tapped use size `xl`. Labels stay on the controls. An error has `role="alert"`. A loading or saved message has `role="status"`.

A successful settings save, invitation, role change, or removal bumps a shared counter. `AuditLog` watches that counter and reloads.

## Rejected

Hand-written CSS. We would hand-build accessible pickers, modals, toasts, and tables for #18 and #29. The cost is meeting WCAG 2.2 AA on those controls.

shadcn-vue. It copies component source into this repo for us to maintain. A second styling system would fight Nuxt UI tokens.

## Consequences

New screens use Nuxt UI components and tokens. A second library would fight the theme and the accessibility work already in these controls.

`app/assets/shell.css` is gone. The system font and the button cursor live in `app/assets/css/main.css`. Each page's `main` stays at most 28rem, the width the shell used.

Dark mode is the `dark` class, not `data-theme`.

The audit list updates after a successful change on the same page. The Refresh button remains.

`vue-demi`'s postinstall is allowed in `pnpm-workspace.yaml`. VueUse, which Nuxt UI pulls in, needs that script to point the package at Vue 3.
