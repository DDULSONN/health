/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), path = require('node:path');
const { startPreview } = require('./preview-profile-writing.cjs');
const { chromium } = require('./test-browser-runtime.cjs');
(async () => {
  const { server, origin, output } = await startPreview(); let browser, passed = 0;
  try {
    browser = await chromium.launch({ headless: true });
    async function fixture(options = {}) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...options });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      const errors = [], imageRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url()); assert.equal(url.origin, origin, 'external traffic prohibited');
        assert.equal(req.method(), 'GET', 'no signup, OTP or other writes');
        if (url.pathname.startsWith('/landing/reviews/')) imageRequests.push(url.pathname);
        return route.continue();
      });
      return { context, page, errors, imageRequests };
    }
    for (const width of [320, 390, 1280]) {
      const f = await fixture({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 }), { page } = f;
      await page.goto(origin + '/signup');
      const stories = page.getByRole('region', { name: '짐툴에서 만난 이야기', exact: true });
      await stories.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => { const img = document.querySelector('.signup-stories-card img'); return img?.complete && img.naturalWidth > 0; });
      assert.equal(await page.locator('.signup-stories-rail').evaluate(el => el.getBoundingClientRect().height), 112);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.getByRole('button', { name: /만남 후기 \d 크게 보기/ }).count(), 3, 'duplicate group hidden from assistive tech');
      const signupTop = await page.getByRole('button', { name: 'Google로 계속하기' }).boundingBox();
      const storiesTop = await stories.boundingBox(); assert.ok(storiesTop.y > signupTop.y);
      assert.equal(await page.getByRole('checkbox').isChecked(), false);
      // Move pointer away so desktop hover does not pause animation under the fixture viewport.
      await page.mouse.move(0, 0);
      const before = await page.locator('.signup-stories-track').evaluate(el => getComputedStyle(el).transform);
      await page.waitForTimeout(250);
      assert.notEqual(await page.locator('.signup-stories-track').evaluate(el => getComputedStyle(el).transform), before);
      await page.getByRole('button', { name: '후기 자동 이동 일시정지', exact: true }).click();
      assert.equal(await page.locator('.signup-stories-track').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
      await page.getByRole('button', { name: '이메일로 가입하기' }).click();
      await page.getByLabel('닉네임', { exact: true }).fill('후기확인');
      await page.getByLabel('이메일', { exact: true }).fill('fixture@example.invalid');
      const first = page.getByRole('button', { name: '만남 후기 1 크게 보기', exact: true });
      await first.click();
      const dialog = page.getByRole('dialog', { name: '짐툴에서 만난 이야기' }); await dialog.waitFor();
      assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
      assert.ok(await dialog.getByRole('img').evaluate(img => img.complete && img.naturalWidth > 0));
      assert.ok((await dialog.boundingBox()).width <= width);
      await page.screenshot({ path: path.join(output, `signup-story-expanded-${width}.png`), fullPage: true });
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert.equal(await page.getByLabel('닉네임', { exact: true }).inputValue(), '후기확인');
      assert.equal(await page.getByLabel('이메일', { exact: true }).inputValue(), 'fixture@example.invalid');
      await first.click(); await dialog.getByRole('button', { name: '닫기', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: '이메일 가입 접기' }).click();
      await page.locator('.signup-stories-rail').evaluate(el => { el.scrollLeft = 250; });
      await page.getByRole('button', { name: '후기 자동 이동 재생', exact: true }).click();
      assert.equal(await page.locator('.signup-stories-rail').evaluate(el => el.scrollLeft), 0, 'resume must clear manual scroll before automatic translation');
      await page.mouse.move(0, 0);
      assert.equal(await page.locator('.signup-stories-track').evaluate(el => getComputedStyle(el).animationPlayState), 'running');
      await page.screenshot({ path: path.join(output, `signup-stories-${width}.png`), fullPage: true });
      assert.ok(new Set(f.imageRequests).size <= 3, 'no extra full-size downloads');
      assert.ok(f.imageRequests.every(url => /review-(02|06|08)\.webp$/.test(url)));
      assert.deepEqual(f.errors, []); passed++; await f.context.close();
    }
    const reduced = await fixture({ reducedMotion: 'reduce', isMobile: true, hasTouch: true }), { page } = reduced;
    await page.goto(origin + '/signup'); await page.locator('.signup-stories').scrollIntoViewIfNeeded();
    await page.locator('.signup-stories-track').waitFor();
    assert.equal(await page.locator('.signup-stories-track').evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.equal(await page.getByRole('button', { name: '후기 직접 넘겨보기' }).isDisabled(), true);
    const rail = page.locator('.signup-stories-rail'); await rail.evaluate(el => { el.scrollLeft = 200; });
    assert.ok(await rail.evaluate(el => el.scrollLeft > 0));
    assert.deepEqual(reduced.errors, []); passed++; await reduced.context.close();
    for (const mode of ['lazy', 'missing', 'no-observer', 'no-dialog', 'dialog-image-error']) {
      const f = await fixture(), { page } = f;
      if (mode === 'lazy') await page.addInitScript(() => {
        window.fixtureObservers = [];
        window.IntersectionObserver = class { constructor(callback) { window.fixtureObservers.push(callback); } observe() {} disconnect() {} };
      });
      if (mode === 'no-observer') await page.addInitScript(() => { delete window.IntersectionObserver; });
      if (mode === 'no-dialog') await page.addInitScript(() => {
        HTMLDialogElement.prototype.showModal = undefined;
        window.fixtureOpened = [];
        window.open = (...args) => { window.fixtureOpened.push(args); return null; };
      });
      if (mode === 'missing') await page.route('**/landing/reviews/*.webp', route => route.fulfill({ status: 404, body: '' }));
      await page.goto(origin + '/signup');
      await page.getByRole('button', { name: 'Google로 계속하기' }).waitFor();
      if (mode === 'lazy') {
        await page.waitForLoadState('networkidle'); assert.equal(f.imageRequests.length, 0);
        await page.evaluate(() => window.fixtureObservers.forEach(fn => fn([{ isIntersecting: true }])));
        await page.locator('.signup-stories-track').waitFor();
      } else if (mode === 'missing') {
        await page.locator('.signup-stories').waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      } else {
        await page.locator('.signup-stories-track').waitFor();
        if (mode === 'no-dialog' || mode === 'dialog-image-error') {
          await page.getByRole('button', { name: '후기 자동 이동 일시정지', exact: true }).click();
          await page.getByRole('button', { name: '만남 후기 1 크게 보기', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: '짐툴에서 만난 이야기' });
          if (mode === 'no-dialog') {
            assert.deepEqual(await page.evaluate(() => window.fixtureOpened), [['/landing/reviews/review-06.webp', '_blank', 'noopener,noreferrer']]);
            assert.equal(await dialog.isVisible(), false);
          } else {
            await dialog.waitFor();
            // Simulate the selected image failing while the other images also become unavailable.
            await page.locator('.signup-stories-card img').evaluateAll(images => images.forEach(img => img.dispatchEvent(new Event('error'))));
            await dialog.getByText('후기를 불러오지 못했어요. 닫은 뒤 다시 확인해 주세요.').waitFor();
            await dialog.getByRole('button', { name: '닫기', exact: true }).click();
            await page.locator('.signup-stories').waitFor({ state: 'hidden' });
          }
          assert.equal(await page.evaluate(() => document.body.style.overflow), '');
        }
      }
      await page.getByRole('button', { name: '이메일로 가입하기' }).click();
      await page.getByLabel('이메일', { exact: true }).fill('fixture@example.invalid');
      assert.deepEqual(f.errors, []); passed++; await f.context.close();
    }
    console.log(JSON.stringify({ passed, productionRequests: 0, screenshots: output, browser: process.env.TEST_BROWSER || 'chromium' }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
