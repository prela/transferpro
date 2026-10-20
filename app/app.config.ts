// Above the Ride and catalog slideover (z-60). Reka copies this z-index
// onto the popper wrapper. auto paints under that panel, and the panel
// keeps pointer-events: none, so the menu is clickable and invisible.
const popperZ = 'z-[70]'

export default defineAppConfig({
  ui: {
    colors: {
      // Blue stays the action colour. Slate is the cool paper of ADR-0040.
      primary: 'blue',
      neutral: 'slate',
    },
    dropdownMenu: { slots: { content: popperZ } },
    select: { slots: { content: popperZ } },
    selectMenu: { slots: { content: popperZ } },
    inputMenu: { slots: { content: popperZ } },
    popover: { slots: { content: popperZ } },
    tooltip: { slots: { content: popperZ } },
    button: {
      compoundVariants: [
        {
          // Nuxt UI's solid primary hover and active are `bg-primary/75`.
          // White on that wash is under 4.5:1. primary-600 is Tailwind
          // blue-600 (#155dfc), 5.25:1 with --tp-on-primary. Dark rest
          // keeps text-inverted (slate-900) on blue-500; that label is
          // 3.4:1 on this shade. Active is the same wash, so it matches.
          color: 'primary',
          variant: 'solid',
          class: 'hover:bg-primary-600 hover:text-[var(--tp-on-primary)] active:bg-primary-600 active:text-[var(--tp-on-primary)]',
        },
      ],
    },
    table: {
      slots: {
        // The list wraps the table in a focusable region. This root must not
        // scroll as well, or the keyboard cannot reach that scroll (WCAG 2.1.1).
        root: 'relative overflow-visible',
        tr: 'min-h-[var(--tp-row)] data-[selected=true]:bg-elevated/50',
      },
    },
  },
})
