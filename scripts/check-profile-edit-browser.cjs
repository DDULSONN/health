/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { startPreview } = require('./preview-profile-writing.cjs');
const { chromium } = require('./test-browser-runtime.cjs');
const card = { id: 'fixture-card', sex: 'female', name: '검증회원', birth_year: 1995, height_cm: 165,
  job: '회사원', region: '경기 수원', intro_text: '함께 운동하는 일상', strengths_text: '차분한 성격',
  preferred_partner_text: '대화가 잘 통하는 분', smoking: 'non_smoker', workout_frequency: '3_4',
  status: 'submitted', admin_tags: [], photo_signed_urls: [] };
(async () => {
  const { server, origin } = await startPreview(0, 'profile-edit-browser.tsx');
  let browser, passed = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [360, 1280]) for (const scenario of ['success', 'loading', 'auth-error', 'guest', 'my-error', 'status-error', 'missing', 'locked', 'used']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(), errors = [], mutations = [];
      let failReads = true;
      const heldReads = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.addInitScript(s => { if (s === 'auth-error') window.fixtureAuthMode = 'server-error'; if (s === 'guest') window.fixtureAuthMode = 'guest'; }, scenario);
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        assert.equal(url.origin, origin, 'live network prohibited');
        if (req.method() !== 'GET') { mutations.push(url.pathname); await route.abort(); return; }
        if (url.pathname === '/api/dating/1on1/write-status') {
          if (scenario === 'loading' && failReads) await new Promise(resolve => heldReads.push(resolve));
          await route.fulfill({ status: scenario === 'status-error' && failReads ? 503 : 200,
            json: { loggedIn: true, isAdmin: false, phoneVerified: true, canWrite: false, activeRequestStatus: 'submitted', writeStatus: 'approved', totalApplications: 1 } }); return;
        }
        if (url.pathname === '/api/dating/1on1/my') {
          const tags = scenario === 'locked' ? ['one_on_one_edit_locked'] : scenario === 'used' ? ['one_on_one_user_edit_used'] : [];
          await route.fulfill({ status: scenario === 'my-error' && failReads ? 503 : 200,
            json: { items: scenario === 'missing' ? [] : [{ ...card, admin_tags: tags }] } }); return;
        }
        await route.continue();
      });
      await page.goto(origin + '/dating/1on1?editId=fixture-card');
      if (scenario === 'loading') {
        await page.getByRole('status').waitFor();
        assert.equal(await page.locator('a[href^="/login?"]').count(), 0, 'checking must not flash a login prompt');
        assert.equal(await page.locator('a[href="/signup"]').count(), 0);
        failReads = false;
        for (const release of heldReads) release();
      }
      if (scenario === 'guest') {
        const href = await page.locator('a[href^="/login?"]').first().getAttribute('href');
        assert.equal(new URL(href, origin).searchParams.get('redirect'), '/dating/1on1?editId=fixture-card');
        assert.equal(await page.locator('form').count(), 0);
      } else if (['missing', 'locked', 'used'].includes(scenario)) {
        await page.getByRole('alert').waitFor();
        assert.equal(await page.locator('form').count(), 0, 'failed edit must never show a blank writable form');
      } else {
        if (!['success', 'loading'].includes(scenario)) {
          await page.getByRole('button', { name: '다시 확인', exact: true }).waitFor();
          assert.equal(await page.locator('form').count(), 0);
          assert.equal(await page.locator('a[href^="/login?"]').count(), 0, 'outage is not logout');
          failReads = false;
          await page.evaluate(() => { window.fixtureAuthMode = undefined; });
          await page.getByRole('button', { name: '다시 확인', exact: true }).click();
        }
        await page.getByRole('heading', { name: '1:1 신청 수정', exact: true }).waitFor();
        // Step 1 -> saved identity/age/region, without touching any data.
        assert.equal(await page.locator('#one-on-one-name').inputValue(), card.name);
        await page.getByRole('button', { name: '다음', exact: true }).click();
        assert.equal(await page.locator('#one-on-one-birth-year').inputValue(), String(card.birth_year));
        assert.equal(await page.locator('#one-on-one-region').inputValue(), card.region);
      }
      assert.equal(await page.evaluate(() => window.fixtureRedirect), undefined);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []); assert.deepEqual(mutations, []);
      passed++; await context.close();
    }
    console.log(`Profile edit browser: ${passed} passed; no live requests or writes.`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
