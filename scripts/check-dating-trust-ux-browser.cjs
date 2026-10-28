/* eslint-disable @typescript-eslint/no-require-imports */
// Actual React/canvas/fetch flow on localhost, all persistence intercepted. No real accounts.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('./test-browser-runtime.cjs');
const { startPreview } = require('./preview-trust-ux.cjs');
const id = '00000000-0000-4000-8000-000000000001';
(async () => {
  const f = await startPreview(); let browser; let cases = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390, 768]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/*', route => { assert.equal(new URL(route.request().url()).origin, f.origin, 'no external calls'); return route.continue(); });
      const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(f.origin + '/?mode=candidates');
      const first = page.getByRole('article').first();
      await first.getByRole('button', { name: '매칭 요청 보내기', exact: true }).waitFor();
      assert.equal(await first.locator('img').count(), 4);
      await first.getByRole('button', { name: '소개 더보기', exact: true }).click();
      await first.getByText('상대의 이야기를 잘 듣고 약속을 지켜요.', { exact: false }).waitFor();
      assert.equal(await page.getByLabel('로컬 동작 기록').innerText(), '동작 없음');
      await first.getByRole('button', { name: '소개 접기', exact: true }).click();
      await first.getByRole('button', { name: '매칭 요청 보내기', exact: true }).click();
      assert.match(await page.getByLabel('로컬 동작 기록').innerText(), /매칭 요청:/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(f.output, `candidates-${width}.png`), fullPage: true });
      await first.getByRole('button', { name: '미리보기 회원 신고', exact: true }).click();
      await page.getByRole('combobox', { name: /^신고 사유/ }).selectOption({ index: 1 });
      await page.getByLabel('상세 내용 (선택)', { exact: true }).fill('차단실패');
      await page.getByRole('button', { name: '신고 접수', exact: true }).click();
      await page.getByRole('button', { name: '차단 다시 시도', exact: true }).waitFor();
      await page.getByRole('button', { name: '확인', exact: true }).click();
      assert.equal(await page.getByRole('article').count(), 2);
      await first.getByRole('button', { name: '미리보기 회원 신고', exact: true }).click();
      await page.getByRole('combobox', { name: /^신고 사유/ }).selectOption({ index: 1 });
      await page.getByRole('button', { name: '신고 접수', exact: true }).click();
      await page.getByRole('button', { name: '확인', exact: true }).click();
      await page.getByText('차단 성공 · 목록 재조회 실패 상황에서도 상대 제거', { exact: false }).waitFor();
      assert.equal(await page.getByRole('article').count(), 1);
      assert.equal(await page.getByRole('button', { name: '미리보기 회원 신고', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '후보 새로고침 · 1회', exact: true }).count(), 1);
      await page.goto(f.origin + '/?mode=contact');
      const exchange = page.getByRole('button', { name: '연락처 교환하기', exact: true });
      const price = page.getByText('18,000원', { exact: true }); await exchange.waitFor();
      assert.equal(await exchange.getAttribute('aria-describedby'), await price.getAttribute('id'));
      assert.equal(await page.getByLabel('로컬 동작 기록').innerText(), '동작 없음');
      await exchange.click(); assert.match(await page.getByLabel('로컬 동작 기록').innerText(), /실제 결제 없음/);
      await page.getByText('연락처 교환 안내', { exact: true }).click();
      await page.getByText('한 분이 결제를 완료하면 두 분 모두 연락처를 확인할 수 있어요. 각각 결제할 필요는 없어요.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByText('연락처 교환 안내', { exact: true }).click();
      await page.screenshot({ path: path.join(f.output, `contact-${width}.png`), fullPage: true });
      await page.goto(f.origin + '/?mode=guest');
      await page.getByRole('link', { name: '로그인하기', exact: true }).waitFor();
      await page.getByRole('button', { name: '매칭 안내', exact: true }).click();
      await page.getByText(/사진·직업·소개는 회원이 직접 등록한 정보/).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.goto(f.origin + '/?mode=notice');
      const notice = page.getByRole('dialog', { name: '더 나은 짐툴을 만들어가겠습니다' });
      await notice.waitFor();
      await notice.getByText('1:1 연락처 교환 · 10% 인하', { exact: true }).waitFor();
      assert.doesNotMatch(await notice.innerText(), /18,?000|20,?000|\d[\d,]*\s*원/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
      await page.screenshot({ path: path.join(f.output, `notice-${width}.png`), fullPage: false });
      await page.keyboard.press('Escape'); await notice.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert.equal(await page.getByLabel('로컬 동작 기록').innerText(), '동작 없음');
      // Actual global host: fixed release time, once-only acknowledgement and checkout exclusion.
      await page.clock.setFixedTime(new Date('2026-10-28T22:31:00+09:00'));
      await page.goto(f.origin + '/?mode=announcement');
      const friendNotice = page.getByRole('dialog', { name: '친구 추천 기능 안내' });
      await friendNotice.waitFor();
      assert.equal(await page.locator('dialog[open]').count(), 1, 'notices must not stack');
      await friendNotice.getByRole('button', { name: '친구 추천 안내 닫기', exact: true }).click();
      await friendNotice.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => localStorage.getItem('site-announcement:friend-recommendation-2026-10-28')), '1');
      await page.reload(); await page.waitForTimeout(600);
      assert.equal(await page.locator('dialog[open]').count(), 0);
      await page.evaluate(() => localStorage.clear());
      await page.goto(f.origin + '/payments/success?mode=announcement'); await page.waitForTimeout(600);
      assert.equal(await page.locator('dialog[open]').count(), 0, 'checkout must not be interrupted');
      await page.goto(f.origin + '/s/share-token?mode=announcement'); await page.waitForTimeout(600);
      assert.equal(await page.locator('dialog[open]').count(), 0, 'shared profiles must not be interrupted');
      await page.clock.setFixedTime(new Date('2026-10-30T22:30:01+09:00'));
      await page.goto(f.origin + '/?mode=announcement'); await page.waitForTimeout(600);
      assert.equal(await page.locator('dialog[open]').count(), 0, 'notice stays expired');
      assert.deepEqual(errors, []); cases++; await context.close();
    }
    // Replacing only the second photo: failure at each transport boundary must keep first photo and DB untouched.
    for (const scenario of ['raw413', 'liteInvalid', 'blur503', 'network']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 900 } }), page = await context.newPage();
      const errors = [], uploads = [], saves = []; let failed = false;
      page.on('pageerror', e => errors.push(e.message)); page.on('dialog', dialog => dialog.accept());
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()); assert.equal(url.origin, f.origin);
        if (req.method() === 'POST' && url.pathname === '/api/dating/cards/upload-card') {
          const form = await new Response(req.postDataBuffer(), { headers: { 'content-type': req.headers()['content-type'] } }).formData();
          const kind = form.get('kind'), asset = form.get('asset_id'), index = form.get('index');
          assert.equal(index, '1'); assert.ok(asset); uploads.push({ kind, asset });
          if (!failed && ((scenario === 'raw413' || scenario === 'network') && kind === 'raw' || scenario === 'liteInvalid' && kind === 'lite' || scenario === 'blur503' && kind === 'blur')) {
            failed = true;
            if (scenario === 'network') return route.abort();
            return route.fulfill(scenario === 'liteInvalid' ? { status: 200, contentType: 'application/json', body: '{}' } : { status: scenario === 'raw413' ? 413 : 503, body: '{}' });
          }
          return route.fulfill({ status: 201, json: { path: `cards/fixture/${kind}/${asset}-1.webp` } });
        }
        if (req.method() === 'PATCH' && url.pathname === '/api/dating/cards/my') {
          saves.push(req.postDataJSON()); return route.fulfill({ status: 200, json: { ok: true } });
        }
        return route.continue();
      });
      await page.goto(f.origin + '/community/dating/cards/new?editId=' + id);
      await page.getByRole('button', { name: '다음', exact: true }).click();
      await page.getByRole('button', { name: '다음', exact: true }).click();
      const photo = fs.readFileSync(path.join(__dirname, '../public/mascot/jimnyang-guide-v2.png'));
      await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'new.png', mimeType: 'image/png', buffer: photo });
      await page.getByRole('button', { name: '다음', exact: true }).click();
      await page.getByRole('button', { name: '수정 저장', exact: true }).click();
      await page.getByRole('alert').waitFor(); assert.equal(saves.length, 0);
      const submit = page.getByRole('button', { name: '수정 저장', exact: true }); await submit.waitFor();
      assert.equal(await submit.isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(f.output, `edit-${scenario}.png`), fullPage: true });
      await submit.click(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => b.textContent === '처리 중...'));
      assert.equal(saves.length, 1); const saved = saves[0];
      assert.equal(saved.id, id); assert.equal(saved.photo_paths[0], 'cards/fixture/raw/old-0.webp');
      assert.equal(saved.blur_paths[0], 'cards/fixture/blur/old-0.webp'); assert.equal(saved.blur_thumb_path, 'cards/fixture/blur/old-0.webp');
      assert.match(saved.photo_paths[1], /\/raw\/.+-1.webp$/); assert.match(saved.blur_paths[1], /\/blur\/.+-1.webp$/);
      assert.equal(saved.photo_visibility, 'blur'); assert.equal(saved.ideal_type, '다정한 분');
      assert.equal(new Set(uploads.slice(-3).map(u => u.asset)).size, 1, 'raw/lite/blur share one asset');
      assert.deepEqual(errors, []); cases++; await context.close();
    }
    console.log(JSON.stringify({ ok: true, cases, widths: [320, 390, 768], productionRequests: 0, screenshots: f.output }));
  } finally { await browser?.close(); await new Promise(resolve => f.server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
