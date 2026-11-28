/* eslint-disable @typescript-eslint/no-require-imports */
// Real 1:1 editor with synthetic API replies. No live account, image or server writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startPreview } = require('./preview-profile-writing.cjs');
const { chromium } = require('./test-browser-runtime.cjs');

const original = ['/existing-photo-1.svg', '/existing-photo-2.svg'];
const card = { id: 'fixture-card', sex: 'female', name: '검증회원', birth_year: 1995, height_cm: 165,
  job: '회사원', region: '경기 수원', intro_text: '함께 운동하는 일상', strengths_text: '차분한 성격',
  preferred_partner_text: '대화가 잘 통하는 분', smoking: 'non_smoker', workout_frequency: '3_4',
  status: 'submitted', admin_tags: [], photo_signed_urls: original };
const draftIntro = '수정하는 중에도 남아 있어야 할 자기소개입니다.';
const smaller = fs.readFileSync(path.join(__dirname, '../public/mascot/jimnyang-guide-v2.png'));
const larger = Buffer.alloc(5 * 1024 * 1024);
smaller.copy(larger);
const serverPath = slot => `cards/fixture-member/${slot}.webp`;

async function main() {
  const { server, origin, output } = await startPreview(0, 'profile-edit-browser.tsx');
  let browser, passed = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [360, 1280]) for (const scenario of ['network', 'too-large']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      const errors = [], uploads = [], saves = [], unexpected = [];
      const counts = { first: 0, second: 0 };
      const failedSecondRequests = scenario === 'network' ? 0 : 1;
      const editCard = scenario === 'network' ? { ...card, status: 'rejected', admin_tags: ['one_on_one_user_deleted'] } : card;
      let failSecond = true;
      page.on('pageerror', error => errors.push(error.message));
      const failure = /사진 2\s*[:·]/;
      const next = () => page.getByRole('button', { name: '다음', exact: true });
      const previous = () => page.getByRole('button', { name: '이전', exact: true });
      const save = () => page.getByRole('button', { name: '수정 저장', exact: true });

      await context.addInitScript(() => {
        window.photoFormSubmissions = [];
        document.addEventListener('submit', event => {
          window.photoFormSubmissions.push(event.submitter?.textContent ?? null);
        }, true);
      });
      if (scenario === 'network') await context.addInitScript(() => {
        const originalFetch = window.fetch;
        window.photoNetworkFixture = { offline: true, calls: 0 };
        window.fetch = function (input, init) {
          // Inject the pre-response network rejection at the Fetch boundary;
          // Chromium can internally retransmit intercepted aborted requests.
          if (input === '/api/dating/1on1/upload' && init?.body instanceof FormData &&
              init.body.get('file') instanceof File && /^second\./.test(init.body.get('file').name)) {
            window.photoNetworkFixture.calls += 1;
            if (window.photoNetworkFixture.offline) return Promise.reject(new TypeError('Fixture connection lost'));
          }
          return originalFetch.call(this, input, init);
        };
      });

      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) { unexpected.push(`outside loopback: ${url.origin}`); return route.abort(); }
        if (req.method() === 'GET') {
          if (url.pathname === '/api/dating/1on1/write-status') return route.fulfill({ json: {
            loggedIn: true, isAdmin: false, phoneVerified: true, canWrite: false, activeRequestStatus: 'submitted', writeStatus: 'approved', totalApplications: 1,
          } });
          if (url.pathname === '/api/dating/1on1/my') return route.fulfill({ json: { items: [editCard] } });
          if (original.includes(url.pathname)) return route.fulfill({ contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="gray"/></svg>' });
          return route.continue();
        }
        if (url.pathname === '/api/analytics/onboarding') return route.fulfill({ status: 204 });
        if (req.method() === 'POST' && url.pathname === '/api/dating/1on1/upload') {
          const body = req.postDataBuffer();
          assert.ok(body.length < 4_500_000, 'multipart request fits the production transport');
          const form = await new Response(body, { headers: { 'content-type': req.headers()['content-type'] } }).formData();
          const file = form.get('file');
          assert.ok(file instanceof File && file.size <= 3 * 1024 * 1024);
          const slot = /^(first|second)\./.exec(file.name)?.[1];
          assert.ok(slot, 'both explicit photo slots remain distinct');
          uploads.push({ slot, name: file.name, size: file.size, type: file.type });
          counts[slot] += 1;
          if (slot === 'second') {
            assert.equal(file.type, 'image/jpeg', 'a 5 MB regular photo was resized first');
            if (scenario === 'too-large' && failSecond) return route.fulfill({ status: 413, contentType: 'text/plain', body: 'FUNCTION_PAYLOAD_TOO_LARGE' });
          }
          return route.fulfill({ status: 201, json: { path: serverPath(slot) } });
        }
        if (req.method() === 'PATCH' && url.pathname === '/api/dating/1on1/my') {
          saves.push(req.postDataJSON());
          return route.fulfill({ status: 200, json: { ok: true, id: card.id } });
        }
        unexpected.push(`${req.method()} ${url.pathname}`);
        return route.abort();
      });

      try {
        await page.goto(`${origin}/dating/1on1?editId=${card.id}`);
        await page.getByRole('heading', { name: '1:1 신청 수정', exact: true }).waitFor();
        await next().click(); await next().click();
        await page.getByLabel('자기소개', { exact: true }).fill(draftIntro);
        await next().click();
        const photoInputs = page.locator('input[type="file"]');
        assert.equal(await photoInputs.count(), 2);
        await photoInputs.nth(0).setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: smaller });
        await photoInputs.nth(1).setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: larger });
        await page.getByText('first.png', { exact: true }).waitFor();
        await page.getByText('second.jpg', { exact: true }).waitFor();
        if (scenario === 'network') {
          // Mock the unreadable temporary File object an iCloud/webview picker
          // can return, not the actual photo or device. A failed replacement
          // must leave the prior selection intact and never start an upload.
          await page.evaluate(() => {
            const read = File.prototype.arrayBuffer;
            File.prototype.arrayBuffer = function () {
              return this.name === 'unreadable.png'
                ? Promise.reject(new DOMException('Fixture unreadable file', 'NotReadableError')) : read.call(this);
            };
          });
          await photoInputs.nth(1).setInputFiles({ name: 'unreadable.png', mimeType: 'image/png', buffer: smaller });
          await page.getByText(/사진 2: 선택한 사진을 읽지 못했어요/).waitFor();
          assert.ok(await page.getByText('second.jpg', { exact: true }).isVisible());
          assert.deepEqual(uploads, []);
          await photoInputs.nth(1).setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: larger });
        }
        await next().click();
        await save().waitFor();
        assert.deepEqual(await page.evaluate(() => window.photoFormSubmissions), [], 'entering final confirmation must not implicitly submit');
        assert.deepEqual(uploads, []);
        assert.deepEqual(saves, []);
        await save().click();
        const alert = page.getByRole('alert');
        await alert.waitFor();
        const message = await alert.innerText();
        assert.match(message, failure, `the failing slot is identified: ${JSON.stringify({ width, scenario, counts, saves: saves.length, unexpected })}`);
        if (scenario === 'too-large') assert.match(message, /용량|크/);
        else assert.match(message, /연결|업로드/);
        assert.doesNotMatch(message, /FUNCTION_PAYLOAD_TOO_LARGE|net::ERR|TypeError|Failed to fetch/i);
        assert.deepEqual(counts, { first: 1, second: failedSecondRequests });
        if (scenario === 'network') assert.equal(await page.evaluate(() => window.photoNetworkFixture.calls), 2);
        assert.deepEqual(saves, [], 'never save a partially uploaded replacement');
        assert.equal(await page.evaluate(() => window.fixtureRedirect), undefined);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: path.join(output, `${scenario}-${width}-recovery.png`), fullPage: true });

        await previous().click();
        await page.getByText('first.png', { exact: true }).waitFor();
        await page.getByText('second.jpg', { exact: true }).waitFor();
        for (const [index, image] of original.entries()) {
          assert.equal(await page.getByAltText(`기존 사진 ${index + 1}`, { exact: true }).getAttribute('src'), image);
        }
        await previous().click();
        assert.equal(await page.getByLabel('자기소개', { exact: true }).inputValue(), draftIntro);
        await next().click(); await next().click();
        await save().waitFor();
        assert.equal(await page.evaluate(() => window.photoFormSubmissions.length), 1, 'only explicit Save requested so far');
        failSecond = false;
        if (scenario === 'network') await page.evaluate(() => { window.photoNetworkFixture.offline = false; });
        await save().click();
        await page.waitForFunction(() => window.fixtureRedirect === '/mypage');
        assert.deepEqual(counts, { first: 1, second: failedSecondRequests + 1 }, 'resume the unsaved slot only');
        if (scenario === 'network') assert.equal(await page.evaluate(() => window.photoNetworkFixture.calls), 3);
        assert.equal(saves.length, 1, 'exactly one PATCH after both photos are ready');
        assert.equal(saves[0].id, card.id);
        assert.equal(saves[0].intro_text, draftIntro);
        assert.deepEqual(saves[0].photo_paths, [serverPath('first'), serverPath('second')]);
        assert.equal('status' in saves[0], false, 'photo replacement cannot reopen a withdrawn profile');
        assert.equal('admin_tags' in saves[0], false, 'profile moderation state is not part of the edit payload');
        assert.equal(await page.evaluate(() => window.photoFormSubmissions.length), 2);
        if (scenario === 'network') await page.getByText(/프로필은 계속 내려간 상태이며/).waitFor();
        assert.deepEqual(uploads.filter(u => u.slot === 'second').map(u => u.size), Array(failedSecondRequests + 1).fill(uploads.at(-1).size));
        assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
        passed += 1;
      } finally { await context.close(); }
    }
    console.log(JSON.stringify({ checks: passed, widths: [360, 1280], productionRequests: 0, screenshots: output }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
