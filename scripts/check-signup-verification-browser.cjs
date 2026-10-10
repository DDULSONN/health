/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), path = require('node:path');
const { chromium } = require('./test-browser-runtime.cjs');
const { startPreview } = require('./preview-signup-verification.cjs');
const EMAIL = 'signup-test@example.invalid', KEY = 'gymtools:pending-email-signup:v1';
const confirmed = { id: 'fake-member', email: EMAIL, email_confirmed_at: '2026-10-01', identities: [{}] };
const sleepGate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
(async () => {
  const { origin, server, output } = await startPreview(); let browser, passed = 0;
  try {
    browser = await chromium.launch({ headless: true });
    async function fixture({ width = 390, pending = false, storage = '', state = {} } = {}) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = [], calls = [], config = { user: null, ...state };
      page.on('pageerror', e => errors.push(e.message));
      await page.clock.install();
      await context.addInitScript(({ pending, storage, email, key }) => {
        if (pending && !sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({
          email, referralCode: 'ABCDEFGH', createdAt: Date.now() - 70000, resendAvailableAt: Date.now() - 1,
        }));
        if (storage === 'blocked') for (const kind of ['localStorage', 'sessionStorage']) Object.defineProperty(window, kind, { configurable: true, get() { throw Error('storage denied'); } });
        if (storage === 'quota') Storage.prototype.setItem = () => { throw Error('quota exceeded'); };
      }, { pending, storage, email: EMAIL, key: KEY });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        assert.equal(url.origin, origin, 'No external auth, mail, SMS or production requests');
        if (url.pathname.startsWith('/__fixture/auth/')) {
          const action = url.pathname.split('/').at(-1), body = req.postData() ? req.postDataJSON() : null;
          calls.push({ action, body });
          if (config[action + 'Gate']) await config[action + 'Gate'].promise;
          if (config[action + 'Abort']) return route.abort();
          if (action === 'user') return route.fulfill({ json: { data: { user: config.user }, error: config.userError ?? null } });
          if (action === 'signup') return route.fulfill({ json: config.signupResult ?? { data: { user: { ...confirmed, email_confirmed_at: null }, session: null }, error: null } });
          if (action === 'resend') return route.fulfill({ json: { error: config.resendError ?? null } });
          if (action === 'oauth') return route.fulfill({ json: { error: config.oauthError ?? null } });
          throw Error('Unexpected mock auth action: ' + action);
        }
        if (url.pathname.startsWith('/api/')) {
          calls.push({ action: url.pathname, body: req.postData() ? req.postDataJSON() : null });
          if (url.pathname === '/api/referrals/validate') {
            if (config.referralGate) await config.referralGate.promise;
            return route.fulfill({ json: { valid: config.referralValid !== false } });
          }
          if (url.pathname === '/api/signup/email-marketing') {
            if (config.consentAbort || (config.consentRecordAbort && req.postDataJSON().action === 'record')) return route.abort();
            return route.fulfill({ json: { token: 'fixture-consent-' + req.postDataJSON().consented } });
          }
          if (url.pathname === '/api/referrals/claim') return route.fulfill({ status: 503, json: { error: 'fixture unavailable' } });
          throw Error('Unexpected API request: ' + url.pathname);
        }
        assert.equal(req.method(), 'GET'); return route.continue();
      });
      await page.goto(origin + '/signup');
      return { context, page, config, calls, errors, count: action => calls.filter(c => c.action === action).length };
    }
    async function run(name, options, test) {
      const f = await fixture(options);
      try { await test(f); assert.deepEqual(f.errors, []); passed++; console.log('PASS ' + name); }
      catch (error) { console.error('FAIL ' + name, { actions: f.calls.map(c => c.action), screen: await f.page.locator('body').innerText() }); throw error; }
      finally { Object.values(f.config).forEach(v => v?.release?.()); await f.context.close(); }
    }
    async function fill(page) {
      await page.getByRole('button', { name: '이메일로 가입하기', exact: true }).click();
      for (const [id, value] of [['email', EMAIL], ['nickname', '가입테스트'], ['password', 'test-password-123'], ['password-confirm', 'test-password-123']]) await page.locator('#signup-' + id).fill(value);
    }
    const submit = page => page.getByRole('button', { name: '이메일로 회원가입', exact: true }).click();
    const ready = page => page.getByRole('button', { name: '인증했어요 · 계속하기', exact: true }).waitFor();
    for (const [width, storage] of [[320, 'blocked'], [390, 'quota'], [1280, '']]) {
      await run(`signup remains successful with ${storage || 'normal'} storage at ${width}px`, { width, storage }, async f => {
        await fill(f.page); assert.equal(await f.page.getByRole('checkbox').isChecked(), false);
        await submit(f.page); await ready(f.page);
        assert.equal(f.count('signup'), 1); assert.equal(f.count('resend'), 0);
        await f.page.getByText(EMAIL, { exact: true }).waitFor();
        assert.ok(await f.page.getByRole('button', { name: /초 후 다시 보내기/ }).isDisabled());
        assert.equal(await f.page.getByRole('alert').count(), 0);
        assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.equal(await f.page.evaluate(() => window.fixtureRedirect), undefined);
        const payload = f.calls.find(c => c.action === 'signup').body;
        assert.equal(payload.options.data.nickname, '가입테스트');
        assert.equal(payload.options.data.signup_email_consent_token, 'fixture-consent-false');
        assert.equal(new URL(payload.options.emailRedirectTo).searchParams.get('next'), '/onboarding/dating');
        await f.page.screenshot({ path: path.join(output, `signup-waiting-${width}.png`), fullPage: true });
      });
    }
    await run('double submit and competing OAuth while referral validation is pending', {}, async f => {
      await fill(f.page); await f.page.getByRole('button', { name: '추천 코드가 있나요?' }).click();
      await f.page.locator('#signup-referral-code').fill('ABCDEFGH');
      f.config.referralGate = sleepGate();
      await f.page.evaluate(() => {
        const form = document.querySelector('form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        [...document.querySelectorAll('button')].find(b => b.textContent === 'Google로 계속하기').click();
      });
      await f.page.getByRole('button', { name: '가입 요청 중...' }).waitFor();
      assert.equal(f.count('signup'), 0); assert.equal(f.count('oauth'), 0);
      f.config.referralGate.release(); await ready(f.page);
      assert.equal(f.count('signup'), 1); assert.equal(f.count('oauth'), 0);
      assert.equal(f.calls.find(c => c.action === 'signup').body.options.data.referral_code, 'ABCDEFGH');
    });
    await run('invalid referral unlocks the form for correction', { state: { referralValid: false } }, async f => {
      await fill(f.page); await f.page.getByRole('button', { name: '추천 코드가 있나요?' }).click();
      await f.page.locator('#signup-referral-code').fill('ABCDEFGH'); await submit(f.page);
      await f.page.getByText('추천 코드를 다시 확인하거나 입력란을 비워주세요.', { exact: true }).waitFor();
      assert.equal(f.count('signup'), 0);
      await f.page.locator('#signup-referral-code').fill(''); await submit(f.page); await ready(f.page);
      assert.equal(f.count('signup'), 1);
    });
    await run('waiting screen and resend deadline survive page refresh without repeating signup', {}, async f => {
      await fill(f.page); await submit(f.page); await ready(f.page);
      const before = await f.page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), KEY);
      assert.deepEqual(Object.keys(before).sort(), ['createdAt', 'email', 'referralCode', 'resendAvailableAt']);
      await f.page.reload(); await ready(f.page);
      assert.deepEqual(await f.page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), KEY), before);
      assert.equal(f.count('signup'), 1); assert.equal(f.count('resend'), 0);
      await f.page.clock.fastForward(61000);
      await f.page.getByRole('button', { name: '인증 메일 다시 보내기', exact: true }).click();
      await f.page.getByText('인증 메일을 다시 보냈어요. 스팸 메일함도 확인해 주세요.').waitFor();
      assert.equal(f.count('resend'), 1);
      await f.page.reload(); await ready(f.page);
      assert.ok(await f.page.getByRole('button', { name: /초 후 다시 보내기/ }).isDisabled());
    });
    await run('rapid resend uses one request and preserves referral/callback', { pending: true }, async f => {
      await ready(f.page); f.config.resendGate = sleepGate();
      await f.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === '인증 메일 다시 보내기'); b.click(); b.click(); });
      await f.page.getByRole('button', { name: '재발송 중...' }).waitFor();
      f.config.resendGate.release(); await f.page.getByText(/인증 메일을 다시 보냈어요/).waitFor();
      assert.equal(f.count('resend'), 1);
      const body = f.calls.find(c => c.action === 'resend').body;
      assert.equal(body.type, 'signup'); assert.equal(body.email, EMAIL);
      assert.equal(new URL(body.options.emailRedirectTo).searchParams.get('ref'), 'ABCDEFGH');
    });
    await run('server rate limit is readable and starts retry cooldown', { pending: true, state: { resendError: { status: 429, message: 'rate limit' } } }, async f => {
      await ready(f.page); await f.page.getByRole('button', { name: '인증 메일 다시 보내기' }).click();
      await f.page.getByRole('alert').filter({ hasText: '메일 요청이 너무 잦아요' }).waitFor();
      assert.ok(await f.page.getByRole('button', { name: /초 후 다시 보내기/ }).isDisabled());
    });
    await run('resend network failure can retry without losing waiting screen', { pending: true, state: { resendAbort: true } }, async f => {
      await ready(f.page); await f.page.getByRole('button', { name: '인증 메일 다시 보내기' }).click();
      await f.page.getByRole('alert').waitFor(); f.config.resendAbort = false;
      await f.page.getByRole('button', { name: '인증 메일 다시 보내기' }).click();
      await f.page.getByText(/인증 메일을 다시 보냈어요/).waitFor();
      assert.equal(await f.page.getByRole('alert').count(), 0); assert.equal(f.count('signup'), 0);
    });
    for (const event of ['focus', 'auth']) await run(`verified same account continues on ${event} without bypassing phone gate`, { pending: true }, async f => {
      await ready(f.page); f.config.user = confirmed;
      await f.page.evaluate(event => event === 'focus' ? window.dispatchEvent(new Event('focus')) : window.fixtureAuthEvent('SIGNED_IN'), event);
      await f.page.waitForFunction(() => window.fixtureRedirect?.startsWith('/phone-verification?'));
      assert.equal(new URL(await f.page.evaluate(() => window.fixtureRedirect), origin).searchParams.get('next'), '/onboarding/dating');
      assert.equal(await f.page.evaluate(key => sessionStorage.getItem(key), KEY), null);
      assert.equal(f.count('signup'), 0); assert.equal(f.count('resend'), 0);
    });
    for (const user of [{ ...confirmed, email: 'other@example.invalid' }, { ...confirmed, email_confirmed_at: null }]) {
      await run('unverified or different account never automatically proceeds', { pending: true, state: { user } }, async f => {
        await ready(f.page); await f.page.getByRole('button', { name: '인증했어요 · 계속하기' }).click();
        await f.page.getByRole('status').waitFor();
        assert.equal(await f.page.evaluate(() => window.fixtureRedirect), undefined);
        assert.equal(f.count('signup'), 0);
      });
    }
    await run('verification in another browser routes to existing password login with the right email', { pending: true }, async f => {
      await ready(f.page); await f.page.getByRole('button', { name: '인증했어요 · 계속하기' }).click();
      await f.page.waitForFunction(() => window.fixtureRedirect?.startsWith('/login?'));
      const url = new URL(await f.page.evaluate(() => window.fixtureRedirect), origin);
      assert.equal(url.searchParams.get('email'), null); assert.equal(url.searchParams.get('next'), '/onboarding/dating');
      assert.equal(await f.page.evaluate(() => localStorage.getItem('recent_login_email')), EMAIL);
    });
    await run('status outage does not log out, redirect or mislabel the email as unverified', { pending: true, state: { userError: { name: 'AuthApiError', status: 503 } } }, async f => {
      await ready(f.page); await f.page.getByRole('button', { name: '인증했어요 · 계속하기' }).click();
      await f.page.getByRole('alert').filter({ hasText: '인증 상태를 확인하지 못했어요' }).waitFor();
      assert.equal(await f.page.evaluate(() => window.fixtureRedirect), undefined);
      f.config.userError = null; f.config.user = confirmed;
      await f.page.getByRole('button', { name: '인증했어요 · 계속하기' }).click();
      await f.page.waitForFunction(() => window.fixtureRedirect?.startsWith('/phone-verification?'));
    });
    await run('slow status check times out and a late response cannot navigate', { pending: true }, async f => {
      await ready(f.page); f.config.userGate = sleepGate();
      const checking = f.page.waitForRequest(r => r.url().endsWith('/__fixture/auth/user'));
      await f.page.getByRole('button', { name: '인증했어요 · 계속하기' }).click(); await checking;
      await f.page.clock.fastForward(11000);
      await f.page.getByRole('alert').filter({ hasText: '인증 상태를 확인하지 못했어요' }).waitFor();
      const response = f.page.waitForResponse(r => r.url().endsWith('/__fixture/auth/user'));
      f.config.user = confirmed; f.config.userGate.release(); await response;
      assert.equal(await f.page.evaluate(() => window.fixtureRedirect), undefined);
      await f.page.getByRole('button', { name: '인증했어요 · 계속하기' }).click();
      await f.page.waitForFunction(() => window.fixtureRedirect?.startsWith('/phone-verification?'));
    });
    await run('signout invalidates an in-flight verification result', { pending: true }, async f => {
      await ready(f.page); f.config.userGate = sleepGate(); f.config.user = confirmed;
      const checking = f.page.waitForRequest(r => r.url().endsWith('/__fixture/auth/user'));
      await f.page.getByRole('button', { name: '인증했어요 · 계속하기' }).click(); await checking;
      await f.page.evaluate(() => window.fixtureAuthEvent('SIGNED_OUT'));
      const response = f.page.waitForResponse(r => r.url().endsWith('/__fixture/auth/user'));
      f.config.userGate.release(); await response; await ready(f.page);
      assert.equal(await f.page.evaluate(() => window.fixtureRedirect), undefined);
    });
    await run('wrong email can return to the form without mutating the prior account', { pending: true }, async f => {
      await ready(f.page); await f.page.getByRole('button', { name: /이메일 다시 입력/ }).click();
      await f.page.getByLabel('이메일', { exact: true }).waitFor();
      assert.equal(await f.page.evaluate(key => sessionStorage.getItem(key), KEY), null);
      assert.equal(await f.page.getByRole('region', { name: '이메일 인증 대기' }).count(), 0);
      assert.equal(f.count('signup'), 0); assert.equal(f.count('resend'), 0);
    });
    await run('account switch rejects a late result from the earlier verified account', { pending: true }, async f => {
      await ready(f.page); f.config.userGate = sleepGate(); f.config.user = confirmed;
      const checking = f.page.waitForRequest(r => r.url().endsWith('/__fixture/auth/user'));
      await f.page.getByRole('button', { name: '인증했어요 · 계속하기' }).click(); await checking;
      await f.page.evaluate(() => window.fixtureAuthEvent('SIGNED_IN', { user: { email: 'other@example.invalid' } }));
      const response = f.page.waitForResponse(r => r.url().endsWith('/__fixture/auth/user'));
      f.config.userGate.release(); await response; await ready(f.page);
      assert.equal(await f.page.evaluate(() => window.fixtureRedirect), undefined);
    });
    await run('signup server failure releases lock and preserves input for retry', { state: { signupResult: { data: { user: null }, error: { message: 'Fixture signup failure' } } } }, async f => {
      await fill(f.page); await submit(f.page); await f.page.getByRole('alert').waitFor();
      assert.equal(await f.page.getByLabel('이메일', { exact: true }).inputValue(), EMAIL);
      f.config.signupResult = null; await submit(f.page); await ready(f.page); assert.equal(f.count('signup'), 2);
    });
    for (const result of [
      { data: { user: null }, error: { message: 'User already registered' } },
      { data: { user: { identities: [] } }, error: null },
    ]) await run('existing account remains recoverable even when storage is denied', { storage: 'blocked', state: { signupResult: result } }, async f => {
      await fill(f.page); await submit(f.page);
      await f.page.getByRole('button', { name: '로그인하러 가기' }).waitFor();
      assert.equal(await f.page.getByRole('button', { name: '비밀번호 찾기' }).count(), 1);
      assert.equal(await f.page.getByRole('region', { name: '이메일 인증 대기' }).count(), 0);
    });
    for (const provider of ['Google', 'Apple']) await run(`${provider} signup survives unavailable storage/consent and locks duplicate clicks`, { storage: 'blocked', state: { consentAbort: true } }, async f => {
      f.config.oauthGate = sleepGate();
      const request = f.page.waitForRequest(r => r.url().endsWith('/__fixture/auth/oauth'));
      await f.page.evaluate(provider => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === provider + '로 계속하기'); b.click(); b.click(); }, provider);
      await request;
      const response = f.page.waitForResponse(r => r.url().endsWith('/__fixture/auth/oauth'));
      f.config.oauthGate.release();
      await response;
      assert.equal(f.count('oauth'), 1); assert.equal(f.count('signup'), 0);
    });
    await run('OAuth error releases the signup lock for retry', { state: { oauthError: { message: 'provider not enabled' } } }, async f => {
      await f.page.getByRole('button', { name: 'Google로 계속하기' }).click(); await f.page.getByRole('alert').waitFor();
      assert.ok(await f.page.getByRole('button', { name: 'Google로 계속하기' }).isEnabled());
      await f.page.getByRole('button', { name: 'Apple로 계속하기' }).click();
      await f.page.getByRole('alert').filter({ hasText: 'Apple' }).waitFor(); assert.equal(f.count('oauth'), 2);
    });
    await run('consent recording failure does not invalidate a successful session signup', { state: { consentRecordAbort: true, user: confirmed, signupResult: { data: { user: confirmed, session: { user: confirmed } }, error: null } } }, async f => {
      await fill(f.page); await f.page.getByRole('checkbox').check(); await submit(f.page);
      await f.page.waitForFunction(() => window.fixtureRedirect?.startsWith('/phone-verification?'));
      assert.equal(f.count('signup'), 1);
      assert.equal(f.calls.find(c => c.action === 'signup').body.options.data.signup_email_consent_token, 'fixture-consent-true');
    });
    console.log(JSON.stringify({ passed, productionRequests: 0, screenshots: output }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
