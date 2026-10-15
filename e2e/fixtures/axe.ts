import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'

/**
 * WCAG 2.2 AA. axe tags are not cumulative: 2.2 AA is the new criteria,
 * and the earlier A/AA tags still have to be named.
 */
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze()
  const violations = results.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map(node => node.target.join(' ')).slice(0, 5),
  }))
  expect(violations).toEqual([])
}
