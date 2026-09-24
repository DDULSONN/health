/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), path = require('node:path');
const { startPreview } = require('./preview-profile-writing.cjs');
const runtime = process.env.CODEX_NODE_PACKAGES || 'C:/Users/DDULSONN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(path.join(runtime, 'playwright'));
const makeDraft = extra => ({ version: 1, userId: 'fixture-member', savedAt: Date.now(), step: 1,
  targets: { open: true, oneOnOne: true }, fields: {
    nickname: '테스트', sex: 'female', name: '비공개 이름', birthYear: '1996', heightCm: '165', job: '회사원', region: '서울',
    introText: '한글 임시저장 비공개 내용', strengthsText: '', preferredPartnerText: '', smoking: 'non_smoker',
    workoutFrequency: '', trainingYears: '', instagramId: '', total3Lift: '', photoVisibility: 'blur',
  }, ...extra });
(async () => {
  const { server, origin, output } = await startPreview();
  let browser, passed = 0;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const width of [360, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()); assert.equal(url.origin, origin, 'external request prohibited');
        requests.push({ method: req.method(), path: url.pathname });
        assert.ok(req.method() === 'GET' || url.pathname === '/api/analytics/onboarding', 'no real mutation');
        await route.continue();
      });
      await context.addInitScript(d => localStorage.setItem('gymtools:dating-onboarding-draft:v1:fixture-member', JSON.stringify(d)), makeDraft());
      await page.goto(origin + '/community/dating/cards?tab=open_cards');
      const prompt = page.getByRole('region', { name: '작성 중인 프로필', exact: true });
      await prompt.waitFor(); assert.equal(await prompt.count(), 1);
      assert.ok(!(await page.locator('body').innerText()).includes('비공개'));
      assert.equal(await page.getByRole('heading', { name: '프로필을 완성해 주세요' }).count(), 0);
      assert.equal(await prompt.getByRole('link').getAttribute('href'), '/onboarding/dating');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, 'home-open-' + width + '.png'), fullPage: true, animations: 'disabled' }); passed++;
      await page.getByRole('button', { name: /^1대1매칭/ }).click();
      await page.waitForURL('**tab=one_on_one'); await prompt.waitFor();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: path.join(output, 'home-one-' + width + '.png'), fullPage: true, animations: 'disabled' }); passed++;
      await prompt.getByRole('link', { name: '이어서 작성', exact: true }).click();
      await page.getByRole('button', { name: '이어서 작성', exact: true }).click();
      assert.equal(await page.locator('#onboarding-field-introText').inputValue(), makeDraft().fields.introText);
      assert.equal(await page.locator('textarea').count(), 3);
      const example = page.getByRole('button', { name: '평소 어떻게 지내세요? 작성 예시', exact: true });
      const initialValues = await page.locator('textarea').evaluateAll(nodes => nodes.map(n => n.value));
      await example.click(); assert.equal(await example.getAttribute('aria-expanded'), 'true');
      assert.deepEqual(await page.locator('textarea').evaluateAll(nodes => nodes.map(n => n.value)), initialValues);
      await page.screenshot({ path: path.join(output, 'intro-example-' + width + '.png'), fullPage: true });
      await example.click(); assert.equal(await example.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('#onboarding-field-strengthsText').getAttribute('maxlength'), '150');
      await page.getByRole('button', { name: '다음', exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.id === 'onboarding-field-strengthsText');
      assert.equal(await page.locator('textarea[aria-invalid="true"]').count(), 2);
      await page.locator('#onboarding-field-strengthsText').fill('약속을 잘 지키고 상대 이야기를 들어요.');
      await page.locator('#onboarding-field-preferredPartnerText').fill('함께 걷고 대화하는 것을 좋아하는 분');
      await page.screenshot({ path: path.join(output, 'intro-' + width + '.png'), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('button', { name: '다음', exact: true }).click();
      await page.getByRole('heading', { name: '생활 정보', exact: true }).waitFor();
      assert.deepEqual(errors, []); passed++;
      await context.close();
    }
    for (const scenario of ['expired','malformed','other-account','empty','already-registered','completed-target','phone-unverified','status-failure','storage-denied']) {
      const context = await browser.newContext({ viewport: { width: 360, height: 900 } }), page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      let d = makeDraft();
      if (scenario === 'expired') d.savedAt -= 8 * 86400000;
      if (scenario === 'other-account') d.userId = 'someone-else';
      if (scenario === 'empty') d.fields = {};
      if (scenario === 'completed-target') d.targets = { open: true, oneOnOne: false };
      await context.addInitScript(({ d, scenario }) => {
        localStorage.setItem('gymtools:dating-onboarding-draft:v1:fixture-member', scenario === 'malformed' ? '{bad' : JSON.stringify(d));
        if (scenario === 'storage-denied') Object.defineProperty(window, 'localStorage', { get() { throw Error('denied'); } });
      }, { d, scenario });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()); assert.equal(url.origin, origin);
        assert.equal(req.method(), 'GET');
        if (scenario === 'status-failure' && url.pathname === '/api/dating/cards/my') { await route.fulfill({ status: 503, json: {} }); return; }
        if ((scenario === 'already-registered' || scenario === 'completed-target') && url.pathname === '/api/dating/cards/my') {
          await route.fulfill({ json: { items: [{ id: 'fixture-open', status: 'pending' }] } }); return;
        }
        if (scenario === 'already-registered' && url.pathname === '/api/dating/1on1/write-status') {
          await route.fulfill({ json: { canWrite: false, activeRequestStatus: 'approved', phoneVerified: true } }); return;
        }
        if (scenario === 'phone-unverified' && url.pathname === '/api/mypage/summary') {
          await route.fulfill({ json: { profile: { phone_verified: false } } }); return;
        }
        await route.continue();
      });
      await page.goto(origin + '/community/dating/cards?tab=open_cards');
      await page.getByRole('navigation', { name: '오픈카드 유료 기능' }).waitFor();
      await page.waitForLoadState('networkidle');
      assert.equal(await page.getByRole('region', { name: '작성 중인 프로필' }).count(), 0, scenario);
      assert.deepEqual(errors, [], scenario); passed++;
      await context.close();
    }
    // Isolated actual hook: test auth changes without the home's pre-existing full-page reload.
    const context = await browser.newContext(), page = await context.newPage(); let networkCount = 0;
    await context.route('**/*', async route => { assert.equal(new URL(route.request().url()).origin, origin); networkCount++; await route.continue(); });
    await context.addInitScript(d => localStorage.setItem('gymtools:dating-onboarding-draft:v1:fixture-member', JSON.stringify(d)), makeDraft());
    await page.goto(origin + '/preview/draft-hook'); await page.getByRole('link', { name: '이어서 작성' }).waitFor();
    const before = networkCount;
    await page.evaluate(() => { const k = 'gymtools:dating-onboarding-draft:v1:fixture-member'; const d = JSON.parse(localStorage.getItem(k)); d.step = 3; localStorage.setItem(k, JSON.stringify(d)); dispatchEvent(new Event('focus')); });
    await page.getByText('사진 등록 · 임시저장', { exact: true }).waitFor();
    await page.evaluate(() => { window.fixtureUser = 'different-member'; window.fixtureRefresh(); });
    await page.getByText('저장된 프로필 없음', { exact: true }).waitFor();
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    assert.equal(await page.getByRole('link', { name: '이어서 작성' }).count(), 0); passed++;
    await page.evaluate(() => { window.fixtureUser = 'fixture-member'; window.fixtureRefresh(); });
    await page.getByRole('link', { name: '이어서 작성' }).waitFor();
    await page.evaluate(() => window.fixtureSignOut());
    await page.getByText('저장된 프로필 없음', { exact: true }).waitFor(); passed++;
    await page.evaluate(() => { window.fixtureRefresh(); const k = 'gymtools:dating-onboarding-draft:v1:fixture-member'; localStorage.removeItem(k); dispatchEvent(new StorageEvent('storage', { key: k })); });
    await page.getByText('저장된 프로필 없음', { exact: true }).waitFor();
    assert.equal(networkCount, before, 'draft updates must not add server calls'); passed++;
    await context.close();
    console.log(JSON.stringify({ passed, productionRequests: 0, screenshots: output }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
