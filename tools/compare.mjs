// Screenshot the live site and the local clone side by side and report any
// request the clone makes that fails or still goes to WordPress.com.
// Usage: node tools/compare.mjs http://localhost:3000 out-dir
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const local = process.argv[2] || 'http://localhost:3000';
const out = process.argv[3] || 'compare';
mkdirSync(out, { recursive: true });
const WP = /(^|\.)(wordpress\.com|wp\.com|resohead\.com|videopress\.com)$/;

const browser = await chromium.launch();
const viewports = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844, isMobile: true } };
const problems = [];
for (const [name, vp] of Object.entries(viewports)) {
  for (const [label, base] of [['live', 'https://resohead.com'], ['clone', local]]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.isMobile });
    const page = await ctx.newPage();
    if (label === 'clone') {
      page.on('requestfailed', r => problems.push(`${name} FAILED ${r.url()} ${r.failure()?.errorText}`));
      page.on('response', r => { if (r.status() >= 400) problems.push(`${name} ${r.status()} ${r.url()}`); });
      page.on('request', r => { const h = new URL(r.url()).hostname; if (WP.test(h)) problems.push(`${name} WP-HOST ${r.url()}`); });
      page.on('console', m => { if (m.type() === 'error') problems.push(`${name} CONSOLE ${m.text()}`); });
      page.on('pageerror', e => problems.push(`${name} PAGEERROR ${e.message}`));
    }
    await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
    // Trigger lazy images, then return to the top for a stable full-page shot.
    for (let y = 0; y < 60; y++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(60); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);
    // Third-party embeds render differently run to run; hide them in both.
    await page.addStyleTag({ content: 'iframe,video{visibility:hidden!important}' });
    await page.screenshot({ path: `${out}/${name}-${label}.png`, fullPage: true });
    if (name === 'mobile') {
      const btn = page.locator('.wp-block-navigation__responsive-container-open').first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click(); await page.waitForTimeout(800);
        await page.screenshot({ path: `${out}/${name}-menu-${label}.png` });
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log([...new Set(problems)].join('\n') || 'no problems');
