/**
 * Contrast table for the lift-36 palette (ADR-0040, owner decision 15.10.2026).
 *
 * Light surfaces are the ADR-0040 starting values. Dark surfaces are lift-36:
 * frame `#070d18`, working `#10192a`, panel `#1c283c`, hover `#263246`.
 * The office row is 36 px. The `adr` surfaces and the 40 px row are not here.
 *
 * Rules: text 4.5:1, a control boundary 3:1, a dark structural border 2:1
 * against each surface, badge text 4.5:1. Light structural borders have no
 * 2:1 rule (ADR-0040). Their minimum is 1, and contrast is never below 1,
 * so that row does not catch a same-colour border. The measured-ratio test
 * locks those light borders.
 */

export const THEME_ROW_PX = 36

export type ContrastTheme = 'light' | 'dark'
export type ContrastKind = 'text' | 'control' | 'structural' | 'badge'

export interface ContrastPair {
  theme: ContrastTheme
  kind: ContrastKind
  name: string
  foreground: string
  background: string
  minimum: number
}

interface Surfaces {
  frame: string
  working: string
  panel: string
  hover: string
  text: string
  secondary: string
  control: string
  structural: string
}

const light: Surfaces = {
  frame: '#e8eef5',
  working: '#f8fafc',
  panel: '#ffffff',
  hover: '#e2e8f0',
  text: '#0f172a',
  secondary: '#475569',
  control: '#64748b',
  structural: '#cbd5e1',
}

const dark: Surfaces = {
  frame: '#070d18',
  working: '#10192a',
  panel: '#1c283c',
  hover: '#263246',
  text: '#e2e8f0',
  secondary: '#94a3b8',
  control: '#7A8BA3',
  structural: '#526077',
}

/**
 * Ride-state badge text on its own fill, or on the panel when the badge is
 * outlined or muted. Step 11 paints these; the pairs are locked now.
 */
const badges: Record<ContrastTheme, Array<{ name: string, foreground: string, background: string }>> = {
  light: [
    { name: 'unassigned', foreground: '#78350f', background: '#fef3c7' },
    { name: 'waiting', foreground: '#92400e', background: light.panel },
    { name: 'assigned', foreground: '#0f172a', background: '#e2e8f0' },
    { name: 'accepted', foreground: '#ffffff', background: '#1d4ed8' },
    { name: 'in-progress', foreground: '#ffffff', background: '#0e7490' },
    { name: 'done', foreground: '#ffffff', background: '#047857' },
    { name: 'no-show', foreground: '#b91c1c', background: light.panel },
    { name: 'cancelled', foreground: light.secondary, background: light.panel },
  ],
  dark: [
    { name: 'unassigned', foreground: '#fde68a', background: '#78350f' },
    { name: 'waiting', foreground: '#fcd34d', background: dark.panel },
    { name: 'assigned', foreground: '#e2e8f0', background: '#263246' },
    { name: 'accepted', foreground: '#dbeafe', background: '#1e3a8a' },
    { name: 'in-progress', foreground: '#cffafe', background: '#155e75' },
    { name: 'done', foreground: '#d1fae5', background: '#065f46' },
    { name: 'no-show', foreground: '#fca5a5', background: dark.panel },
    { name: 'cancelled', foreground: dark.secondary, background: dark.panel },
  ],
}

const surfaceNames = ['frame', 'working', 'panel', 'hover'] as const

export function themeContrastPairs(): ContrastPair[] {
  const pairs: ContrastPair[] = []
  for (const theme of ['light', 'dark'] as const) {
    const surfaces = theme === 'light' ? light : dark
    for (const name of surfaceNames) {
      const background = surfaces[name]
      pairs.push(
        { theme, kind: 'text', name: `text/${name}`, foreground: surfaces.text, background, minimum: 4.5 },
        { theme, kind: 'text', name: `secondary/${name}`, foreground: surfaces.secondary, background, minimum: 4.5 },
        { theme, kind: 'control', name: `control/${name}`, foreground: surfaces.control, background, minimum: 3 },
        {
          theme,
          kind: 'structural',
          name: `structural/${name}`,
          foreground: surfaces.structural,
          background,
          minimum: theme === 'dark' ? 2 : 1,
        },
      )
    }
    pairs.push(theme === 'light'
      ? { theme, kind: 'text', name: 'primary-button', foreground: '#ffffff', background: '#2563eb', minimum: 4.5 }
      : { theme, kind: 'text', name: 'primary-button', foreground: '#0f172a', background: '#3b82f6', minimum: 4.5 })
    // Solid hover is Tailwind blue-600, not the resting token and not
    // bg-primary/75. White on #155dfc is 5.25:1. Slate-900 on it is 3.4:1,
    // so the hover label is white in both themes (app.config.ts).
    pairs.push({
      theme,
      kind: 'text',
      name: 'primary-button-hover',
      foreground: '#ffffff',
      background: '#155dfc',
      minimum: 4.5,
    })
    // The full-screen meet sign uses the text token on the working surface
    // (modal content is bg-default, the sign is text-highlighted). ADR-0040.
    pairs.push({
      theme,
      kind: 'text',
      name: 'tabla',
      foreground: surfaces.text,
      background: surfaces.working,
      minimum: 4.5,
    })
    for (const badge of badges[theme]) {
      pairs.push({
        theme,
        kind: 'badge',
        name: badge.name,
        foreground: badge.foreground,
        background: badge.background,
        minimum: 4.5,
      })
    }
  }
  return pairs
}

export function themeContrastFailures(pairs: ContrastPair[] = themeContrastPairs()): ContrastPair[] {
  return pairs.filter(pair => contrastRatio(pair.foreground, pair.background) < pair.minimum)
}

/** WCAG 2 relative luminance contrast. Order of the two colours does not matter. */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const expanded = value.length === 3
    ? value.split('').map(channel => channel + channel).join('')
    : value
  const rgb = Number.parseInt(expanded, 16)
  const red = channel((rgb >> 16) & 255)
  const green = channel((rgb >> 8) & 255)
  const blue = channel(rgb & 255)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function channel(byte: number): number {
  const srgb = byte / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}
