/**
 * Dark surface variants for the #243 prototype.
 *
 * ADR-0040 fixes the border and text colours and leaves the four dark
 * surface shades open. The structural border `#526077` stays at least 2:1
 * only while every surface is at least as dark as `#263246`, so both
 * variants live under that ceiling. `adr` keeps the measured panel
 * `#1e293b` (slate-800, 5.71:1 with slate-400). `lift` drops the frame
 * so the sidebar separates from the working surface. Row height is the
 * other open choice: 36 px or 40 px.
 */

export const PROTOTYPE_VARIANTS = ['adr-36', 'adr-40', 'lift-36', 'lift-40'] as const

export type PrototypeVariant = (typeof PROTOTYPE_VARIANTS)[number]

export interface SurfaceTokens {
  frame: string
  working: string
  panel: string
  hover: string
  text: string
  secondary: string
  control: string
  structural: string
}

/** Ratios of slate-400 (dark) or slate-600 (light) and of the two borders. */
export interface SurfaceContrast {
  text: string
  control: string
  structural: string
}

const light: SurfaceTokens = {
  frame: '#e8eef5',
  working: '#f8fafc',
  panel: '#ffffff',
  hover: '#e2e8f0',
  text: '#0f172a',
  secondary: '#475569',
  control: '#64748b',
  structural: '#cbd5e1',
}

const darkShared = {
  text: '#e2e8f0',
  secondary: '#94a3b8',
  control: '#7A8BA3',
  structural: '#526077',
} as const

const darkSurfaces = {
  adr: {
    frame: '#0f172a',
    working: '#172033',
    panel: '#1e293b',
    hover: '#263246',
  },
  lift: {
    frame: '#070d18',
    working: '#10192a',
    panel: '#1c283c',
    hover: '#263246',
  },
} as const

/** Measured against the secondary text and the two ADR-0040 border colours. */
const darkContrast = {
  adr: {
    frame: { text: '6.96', control: '5.14', structural: '2.80' },
    working: { text: '6.34', control: '4.69', structural: '2.56' },
    panel: { text: '5.71', control: '4.21', structural: '2.30' },
    hover: { text: '5.03', control: '3.72', structural: '2.03' },
  },
  lift: {
    frame: { text: '7.58', control: '5.60', structural: '3.05' },
    working: { text: '6.86', control: '5.06', structural: '2.76' },
    panel: { text: '5.78', control: '4.27', structural: '2.33' },
    hover: { text: '5.03', control: '3.72', structural: '2.03' },
  },
} as const

const lightContrast = {
  frame: { text: '6.49', control: '4.07', structural: '1.27' },
  working: { text: '7.24', control: '4.55', structural: '1.42' },
  panel: { text: '7.58', control: '4.76', structural: '1.48' },
  hover: { text: '6.15', control: '3.86', structural: '1.20' },
} as const

export function isPrototypeVariant(value: unknown): value is PrototypeVariant {
  return typeof value === 'string' && (PROTOTYPE_VARIANTS as readonly string[]).includes(value)
}

export function parsePrototypeVariant(value: unknown): PrototypeVariant {
  return isPrototypeVariant(value) ? value : 'adr-36'
}

export function variantParts(variant: PrototypeVariant): { surface: 'adr' | 'lift', row: 36 | 40 } {
  const [surface, row] = variant.split('-')
  return {
    surface: surface === 'lift' ? 'lift' : 'adr',
    row: row === '40' ? 40 : 36,
  }
}

export function surfaceTokens(variant: PrototypeVariant, dark: boolean): SurfaceTokens {
  if (!dark)
    return light
  const { surface } = variantParts(variant)
  return { ...darkShared, ...darkSurfaces[surface] }
}

export function surfaceContrast(variant: PrototypeVariant, dark: boolean) {
  if (!dark)
    return lightContrast
  return darkContrast[variantParts(variant).surface]
}
