// Start gameplay once without guessing between multiple controls or following links.
export async function startForCapture(page, { enabled = true, selector = '', timeout = 3000 } = {}) {
  if (!enabled) return { clicked: false, reason: 'disabled' }
  const candidate = selector
    ? page.locator(selector)
    : page.locator('button, input[type="button"], input[type="submit"], [role="button"]')
  const deadline = Date.now() + timeout
  do {
    const matches = []
    for (const control of await candidate.all()) {
      if (!await control.isVisible() || !await control.isEnabled()) continue
      const eligible = await control.evaluate((element, explicit) => {
        if (element.closest('a[href], form') || element.getAttribute('aria-disabled') === 'true') return false
        if (explicit) return true
        const label = element.getAttribute('aria-label') || element.value || element.textContent || ''
        return /^(?:start|play)(?:\s+(?:game|now))?$/i.test(label.trim())
      }, Boolean(selector))
      if (eligible) matches.push(control)
    }
    if (matches.length > 1) return { clicked: false, reason: 'ambiguous' }
    if (matches.length === 1) {
      try { await matches[0].click({ trial: true, timeout: 2000 }) }
      catch (error) {
        if (error.name === 'TimeoutError') return { clicked: false, reason: 'not-actionable' }
        throw error
      }
      await matches[0].click({ timeout: 2000, noWaitAfter: true })
      return { clicked: true }
    }
    if (Date.now() >= deadline) break
    await page.waitForTimeout(Math.min(200, Math.max(0, deadline - Date.now())))
  } while (Date.now() <= deadline)
  return { clicked: false, reason: 'not-found' }
}
