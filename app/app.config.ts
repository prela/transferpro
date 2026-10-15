export default defineAppConfig({
  ui: {
    colors: {
      // Blue stays the action colour. Slate is the cool paper of ADR-0040.
      primary: 'blue',
      neutral: 'slate',
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
