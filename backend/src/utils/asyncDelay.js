/** Puppeteer-compatible delay (replaces removed `page.waitForTimeout`). */
export function delayMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
