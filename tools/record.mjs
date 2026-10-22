// Record every network request the live site makes in a real browser.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const pages = process.argv.slice(2);
const urls = new Set();
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844, mobile: true }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: vp.mobile ? 3 : 1 });
  const page = await ctx.newPage();
  page.on('request', r => urls.add(r.url()));
  for (const u of pages) {
    await page.goto(u, { waitUntil: 'networkidle', timeout: 90000 }).catch(e => console.error(u, e.message));
    for (let y = 0; y < 40; y++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(150); }
    if (vp.mobile) {
      const btn = page.locator('.wp-block-navigation__responsive-container-open').first();
      if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(800); }
    }
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  await ctx.close();
}
await browser.close();
writeFileSync(process.env.OUT || 'requests.txt', [...urls].sort().join('\n') + '\n');
console.log(urls.size, 'requests');
