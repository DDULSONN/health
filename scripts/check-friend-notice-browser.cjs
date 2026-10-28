/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./preview-friend-recommendation.cjs');
const { chromium } = require('./test-browser-runtime.cjs');

(async () => {
  const server = await start();
  let browser;
  const errors = [], external = [];
  try {
    browser = await chromium.launch({ headless: true });
    for (const [width, height] of [[320, 568], [390, 844], [1280, 900]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === server.origin) return route.continue();
        external.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', e => errors.push(e.message));
      const writes = [];
      page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
      await page.goto(server.origin + '/notice');
      const dialog = page.getByRole('dialog', { name: '친구 추천 기능 안내' });
      await dialog.waitFor();
      assert.equal(await page.locator('dialog[open]').count(), 1);
      assert.match(await dialog.innerText(), /기본 ON/);
      assert.equal(await dialog.getByText('원치 않으면 설정에서 끌 수 있어요.', { exact: true }).isVisible(), true);
      assert.match(await dialog.innerText(), /최대 3명/);
      assert.match(await dialog.innerText(), /24시간/);
      assert.doesNotMatch(await dialog.innerText(), /\uFFFD/);
      assert.doesNotMatch(await dialog.innerText(), /NEW|잘 어울리겠다|!/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth), false);
      const box = await dialog.boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height);
      await page.screenshot({ path: path.join(server.output, `notice-${width}.png`), fullPage: true });
      assert.equal(await dialog.locator('details').getAttribute('open'), null);
      await page.getByText('공개 범위 안내', { exact: true }).click();
      assert.match(await dialog.innerText(), /가입·휴대폰 인증/);
      assert.match(await dialog.innerText(), /블러 처리된 사진·연령대·시도/);
      assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth), false);
      await page.screenshot({ path: path.join(server.output, `notice-expanded-${width}.png`), fullPage: true });
      await page.getByText('공개 범위 안내', { exact: true }).click();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      await page.getByRole('button', { name: '공지 다시보기' }).click();
      await page.getByRole('button', { name: '친구 추천 안내 닫기' }).click();
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal(await page.getByRole('button', { name: '공지 다시보기' }).evaluate(node => node === document.activeElement), true);
      await page.getByRole('button', { name: '공지 다시보기' }).click();
      await page.getByRole('button', { name: '설정 보기', exact: true }).click();
      await page.getByRole('switch').waitFor();
      await page.waitForFunction(() => document.querySelector('[role="switch"]')?.textContent === 'ON');
      assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), 'true');
      await page.goto(server.origin + '/notice');
      await page.getByRole('button', { name: '프로필 보기', exact: true }).click();
      await page.getByRole('button', { name: '친구에게 추천', exact: true }).click();
      await page.getByRole('button', { name: '추천 링크 만들기' }).waitFor();
      assert.deepEqual(writes, [], 'Viewing or dismissing notice must not write preferences, links or matches');
      await context.close();
      console.log(`PASS notice layout / Korean / Escape / close / focus / settings / explore ${width}x${height}`);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    // Production uses this same component; lifecycle coverage lives in the host suite.
    const host = fs.readFileSync(path.join(__dirname, '../components/PaymentMethodAnnouncement.tsx'), 'utf8');
    assert.match(host, /return <FriendRecommendationNotice/);
    assert.equal(server.fixture.state.matchCalls, 0);
    console.log(JSON.stringify({ viewports: 3, productionWrites: 0, externalRequests: 0, screenshots: server.output }));
  } finally { if (browser) await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
