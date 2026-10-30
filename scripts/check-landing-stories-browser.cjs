/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), path = require('node:path');
const { startPreview } = require('./preview-landing-stories.cjs');
const { chromium } = require('./test-browser-runtime.cjs');
(async () => {
  const { server, origin, output } = await startPreview(); let browser, passed = 0;
  try {
    browser = await chromium.launch({ headless: true });
    const fixture = async (options = {}) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...options });
      const page = await context.newPage(), errors = [], images = [];
      page.on('pageerror', e => errors.push(e.message));
      await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        assert.equal(url.origin, origin, 'No production traffic'); assert.equal(req.method(), 'GET', 'No writes');
        if (url.pathname.startsWith('/landing/reviews/')) images.push(url.pathname);
        return route.continue();
      });
      return { context, page, errors, images };
    };
    for (const width of [320, 390, 768, 1280]) {
      const f = await fixture({ viewport: { width, height: 900 }, reducedMotion: 'reduce' }), { page } = f;
      await page.goto(origin + '/landing'); await page.getByRole('heading', { name: '실제 리뷰', exact: true }).waitFor();
      await page.waitForFunction(() => { const img = document.querySelector('.landing-stories-card img'); return img?.complete && img.naturalWidth > 0; });
      assert.ok(f.images.length > 0, 'Original screenshots load without an extra click');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok((await page.locator('.brandIcon').boundingBox()).width <= 40, 'Preview retains the actual image class and dimensions');
      assert.equal(await page.locator('.landing-stories-group').first().locator('.landing-stories-card').count(), 10);
      const cta = page.getByRole('link', { name: '가입하고 프로필 만들기', exact: true });
      assert.ok((await cta.boundingBox()).y < 600, 'Main action visible without a long scroll');
      await page.screenshot({ path: path.join(output, `landing-stories-${width}.png`), fullPage: true });
      await page.locator('.landing-stories-rail').evaluate(el => { el.scrollLeft = el.scrollWidth; });
      assert.ok(await page.locator('.landing-stories-rail').evaluate(el => el.scrollLeft > 0));
      for (const [index, src] of [[0, '01'], [1, '02'], [2, '03'], [9, '10']]) {
        const card = page.locator('.landing-stories-card').nth(index); await card.click();
        const modal = page.getByRole('dialog', { name: '회원이 보내주신 후기' }); await modal.waitFor();
        await page.waitForFunction(() => { const img = document.querySelector('.landing-stories-dialog img'); return img?.complete && img.naturalWidth > 0; });
        assert.equal(await modal.getByRole('img').getAttribute('src'), `/landing/reviews/review-${src}.webp`);
        assert.ok((await modal.boundingBox()).width <= width);
        assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
        await page.keyboard.press('Escape'); await modal.waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => document.body.style.overflow), '');
        assert.ok(await card.evaluate(el => el === document.activeElement));
      }
      await cta.click(); await page.waitForURL(origin + '/signup');
      await page.getByRole('button', { name: 'Google로 계속하기' }).waitFor();
      assert.equal(await page.getByRole('checkbox').isChecked(), false, 'Marketing consent unchanged');
      assert.deepEqual(f.errors, []); passed++; await f.context.close();
    }
    for (const mode of ['image-error', 'no-dialog', 'keyboard', 'normal-motion']) {
      const f = await fixture({ reducedMotion: mode === 'normal-motion' ? 'no-preference' : 'reduce' }), { page } = f;
      if (mode === 'image-error') await page.route('**/landing/reviews/*.webp', route => route.fulfill({ status: 404, body: '' }));
      if (mode === 'no-dialog') await page.addInitScript(() => {
        HTMLDialogElement.prototype.showModal = undefined; window.fixtureOpened = [];
        window.open = (...args) => { window.fixtureOpened.push(args); return null; };
      });
      await page.goto(origin + '/landing'); const card = page.locator('.landing-stories-card').first();
      if (mode === 'normal-motion') {
        await page.waitForFunction(() => { const stage = document.querySelector('.stage'); return stage && getComputedStyle(stage).visibility === 'hidden'; });
        const track = page.locator('.landing-stories-track');
        assert.equal(await track.evaluate(el => getComputedStyle(el).animationName), 'landing-stories-drift');
        const before = await track.evaluate(el => getComputedStyle(el).transform);
        await page.waitForTimeout(250);
        assert.notEqual(await track.evaluate(el => getComputedStyle(el).transform), before, 'Actual photo rail moves');
        await page.getByRole('button', { name: '후기 자동 이동 일시정지' }).click();
        assert.equal(await track.evaluate(el => getComputedStyle(el).animationName), 'none');
        await page.locator('.landing-stories-rail').evaluate(el => { el.scrollLeft = 300; });
        assert.ok(await page.locator('.landing-stories-rail').evaluate(el => el.scrollLeft > 0));
        await page.getByRole('button', { name: '후기 자동 이동 재생' }).click();
        assert.equal(await page.locator('.landing-stories-rail').evaluate(el => el.scrollLeft), 0);
        await page.getByRole('button', { name: '후기 자동 이동 일시정지' }).click();
      }
      if (mode === 'keyboard') { await card.focus(); await page.keyboard.press('Enter'); } else await card.click();
      if (mode === 'no-dialog') assert.deepEqual(await page.evaluate(() => window.fixtureOpened), [['/landing/reviews/review-01.webp', '_blank', 'noopener,noreferrer']]);
      else {
        const modal = page.getByRole('dialog'); await modal.waitFor();
        if (mode === 'image-error') await modal.getByRole('status').waitFor();
        await modal.getByRole('button', { name: '닫기' }).click(); await modal.waitFor({ state: 'hidden' });
        if (mode === 'image-error') {
          await page.unroute('**/landing/reviews/*.webp');
          await card.click(); await modal.waitFor();
          await page.waitForFunction(() => { const img = document.querySelector('.landing-stories-dialog img'); return img?.complete && img.naturalWidth > 0; });
          assert.equal(await modal.getByRole('status').count(), 0, 'Reopening retries a transient image failure');
          await modal.getByRole('button', { name: '닫기' }).click(); await modal.waitFor({ state: 'hidden' });
        }
      }
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert.deepEqual(f.errors, []); passed++; await f.context.close();
    }
    console.log(JSON.stringify({ passed, screenshots: output, productionRequests: 0, realSignups: 0 }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
