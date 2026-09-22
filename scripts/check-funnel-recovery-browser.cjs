/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const webpack = require('webpack');
const root = path.resolve(__dirname, '..');
const runtime = process.env.CODEX_NODE_PACKAGES || 'C:/Users/DDULSONN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(path.join(runtime, 'playwright'));
(async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-funnel-recovery-browser-'));
  const adapter = path.join(__dirname, 'fixtures/profile-ux-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'fixtures/funnel-recovery-browser.tsx'),
      output: { path: output, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { 'next/link': adapter, 'next/navigation': adapter, '@/lib/supabase/client': adapter, '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs') }] },
    });
    compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true })));
      else resolve();
    });
  });
  const cssRoot = process.env.PROFILE_UX_CSS_DIR || path.join(root, '.next/static/css');
  const css = fs.readdirSync(cssRoot).filter(p => p.endsWith('.css')).map(p => fs.readFileSync(path.join(cssRoot, p), 'utf8')).join('\n');
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); }
    else if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html lang="ko"><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser, passed = 0;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const width of [360, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = [], writes = [];
      let adminMode = 'ok', delayedRoute = null, phoneMode = 'duplicate', verificationFails = true;
      let signalDelayed;
      const delayedStarted = new Promise(resolve => { signalDelayed = resolve; });
      const summary = { cohort_start: '2026-09-16T15:00:00Z', measured_at: '2026-09-23T03:00:00Z', tracking_since: '2026-09-22T16:00:00Z',
        counts: { joined: 68, verified: 40, profile: 13, one_on_one: 11, mutual: 3, exchanged: 1 },
        events: { profile_basic: 30, profile_intro: 25, profile_lifestyle: 20, profile_photos: 18, profile_review: 15, photo_rejected: 5 },
        unregistered: { profile_basic: 17, profile_photos: 5 } };
      page.on('pageerror', e => errors.push(e.message));
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        assert.equal(url.origin, origin, 'external request prohibited');
        if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
        if (req.method() !== 'GET') writes.push({ path: url.pathname, body: JSON.parse(req.postData()) });
        if (url.pathname === '/api/analytics/onboarding') {
          assert.deepEqual(Object.keys(JSON.parse(req.postData())), ['event']);
          await route.abort(); return;
        }
        if (url.pathname === '/api/mypage/summary') { await route.fulfill({ json: { profile: { phone_verified: false } } }); return; }
        if (url.pathname === '/api/mypage/phone-verification/send') {
          if (phoneMode === 'duplicate') await route.fulfill({ status: 409, json: { code: 'PHONE_ALREADY_USED', error: '이미 다른 계정에 등록된 번호입니다.' } });
          else await route.fulfill({ json: { pendingPhone: '+820000000000', resendAfterSec: 60 } });
          return;
        }
        if (url.pathname === '/api/mypage/phone-verification/verify') {
          await route.fulfill({ status: verificationFails ? 400 : 200, json: verificationFails ?
            { error: '검증용 코드 불일치', phone_verified: false } : { phone_verified: true } }); return;
        }
        assert.equal(url.pathname, '/api/admin/onboarding-funnel');
        assert.equal(req.method(), 'GET');
        if (adminMode === 'delay' && url.searchParams.get('days') === '30') { delayedRoute = route; signalDelayed(); return; }
        if (adminMode === 'missing') await route.fulfill({ json: { available: false } });
        else if (adminMode === 'error') await route.fulfill({ status: 503, json: { error: '검증용 조회 실패' } });
        else await route.fulfill({ json: { available: true, summary: url.searchParams.get('days') === '1' ? { ...summary, counts: { joined: 0, verified: 0, profile: 0, one_on_one: 0, mutual: 0, exchanged: 0 } } : summary } });
      });
      await page.goto(origin + '/mypage?fixture=admin');
      await page.getByText('68', { exact: false }).first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByText('입력·인증 중 막힌 지점', { exact: true }).click();
      await page.screenshot({ path: path.join(output, 'admin-' + width + '.png'), fullPage: true }); passed++;
      adminMode = 'delay'; await page.getByLabel('가입 기간').selectOption('30');
      let delayTimeout;
      try { await Promise.race([delayedStarted, new Promise((_, reject) => { delayTimeout = setTimeout(() => reject(Error('delayed request never started')), 10000); })]); }
      finally { clearTimeout(delayTimeout); }
      await page.getByLabel('가입 기간').selectOption('1');
      await page.getByText('이전 단계 대비 —').first().waitFor();
      assert.ok(delayedRoute);
      await delayedRoute.fulfill({ json: { available: true, summary } }).catch(() => {});
      assert.equal(await page.getByText('68명', { exact: true }).count(), 0);
      assert.ok(!(await page.locator('body').innerText()).includes('NaN')); passed++;
      adminMode = 'missing'; await page.getByRole('button', { name: '새로고침', exact: true }).click();
      await page.getByText(/통계 저장 설정이 아직/).waitFor(); passed++;
      adminMode = 'error'; await page.getByRole('button', { name: '새로고침', exact: true }).click();
      await page.getByRole('alert').waitFor(); assert.equal(await page.getByText('가입 회원', { exact: true }).count(), 0); passed++;
      for (const target of ['/mypage', '/payments/success', '/auth/callback', '/onboarding/dating']) {
        const before = writes.length;
        await page.goto(origin + target + '?fixture=error&paymentKey=PRIVATE_PAYMENT_KEY&email=PRIVATE_EMAIL');
        await page.getByText('문의 코드: GT-test-digest-1234').waitFor();
        assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE_'));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (target === '/mypage') {
          await page.getByRole('button', { name: '화면 다시 불러오기', exact: true }).evaluate(el => { el.click(); el.click(); });
          assert.equal(await page.evaluate(() => window.fixtureResetCount), 1);
          await page.getByRole('button', { name: '화면 다시 불러오기', exact: true }).waitFor();
        } else assert.equal(await page.getByRole('button', { name: '화면 다시 불러오기', exact: true }).count(), 0);
        assert.equal(writes.length, before, 'recovery must not replay mutations');
        if (target === '/payments/success') {
          await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw Error('denied'); } }, configurable: true }));
          await page.getByRole('button', { name: '문의 내용 복사', exact: true }).click();
          assert.ok(!(await page.getByLabel('복사할 문의 내용').inputValue()).includes('PRIVATE_'));
          await page.screenshot({ path: path.join(output, 'payment-error-' + width + '.png'), fullPage: true });
        }
        passed++;
      }
      await page.goto(origin + '/phone-verification?fixture=phone');
      await page.getByPlaceholder('01012345678').fill('01000000000');
      await page.getByRole('button', { name: '인증번호 받기', exact: true }).click();
      await page.getByText('이미 가입된 휴대폰 번호예요', { exact: true }).waitFor();
      assert.equal(writes.filter(w => w.path === '/api/mypage/phone-verification/send').length, 1);
      assert.ok(writes.some(w => w.path === '/api/analytics/onboarding' && w.body.event === 'phone_duplicate'));
      assert.deepEqual(errors, []); passed++;
      phoneMode = 'ok';
      await page.reload();
      await page.getByPlaceholder('01012345678').fill('01000000000');
      await page.getByRole('button', { name: '인증번호 받기', exact: true }).click();
      await page.getByPlaceholder('인증번호', { exact: true }).fill('000000');
      await page.getByRole('button', { name: '확인', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '검증용 코드 불일치' }).waitFor();
      assert.ok(writes.some(w => w.path === '/api/analytics/onboarding' && w.body.event === 'phone_verify_failed'));
      verificationFails = false;
      await page.getByRole('button', { name: '확인', exact: true }).click();
      await page.waitForFunction(() => Boolean(window.fixtureRedirect));
      assert.equal(writes.filter(w => w.path === '/api/mypage/phone-verification/send').length, 2);
      assert.equal(writes.filter(w => w.path === '/api/mypage/phone-verification/verify').length, 2);
      assert.deepEqual(errors, []); passed++;
      await context.close();
    }
    console.log(JSON.stringify({ passed, productionRequests: 0, screenshots: output }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
