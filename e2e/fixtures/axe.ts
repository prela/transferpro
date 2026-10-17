import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'

/**
 * WCAG 2.2 AA. axe tags are not cumulative: 2.2 AA is the new criteria,
 * and the earlier A/AA tags still have to be named.
 */
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/**
 * Nuxt UI's dialog enter is `scale-in` at 200ms (opacity 0 → 1). axe reads
 * the blended color, so a primary button at ~90% opacity fails 4.5:1 on a
 * fast runner and passes once the fade ends. Two seconds covers that enter.
 * Motion still running after that does not block the check: axe runs, and
 * the leftover count is warned. The #304 contrast miss does not reproduce
 * on this axe, so there is no regression spec for it.
 */
const MOTION_TIMEOUT_MS = 2_000

/**
 * Wait until finite CSS animations and transitions on the page have finished.
 * axe runs after this, including when the timeout expires. Infinite animations
 * (a loading spinner) never finish, so they stay out of the wait. The toast
 * progress bar does too: its `transition-transform` restarts on every tick.
 */
async function waitForCssMotion(page: Page) {
  const remaining = await page.evaluate(async (timeoutMs) => {
    const deadline = performance.now() + timeoutMs

    // A transition scheduled this frame is absent from getAnimations() until
    // the next frame. Two idle frames in a row means nothing finite is in flight.
    const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

    const finiteRunning = () => document.getAnimations().filter((animation) => {
      // playState is idle, running, paused, or finished. `pending` is a
      // separate boolean, true while an asynchronous play() or pause() has
      // not taken effect. It is not a playState.
      if (!animation.pending && animation.playState !== 'running')
        return false
      const effect = animation.effect
      const target = effect !== null && 'target' in effect ? effect.target : null
      // Toast countdown. The indicator's transform transition is replaced on
      // each progress tick, so `finished` never arrives.
      if (target instanceof Element && target.closest('[data-slot="progress"]') !== null)
        return false
      if (effect !== null && 'getTiming' in effect && effect.getTiming().iterations === Infinity)
        return false
      return true
    })

    let idleFrames = 0
    while (performance.now() < deadline) {
      const running = finiteRunning()
      if (running.length === 0) {
        idleFrames += 1
        if (idleFrames >= 2)
          return 0
        await nextFrame()
        continue
      }
      idleFrames = 0
      // finished rejects when the animation is cancelled. Sample again.
      await Promise.race([
        Promise.all(running.map(animation => animation.finished.catch(() => undefined))),
        new Promise<void>(resolve => setTimeout(resolve, 50)),
      ])
    }
    return finiteRunning().length
  }, MOTION_TIMEOUT_MS)
  if (remaining > 0)
    console.warn(`CSS animations still running after ${MOTION_TIMEOUT_MS}ms before the axe check: ${remaining}`)
}

export async function expectNoAxeViolations(page: Page) {
  await waitForCssMotion(page)
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze()
  const violations = results.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map(node => node.target.join(' ')).slice(0, 5),
  }))
  expect(violations).toEqual([])
}
