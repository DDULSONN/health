/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startPreview } = require('./preview-profile-writing.cjs');
const { chromium } = require('./test-browser-runtime.cjs');

const cardId = '12345678-1234-4567-8912-123456789abc';
const history = '/mypage?section=matching&match=applied#open-card-applied';
const card = { id: cardId, display_nickname: '테스트 카드', image_urls: [] };
const photoPath = index => `card-applications/fixture-member/${cardId}/photo-${index}.jpg`;
const previous = { id: 'fixture-previous', age: 25, height_cm: 175, region: '서울', job: '회사원', training_years: 0,
  intro_text: '이전 소개글이에요.', instagram_id: 'fixture', photo_paths: ['previous-a.jpg', 'previous-b.jpg'], created_at: new Date().toISOString() };
const intro = '지원이 끊겨도 남겨야 하는 새 소개글이에요.';
const small = fs.readFileSync(path.join(__dirname, '../public/mascot/jimnyang-guide-v2.png'));
const large = Buffer.alloc(5 * 1024 * 1024); small.copy(large);
const scenarios = [[360, 'slot-network'], [1280, 'slot-network'], [360, 'slot-413'], [360, 'final-network'], [360, 'final-malformed'], [360, 'final-503']];

async function main() {
  const { server, origin } = await startPreview(0, 'open-card-apply-browser.tsx');
  let browser, checks = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const [width, scenario] of scenarios) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [], unexpected = [], uploads = [], submissions = [];
      let failSlot = scenario === 'slot-413';
      page.setDefaultTimeout(15_000);
      page.on('pageerror', error => errors.push(error.message));
      await context.addInitScript(scenario => {
        const realFetch = window.fetch;
        const realRead = File.prototype.arrayBuffer;
        window.applyFixture = { slotNetwork: scenario === 'slot-network', uploadedSlots: [], finalCalls: 0, snapshotReads: [] };
        File.prototype.arrayBuffer = function () {
          if (/^(first|second|unreadable)\.png$/.test(this.name)) {
            const current = [...document.querySelectorAll('input[type=file]')].some(input => input.files?.[0] === this);
            window.applyFixture.snapshotReads.push({ name: this.name, current });
          }
          if (this.name === 'unreadable.png') return Promise.reject(new DOMException('Fixture picker failed', 'NotReadableError'));
          return realRead.call(this);
        };
        window.fetch = function (input, init) {
          if (input === '/api/dating/cards/upload' && init?.body instanceof FormData) {
            const slot = Number(init.body.get('index'));
            window.applyFixture.uploadedSlots.push(slot);
            // Reject at the fetch boundary so engine-specific HTTP retries do not mask client behavior.
            if (window.applyFixture.slotNetwork && slot === 1) return Promise.reject(new TypeError('Fixture connection failed'));
          }
          if (input === '/api/dating/cards/apply' && init?.method === 'POST') {
            window.applyFixture.finalCalls += 1;
            if (scenario === 'final-network') return Promise.reject(new TypeError('Fixture final response lost'));
          }
          return realFetch.call(this, input, init);
        };
      }, scenario);

      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) { unexpected.push(`Non-local request: ${url.origin}`); return route.abort(); }
        if (req.method() === 'GET') {
          if (url.pathname === `/api/dating/cards/${cardId}`) return route.fulfill({ json: { card } });
          if (url.pathname === '/api/dating/cards/my/applied/latest') return route.fulfill({ json: { item: previous } });
          return route.continue();
        }
        if (req.method() === 'POST' && url.pathname === '/api/dating/cards/upload') {
          const body = req.postDataBuffer();
          assert.ok(body.length < 4_500_000, 'prepared multipart body stays within the production ceiling');
          const form = await new Response(body, { headers: { 'content-type': req.headers()['content-type'] } }).formData();
          const slot = Number(form.get('index'));
          const file = form.get('file');
          assert.ok(slot === 0 || slot === 1);
          assert.equal(form.get('cardId'), cardId);
          assert.ok(file instanceof File && file.size <= 3 * 1024 * 1024);
          assert.equal(file.name, slot === 0 ? 'first.png' : 'second.jpg');
          assert.equal(file.type, slot === 0 ? 'image/png' : 'image/jpeg');
          uploads.push(slot);
          if (slot === 1 && failSlot) return route.fulfill({ status: 413, contentType: 'text/plain', body: 'FUNCTION_PAYLOAD_TOO_LARGE' });
          return route.fulfill({ status: 201, json: { path: photoPath(slot) } });
        }
        if (req.method() === 'POST' && url.pathname === '/api/dating/cards/apply') {
          submissions.push(req.postDataJSON());
          if (scenario === 'final-malformed') return route.fulfill({ status: 200, contentType: 'text/plain', body: 'No receipt' });
          if (scenario === 'final-503') return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unknown outcome' });
          return route.fulfill({ status: 200, json: { ok: true, id: 'fixture-application' } });
        }
        unexpected.push(`${req.method()} ${url.pathname}`);
        return route.abort();
      });

      try {
        await page.goto(`${origin}/community/dating/cards/${cardId}/apply`);
        await page.getByRole('heading', { name: '오픈카드 지원하기', exact: true }).waitFor();
        await page.getByText('마지막 지원 내용을 불러왔어요', { exact: true }).waitFor();
        await page.locator('textarea').fill(intro);
        const inputs = page.locator('input[type="file"]');
        assert.equal(await inputs.count(), 2);
        await inputs.nth(0).setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: small });
        await inputs.nth(1).setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: large });
        await page.getByText(/first\.png/).waitFor();
        await page.getByText(/second\.jpg/).waitFor();
        const getFixture = () => page.evaluate(() => window.applyFixture);
        assert.deepEqual((await getFixture()).snapshotReads, [{ name: 'first.png', current: true }, { name: 'second.png', current: true }], 'read picker file bytes before resetting either input');
        if (scenario === 'slot-network' && width === 360) {
          await inputs.nth(1).setInputFiles({ name: 'unreadable.png', mimeType: 'image/png', buffer: small });
          await page.getByText(/사진 2: 선택한 사진을 읽지 못했어요/).waitFor();
          assert.ok(await page.getByText(/second\.jpg/).isVisible(), 'a bad replacement must not discard the selected photo');
          await inputs.nth(1).setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: large });
          await page.getByText(/사진 2: 선택한 사진을 읽지 못했어요/).waitFor({ state: 'hidden' });
        }
        assert.deepEqual((await getFixture()).uploadedSlots, [], 'selecting a photo does not submit');
        const submit = page.getByRole('button', { name: '지원하기', exact: true });
        await submit.click();
        if (scenario.startsWith('slot-')) {
          const message = page.getByText(/지원 사진 2\s*[:·]/);
          await message.waitFor();
          assert.match(await message.innerText(), scenario === 'slot-network' ? /연결|업로드/ : /용량|크/);
          const fixture = await getFixture();
          assert.deepEqual(fixture.uploadedSlots, scenario === 'slot-network' ? [0, 1, 1] : [0, 1]);
          assert.equal(fixture.finalCalls, 0, 'a partial upload must not consume a support token');
          assert.deepEqual(submissions, []);
          assert.equal(await page.locator('textarea').inputValue(), intro);
          assert.ok(await page.getByText(/first\.png/).isVisible());
          assert.ok(await page.getByText(/second\.jpg/).isVisible());
          assert.ok(await page.getByRole('checkbox').isChecked());
          failSlot = false;
          await page.evaluate(() => { window.applyFixture.slotNetwork = false; });
          await submit.click();
          await page.getByRole('heading', { name: '지원이 완료됐어요' }).waitFor();
          assert.deepEqual(uploads, scenario === 'slot-network' ? [0, 1] : [0, 1, 1], 'already saved first photo is not uploaded again');
          assert.equal((await getFixture()).finalCalls, 1);
          assert.equal(submissions.length, 1);
          assert.deepEqual(submissions[0].photo_paths, [photoPath(0), photoPath(1)]);
          assert.equal(submissions[0].intro_text, intro);
          assert.equal(submissions[0].consent, true);
        } else {
          await page.getByText(/지원 결과를 확인하지 못했어요\./).waitFor();
          assert.equal(await page.getByRole('link', { name: /내 지원 (내역 )?확인/ }).getAttribute('href'), history);
          assert.deepEqual(uploads, [0, 1]);
          assert.equal((await getFixture()).finalCalls, 1, 'never replay a potentially completed final write');
          assert.equal(submissions.length, scenario === 'final-network' ? 0 : 1);
          assert.equal(await page.locator('textarea').inputValue(), intro);
          assert.equal(await page.getByRole('heading', { name: '지원이 완료됐어요' }).count(), 0);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.deepEqual(unexpected, []);
        assert.deepEqual(errors, []);
        checks += 1;
      } finally { await context.close(); }
    }
    console.log(JSON.stringify({ checks, viewports: [360, 1280], productionRequests: 0 }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
