import { expect, it } from 'vitest'
import { contrastRatio, THEME_ROW_PX, themeContrastFailures, themeContrastPairs } from './theme-contrast'

// Black on white is the WCAG worked example. It pins the formula.
it('computes the contrast of black on white as 21:1', () => {
  expect(round2(contrastRatio('#000000', '#ffffff'))).toBe(21)
})

// Published lift-36 ratios from the #243 prototype, measured against
// slate-400, the control border, and the structural border.
it('matches the measured lift-36 and light surface ratios', () => {
  expect(measured('#94a3b8', '#7A8BA3', '#526077', '#070d18')).toEqual({ text: 7.58, control: 5.6, structural: 3.05 })
  expect(measured('#94a3b8', '#7A8BA3', '#526077', '#10192a')).toEqual({ text: 6.86, control: 5.06, structural: 2.76 })
  expect(measured('#94a3b8', '#7A8BA3', '#526077', '#1c283c')).toEqual({ text: 5.78, control: 4.27, structural: 2.33 })
  expect(measured('#94a3b8', '#7A8BA3', '#526077', '#263246')).toEqual({ text: 5.03, control: 3.72, structural: 2.03 })

  expect(measured('#475569', '#64748b', '#cbd5e1', '#e8eef5')).toEqual({ text: 6.49, control: 4.07, structural: 1.27 })
  expect(measured('#475569', '#64748b', '#cbd5e1', '#f8fafc')).toEqual({ text: 7.24, control: 4.55, structural: 1.42 })
  expect(measured('#475569', '#64748b', '#cbd5e1', '#ffffff')).toEqual({ text: 7.58, control: 4.76, structural: 1.48 })
  expect(measured('#475569', '#64748b', '#cbd5e1', '#e2e8f0')).toEqual({ text: 6.15, control: 3.86, structural: 1.2 })
})

it('keeps every text, control, structural, and badge pair at or above its rule', () => {
  const pairs = themeContrastPairs()
  // The list is the spec. Dropping a surface or a badge fails here, not only a ratio.
  expect(pairs.map(pair => `${pair.theme}:${pair.kind}:${pair.name}`).sort()).toEqual(expectedPairs().sort())
  expect(pairs.filter(pair => pair.kind === 'structural' && pair.theme === 'dark').every(pair => pair.minimum === 2)).toBe(true)
  expect(pairs.filter(pair => pair.kind === 'badge').every(pair => pair.minimum === 4.5)).toBe(true)
  expect(themeContrastFailures()).toEqual([])
})

// Owner decision 15.10.2026: lift-36, not 40.
it('locks the office row height at 36 px', () => {
  expect(THEME_ROW_PX).toBe(36)
})

function measured(text: string, control: string, structural: string, surface: string) {
  return {
    text: round2(contrastRatio(text, surface)),
    control: round2(contrastRatio(control, surface)),
    structural: round2(contrastRatio(structural, surface)),
  }
}

function round2(ratio: number): number {
  return Math.round(ratio * 100) / 100
}

const surfaces = ['frame', 'working', 'panel', 'hover'] as const
const badges = ['unassigned', 'waiting', 'assigned', 'accepted', 'in-progress', 'done', 'no-show', 'cancelled'] as const

function expectedPairs(): string[] {
  const names: string[] = []
  for (const theme of ['light', 'dark'] as const) {
    for (const surface of surfaces) {
      names.push(
        `${theme}:text:text/${surface}`,
        `${theme}:text:secondary/${surface}`,
        `${theme}:control:control/${surface}`,
        `${theme}:structural:structural/${surface}`,
      )
    }
    for (const badge of badges)
      names.push(`${theme}:badge:${badge}`)
    names.push(`${theme}:text:primary-button`, `${theme}:text:primary-button-hover`, `${theme}:text:tabla`)
  }
  return names
}
