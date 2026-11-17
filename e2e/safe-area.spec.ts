import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures/playwright'
import { seedTenant } from './fixtures/seed'
import { signIn, switchTheme } from './fixtures/ui'

/**
 * Safe areas (issue #567). Playwright cannot report an iOS notch or home
 * indicator, so this pins the contract those insets use and the layout
 * when the insets are zero. A device check covers the real unsafe areas.
 */

test.describe('@phone', () => {
  test('the viewport covers the screen and edge chrome keeps a zero inset', async ({ page }) => {
    await page.goto('/')
    const viewport = page.locator('meta[name="viewport"]')
    await expect(viewport).toHaveCount(1)
    const content = await viewport.getAttribute('content')
    expect(content).toContain('width=device-width')
    expect(content).toContain('initial-scale=1')
    expect(content).toContain('viewport-fit=cover')

    const tenant = await seedTenant('safe-area')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    const phone = (page.viewportSize()?.width ?? 1280) < 1024
    if (!phone)
      return

    const bar = page.getByRole('navigation', { name: 'Odjeljci' })
    const home = bar.getByRole('link', { name: /^Početna, \d+$/ })
    await expect(home).toBeVisible()
    const homeBox = await home.boundingBox()
    expect(homeBox?.height ?? 0).toBeGreaterThanOrEqual(44)

    const barCss = await matchedSafeAreaCss(bar)
    expect(barCss).toContain('safe-area-inset-bottom')
    expect(barCss).toContain('safe-area-inset-left')
    expect(barCss).toContain('safe-area-inset-right')

    const view = page.viewportSize()
    expect(view).not.toBeNull()
    const barBox = await bar.boundingBox()
    expect(barBox).not.toBeNull()
    // A zero inset leaves the bar on the screen edge, as on desktop and Android.
    expect(Math.abs((barBox!.y + barBox!.height) - view!.height)).toBeLessThanOrEqual(1)

    const fab = page.getByRole('button', { name: 'Novi transfer', exact: true })
    await expect(fab).toBeVisible()
    const fabBox = await fab.boundingBox()
    expect(fabBox?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(fabBox?.width ?? 0).toBeGreaterThanOrEqual(44)
    const fabCss = await matchedSafeAreaCss(fab)
    expect(fabCss).toContain('safe-area-inset-bottom')
    const rem = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize))
    expect(Math.abs(view!.height - (fabBox!.y + fabBox!.height) - (5 * rem))).toBeLessThanOrEqual(1)

    const shellCss = await page.evaluate(() => {
      const found: string[] = []
      const visit = (rules: CSSRuleList) => {
        for (const rule of rules) {
          if (rule instanceof CSSStyleRule) {
            if (rule.cssText.includes('safe-area-inset'))
              found.push(rule.cssText)
          }
          else if (rule instanceof CSSGroupingRule) {
            visit(rule.cssRules)
          }
        }
      }
      for (const sheet of document.styleSheets) {
        try {
          visit(sheet.cssRules)
        }
        catch {
          // A cross-origin sheet has no rules to read.
        }
      }
      return found.join('\n')
    })
    expect(shellCss).toContain('safe-area-inset-top')
    expect(shellCss).toContain('safe-area-inset-bottom')
    expect(shellCss).toContain('safe-area-inset-left')
    expect(shellCss).toContain('safe-area-inset-right')
    expect(shellCss).toContain('.tp-safe-close')

    await switchTheme(page, 'dark')
    await expect(home).toBeVisible()
    const darkHome = await home.boundingBox()
    expect(darkHome?.height ?? 0).toBeGreaterThanOrEqual(44)
    const darkBar = await bar.boundingBox()
    expect(darkBar).not.toBeNull()
    expect(Math.abs((darkBar!.y + darkBar!.height) - view!.height)).toBeLessThanOrEqual(1)
  })
})

/** Rules that apply to this element and name a safe-area inset. */
async function matchedSafeAreaCss(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const found: string[] = []
    const visit = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          if (!rule.cssText.includes('safe-area-inset'))
            continue
          try {
            if (element.matches(rule.selectorText))
              found.push(rule.cssText)
          }
          catch {
            // A selector the element cannot match is not its rule.
          }
        }
        else if (rule instanceof CSSGroupingRule) {
          visit(rule.cssRules)
        }
      }
    }
    for (const sheet of document.styleSheets) {
      try {
        visit(sheet.cssRules)
      }
      catch {
        // A cross-origin sheet has no rules to read.
      }
    }
    return found.join('\n')
  })
}
