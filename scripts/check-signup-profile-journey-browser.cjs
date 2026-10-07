/* eslint-disable @typescript-eslint/no-require-imports */
// Actual React pages with isolated auth/API fixtures: never sends real OTPs or creates members.
const assert = require('node:assert/strict'), path = require('node:path');
const { chromium } = require('./test-browser-runtime.cjs');
const { startPreview } = require('./preview-profile-writing.cjs');
(async () => {
  const { server, origin, output } = await startPreview();
  let browser, passed = 0;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const phonePath = '/phone-verification?next=' + encodeURIComponent('/onboarding/dating?target=one_on_one');
    async function fixture(width = 390, mode) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      const errors = [], posts = [];
      page.on('pageerror', e => { errors.push(e.message); console.error('Fixture page error:', e.message); });
      if (mode) await context.addInitScript(value => { window.fixtureAuthMode = value; }, mode);
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        assert.equal(url.origin, origin, 'No external traffic allowed');
        if (req.method() !== 'GET' && url.pathname !== '/api/analytics/onboarding') posts.push({ path: url.pathname, body: req.postDataJSON() });
        await route.continue();
      });
      return { context, page, errors, posts };
    }
    for (const width of [320, 390, 1280]) {
      const f = await fixture(width), { page } = f;
      for (const [url, heading, step] of [['/signup', '회원가입', '회원가입'], [phonePath, '휴대폰 인증', '휴대폰 인증'], ['/onboarding/dating', '소개 프로필 작성', '프로필 작성']]) {
        await page.goto(origin + url);
        await page.getByRole('heading', { name: heading, exact: true }).waitFor();
        assert.equal(await page.locator('[aria-current="step"]').innerText(), (step === '회원가입' ? '' : '›') + step);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
        if (url === '/signup') {
          assert.equal(await page.getByRole('checkbox').isChecked(), false, 'marketing remains optional and unchecked');
          assert.equal(await page.locator('input[type=password]').count(), 0, 'email form stays compact');
        } else if (url === phonePath) {
          assert.equal(await page.locator('body').innerText().then(text => text.includes('마지막 단계')), false);
          assert.equal(await page.getByRole('button', { name: '인증번호 받기', exact: true }).count(), 1);
        } else {
          assert.equal(await page.getByRole('button', { name: /^오픈카드\s*내/ }).getAttribute('aria-pressed'), 'true');
          assert.equal(await page.getByRole('button', { name: /^1:1 매칭\s*추천/ }).getAttribute('aria-pressed'), 'true');
          assert.equal(await page.getByRole('button', { name: '소개 작성하기', exact: true }).count(), 1);
          assert.equal(await page.getByRole('button', { name: '기본 정보', exact: true }).innerText(), '기본');
          assert.equal(await page.getByRole('button', { name: '생활 정보', exact: true }).innerText(), '생활');
          await page.getByText('프로필은 어디에 보이나요?', { exact: true }).click();
          await page.getByText(/다른 회원의 추천 후보나 매칭 요청에/).waitFor();
          await page.getByText('프로필은 어디에 보이나요?', { exact: true }).click();
        }
        await page.screenshot({ path: path.join(output, `${heading}-${width}.png`), fullPage: true }); passed++;
      }
      assert.deepEqual(f.posts, []); assert.deepEqual(f.errors, []); await f.context.close();
    }
    for (const surface of ['phone', 'profile']) for (const mode of ['offline', 'server-error', 'guest']) {
      const f = await fixture(390, mode), { page } = f;
      await page.goto(origin + (surface === 'phone' ? phonePath : '/onboarding/dating?target=one_on_one'));
      if (mode === 'guest') {
        await page.waitForFunction(() => window.fixtureRedirect?.startsWith('/login?'));
        const loginNext = new URL(await page.evaluate(() => window.fixtureRedirect), origin).searchParams.get('redirect');
        assert.equal(surface === 'phone' ? new URL(loginNext, origin).searchParams.get('next') : loginNext, '/onboarding/dating?target=one_on_one');
      } else {
        const retry = page.getByRole('button', { name: surface === 'phone' ? '다시 확인' : '다시 시도', exact: true });
        await retry.waitFor(); assert.equal(await page.evaluate(() => window.fixtureRedirect), undefined);
        assert.equal(await page.locator('[data-onboarding-next]').count(), 0);
        if (surface === 'phone') assert.equal(await page.getByRole('button', { name: '인증번호 받기' }).count(), 0);
        await page.evaluate(() => { window.fixtureAuthMode = undefined; });
        await retry.click();
        await page.getByRole('button', { name: surface === 'phone' ? '인증번호 받기' : '소개 작성하기', exact: true }).waitFor();
        assert.equal(await page.getByRole('alert').count(), 0);
      }
      assert.deepEqual(f.posts, []); assert.deepEqual(f.errors, []); passed++; await f.context.close();
    }
    for (const status of [401, 503]) {
      const f = await fixture(), { page } = f; let failed = true;
      await page.route('**/api/mypage/summary?*', async route => failed ? route.fulfill({ status, json: { error: 'fixture failure' } }) : route.continue());
      await page.goto(origin + phonePath); await page.getByRole('button', { name: '다시 확인' }).waitFor();
      assert.equal(await page.evaluate(() => window.fixtureRedirect), undefined);
      failed = false; await page.getByRole('button', { name: '다시 확인' }).click();
      await page.getByRole('button', { name: '인증번호 받기' }).waitFor();
      assert.deepEqual(f.posts, []); assert.deepEqual(f.errors, []); passed++; await f.context.close();
    }
    for (const outcome of ['success', 'duplicate', 'wrong-code', 'already-verified']) {
      const f = await fixture(320), { page } = f; const requests = [];
      if (outcome === 'already-verified') await page.route('**/api/mypage/summary?*', route => route.fulfill({ json: { profile: { phone_verified: true } } }));
      await page.route('**/api/mypage/phone-verification/*', async route => {
        const req = route.request(); requests.push({ path: new URL(req.url()).pathname, body: req.postDataJSON() });
        if (req.url().endsWith('/send')) return route.fulfill({ status: outcome === 'duplicate' ? 409 : 200, json: outcome === 'duplicate'
          ? { code: 'PHONE_ALREADY_USED', error: '이미 다른 계정에 등록된 번호입니다.' }
          : { pendingPhone: '+821000000000', resendAfterSec: 60 } });
        return route.fulfill({ status: outcome === 'wrong-code' ? 400 : 200, json: outcome === 'wrong-code' ? { error: '인증번호를 확인해 주세요.' } : { phone_verified: true } });
      });
      await page.goto(origin + phonePath);
      if (outcome === 'already-verified') {
        await page.waitForFunction(() => window.fixtureRedirect === '/onboarding/dating?target=one_on_one');
        assert.equal(requests.length, 0);
      } else {
        await page.getByRole('textbox', { name: '휴대폰 번호' }).fill('01000000000');
        await page.getByRole('button', { name: '인증번호 받기' }).click();
        assert.deepEqual(requests[0].body, { phone: '+821000000000' });
        if (outcome === 'duplicate') {
          await page.getByRole('button', { name: '기존 계정 로그인' }).waitFor();
          assert.equal(await page.getByRole('button', { name: '계정 찾기' }).count(), 1);
          assert.equal(requests.length, 1);
        } else {
          const code = page.getByRole('textbox', { name: '인증번호', exact: true });
          await code.fill('123456'); assert.equal(await code.getAttribute('autocomplete'), 'one-time-code');
          assert.ok(await page.getByRole('button', { name: /초 후 재발송/ }).isDisabled());
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.getByRole('button', { name: '확인', exact: true }).click();
          if (outcome === 'success') await page.waitForFunction(() => window.fixtureRedirect === '/onboarding/dating?target=one_on_one');
          else { await page.getByRole('alert').waitFor(); assert.equal(await page.evaluate(() => window.fixtureRedirect), undefined); }
          assert.deepEqual(requests[1].body, { phone: '+821000000000', token: '123456' }); assert.equal(requests.length, 2);
        }
      }
      assert.deepEqual(f.errors, []); passed++; await f.context.close();
    }
    console.log(JSON.stringify({ passed, productionRequests: 0, screenshots: output }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
