/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), path = require('node:path');
const { startPreview } = require('./preview-profile-writing.cjs');
const { chromium } = require('./test-browser-runtime.cjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const card = { id: 'fixture-open', owner_user_id: 'fixture-member', status: 'public', sex: 'female',
  height_cm: 165, job: '회사원', region: '서울', strengths_text: '상대의 이야기를 잘 들어요.', ideal_type: '함께 산책하고 싶은 분',
  age: 29, display_nickname: '다른 표시이름', photo_visibility: 'public', instagram_id: 'DO_NOT_COPY',
  photo_preview_urls: [0, 1].map(i => '/i/signed/dating-card-photos/cards/fixture-member/raw/' + i + '.png') };
const freshPath = '/onboarding/dating?target=one_on_one';
(async () => {
  const { server, origin, output } = await startPreview();
  let browser, passed = 0;
  async function fixture(width, scenario = 'success') {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const requests = [], errors = [], posts = []; let reads = 0, imageReads = 0, failedOnce = false;
    page.on('pageerror', e => errors.push(e.message));
    if (scenario === 'timeout') await context.addInitScript(() => {
      const original = window.setTimeout;
      window.setTimeout = (fn, delay, ...args) => original(fn, delay === 20000 ? 60 : delay, ...args);
    });
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      assert.equal(url.origin, origin, 'production/external traffic is prohibited');
      requests.push({ method: req.method(), path: url.pathname });
      if (url.pathname === '/api/analytics/onboarding') { await route.fulfill({ status: 204 }); return; }
      if (req.method() !== 'GET') {
        if (url.pathname === '/api/dating/1on1/upload') {
          posts.push({ path: url.pathname, file: req.postDataBuffer().toString('latin1') });
          await route.fulfill({ status: 201, json: { path: 'cards/fixture-member/photo-' + posts.length + '.webp' } }); return;
        }
        if (url.pathname === '/api/dating/1on1/cards') {
          posts.push({ path: url.pathname, body: req.postDataJSON() });
          await route.fulfill({ status: 201, json: { id: 'fixture-new' } }); return;
        }
        throw new Error('Unexpected mutation: ' + url.pathname);
      }
      if (url.pathname === '/api/dating/1on1/write-status' && ['unverified', 'existing', 'paused'].includes(scenario)) {
        await route.fulfill({ json: { phoneVerified: scenario !== 'unverified', canWrite: false,
          writeStatus: scenario === 'paused' ? 'paused' : 'approved', activeRequestStatus: scenario === 'existing' ? 'approved' : null } }); return;
      }
      if (url.pathname === '/api/dating/cards/my') {
        reads++;
        if (scenario === 'unauthorized' && reads > 1) { await route.fulfill({ status: 401, json: {} }); return; }
        const source = scenario === 'foreign' ? { ...card, photo_preview_urls: card.photo_preview_urls.map(p => p.replace('/fixture-member/', '/someone-else/')) } : card;
        await route.fulfill({ json: { items: ['none', 'existing', 'paused', 'unverified'].includes(scenario) ? [] : [source] } }); return;
      }
      if (url.pathname.startsWith('/i/signed/')) {
        imageReads++;
        const second = url.pathname.endsWith('/1.png');
        if (['cancel', 'timeout', 'auth-change'].includes(scenario)) await new Promise(resolve => setTimeout(resolve, 300));
        if (scenario === 'retry' && second && !failedOnce) { failedOnce = true; await route.fulfill({ status: 404 }); return; }
        if (scenario === 'broken' && second) { await route.fulfill({ contentType: 'image/png', body: Buffer.from('not an image') }); return; }
        if (scenario === 'foreign') throw Error('Foreign image must not be fetched');
        await route.fulfill({ contentType: 'image/png', body: PNG }); return;
      }
      await route.continue();
    });
    return { context, page, requests, errors, posts, get reads() { return reads; }, get imageReads() { return imageReads; } };
  }
  const field = (page, name) => page.locator('#onboarding-field-' + name);
  const next = page => page.getByRole('button', { name: '다음', exact: true }).click();
  const importButton = page => page.getByRole('button', { name: '오픈카드 내용 가져오기', exact: true });
  async function toPhotos(page) {
    await field(page, 'name').fill('테스트 이름'); await field(page, 'birthYear').fill('1996');
    await next(page); await field(page, 'introText').fill('주말에는 산책과 독서를 즐겨요.');
    await next(page); await next(page);
    await page.getByRole('heading', { name: '사진 두 장', exact: true }).waitFor();
  }
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390, 1280]) {
      const f = await fixture(width), { page } = f;
      await page.goto(origin + '/community/dating/cards?tab=one_on_one');
      const start = page.getByRole('link', { name: '기존 프로필로 시작하기', exact: true });
      await start.waitFor(); assert.equal(await start.getAttribute('href'), freshPath);
      await start.click(); await importButton(page).waitFor();
      assert.equal(await page.getByRole('button', { name: /^1:1 매칭\s*추천/ }).getAttribute('aria-pressed'), 'true');
      await field(page, 'region').fill('부산 수영구');
      const readsBefore = f.reads;
      await importButton(page).evaluate(button => { button.click(); button.click(); });
      await page.getByText('오픈카드 내용을 가져왔어요.', { exact: false }).waitFor();
      assert.equal(f.reads - readsBefore, 1, 'double-click import is single-flight');
      assert.equal(f.imageReads, 2); assert.equal(f.posts.length, 0, 'import must not register or upload');
      assert.equal(await field(page, 'region').inputValue(), '부산 수영구');
      assert.equal(await field(page, 'heightCm').inputValue(), '165');
      assert.equal(await field(page, 'name').inputValue(), ''); assert.equal(await field(page, 'birthYear').inputValue(), '');
      await page.screenshot({ path: path.join(output, 'reuse-basic-' + width + '.png'), fullPage: true });
      await toPhotos(page);
      assert.equal(await page.getByAltText(/사진 [12] 미리보기/).count(), 2);
      assert.ok(await page.getByAltText('사진 1 미리보기').evaluate(img => img.complete && img.naturalWidth > 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, 'reuse-photos-' + width + '.png'), fullPage: true });
      await next(page);
      await page.getByText('등록할 서비스: 1:1 매칭', { exact: true }).waitFor();
      assert.equal(await page.locator('input[type=checkbox]:checked').count(), 0, 'no auto-consent');
      const submit = page.getByRole('button', { name: '선택한 프로필 등록하기', exact: true });
      await submit.click(); assert.equal(f.posts.length, 0, 'missing consent blocks all uploads');
      for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
      await page.screenshot({ path: path.join(output, 'reuse-review-' + width + '.png'), fullPage: true });
      await submit.evaluate(button => { button.click(); button.click(); });
      await page.waitForFunction(() => window.fixtureRedirect?.includes('from=onboarding'));
      assert.equal(f.posts.length, 3, 'two private uploads + one registration, no duplicate');
      assert.equal(f.posts.filter(r => r.path === '/api/dating/1on1/cards').length, 1);
      const registered = f.posts.at(-1).body;
      assert.equal(registered.region, '부산 수영구'); assert.equal(registered.strengths_text, card.strengths_text);
      assert.ok(registered.photo_paths.every(p => p.startsWith('cards/fixture-member/') && !p.includes('/raw/')));
      assert.equal(registered.instagram_id, undefined); assert.equal(registered.phone, undefined);
      assert.deepEqual(f.errors, []); passed++; await f.context.close();
    }
    for (const scenario of ['none', 'retry', 'broken', 'foreign', 'unauthorized', 'cancel', 'timeout', 'existing', 'paused', 'unverified']) {
      const f = await fixture(390, scenario), { page } = f;
      await page.goto(origin + freshPath);
      if (scenario === 'unverified') {
        await page.waitForFunction(() => window.fixtureRedirect?.startsWith('/phone-verification'));
        assert.ok(decodeURIComponent(await page.evaluate(() => window.fixtureRedirect)).includes(freshPath));
      } else if (scenario === 'existing' || scenario === 'paused') {
        await page.getByText(scenario === 'existing' ? '이미 준비가 끝났어요' : '지금은 1:1 프로필을 등록할 수 없어요', { exact: true }).waitFor();
        assert.equal(await importButton(page).count(), 0);
        assert.equal(await page.getByRole('button', { name: '다음', exact: true }).count(), 0);
      } else if (scenario === 'none') {
        await page.getByRole('heading', { name: '기본 정보', exact: true }).waitFor();
        const open = page.getByRole('button', { name: /^오픈카드\s*내 카드/ });
        assert.equal(await open.getAttribute('aria-pressed'), 'false');
        await open.click(); assert.equal(await open.getAttribute('aria-pressed'), 'true');
        assert.equal(await importButton(page).count(), 0);
        await page.screenshot({ path: path.join(output, 'one-only-start.png'), fullPage: true });
      } else {
        await importButton(page).waitFor(); await field(page, 'region').fill('내가 적은 지역');
        await importButton(page).click();
        if (scenario === 'cancel') await page.getByRole('button', { name: '취소', exact: true }).click();
        await importButton(page).waitFor();
        await page.getByRole('region', { name: '오픈카드 내용 가져오기' }).getByRole('status').waitFor();
        assert.ok(await importButton(page).isEnabled()); assert.equal(await field(page, 'region').inputValue(), '내가 적은 지역');
        if (scenario === 'foreign') assert.equal(f.imageReads, 0, 'never fetch another owner photo');
        if (scenario === 'retry') {
          assert.equal(f.imageReads, 2); await importButton(page).click();
          await page.getByText('이름·출생연도·자기소개와 나머지 항목을 확인해 주세요.', { exact: false }).waitFor();
          assert.equal(f.imageReads, 3, 'retry fetches only the missing photo');
          await toPhotos(page); assert.equal(await page.getByAltText(/사진 [12] 미리보기/).count(), 2);
        }
        if (scenario === 'broken') {
          await toPhotos(page); assert.equal(await page.getByAltText(/사진 [12] 미리보기/).count(), 1);
          await field(page, 'photo1').setInputFiles({ name: 'manual.png', mimeType: 'image/png', buffer: PNG });
          await next(page); await page.getByRole('heading', { name: '마지막 확인', exact: true }).waitFor();
        }
      }
      assert.equal(f.posts.length, 0); assert.deepEqual(f.errors, [], scenario); passed++; await f.context.close();
    }
    // A photo selected by the member must survive an import/retry of missing content.
    {
      const f = await fixture(390), { page } = f;
      await page.goto(origin + freshPath); await importButton(page).click();
      await page.getByText('오픈카드 내용을 가져왔어요.', { exact: false }).waitFor();
      await toPhotos(page);
      const oldPreview = await page.getByAltText('사진 1 미리보기').getAttribute('src');
      await field(page, 'photo0').setInputFiles({ name: 'my-new-photo.png', mimeType: 'image/png', buffer: PNG });
      await page.waitForFunction(old => {
        const img = document.querySelector('img[alt="사진 1 미리보기"]');
        return img?.getAttribute('src') !== old && img?.complete && img?.naturalWidth > 0;
      }, oldPreview);
      const before = await page.getByAltText('사진 1 미리보기').getAttribute('src'), readCount = f.imageReads;
      await importButton(page).click(); await importButton(page).waitFor();
      assert.equal(f.imageReads, readCount, 'existing files are not fetched again');
      assert.equal(await page.getByAltText('사진 1 미리보기').getAttribute('src'), before, 'manual photo is preserved');
      await next(page);
      for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
      await page.getByRole('button', { name: '선택한 프로필 등록하기', exact: true }).click();
      await page.waitForFunction(() => window.fixtureRedirect?.includes('from=onboarding'));
      assert.ok(f.posts[0].file.includes('my-new-photo.png'), 'the user-selected file is uploaded, not the imported file');
      assert.deepEqual(f.errors, []); passed++; await f.context.close();
    }
    // Changing accounts aborts in-flight photo reads; the old profile must not reach the next page.
    {
      const f = await fixture(390, 'auth-change'), { page } = f;
      await page.goto(origin + freshPath); await importButton(page).click();
      await page.getByText('내용과 사진을 가져오고 있어요…', { exact: true }).waitFor();
      await f.context.addInitScript(() => { window.fixtureUser = 'different-member'; });
      await page.evaluate(() => { window.fixtureUser = 'different-member'; window.fixtureRefresh(); });
      await page.waitForLoadState('load');
      await page.getByRole('heading', { name: '기본 정보', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('#onboarding-field-region')?.value === '');
      assert.equal(await importButton(page).count(), 0);
      assert.equal(f.posts.length, 0); assert.deepEqual(f.errors, []); passed++; await f.context.close();
    }
    for (const search of ['', '?target=one_on_one', '?next=instant_open_card&target=one_on_one']) {
      const f = await fixture(390, 'none'), { page } = f;
      await f.context.addInitScript(() => localStorage.setItem('gymtools:dating-onboarding-draft:v1:fixture-member', JSON.stringify({
        version: 1, userId: 'fixture-member', savedAt: Date.now(), step: 0,
        targets: { open: true, oneOnOne: true }, fields: { name: '작성하던 이름', job: '회사원' },
      })));
      await page.goto(origin + '/onboarding/dating' + search);
      await page.getByRole('button', { name: '이어서 작성', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: /^오픈카드\s*내 카드/ }).getAttribute('aria-pressed'), search === '?target=one_on_one' ? 'false' : 'true');
      const one = page.getByRole('button', { name: /^1:1 매칭\s*추천/ });
      assert.equal(await one.getAttribute('aria-pressed'), search.includes('instant_open_card') ? 'false' : 'true');
      assert.equal(f.posts.length, 0); assert.deepEqual(f.errors, []); passed++; await f.context.close();
    }
    console.log(JSON.stringify({ passed, productionRequests: 0, screenshots: output }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
