/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), path = require('node:path');
const { chromium } = require('./test-browser-runtime.cjs');
const { start } = require('./preview-voucher-profile-ux.cjs');
async function main() {
  const { server, origin, output } = await start(0);
  let browser, passed = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390, 768]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [], writes = [], outside = []; let reads = 0;
      page.on('pageerror', e => errors.push(e.message));
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) { outside.push(url.origin); return route.abort(); }
        if (url.pathname.startsWith('/api/')) {
          if (req.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
          reads++;
        }
        await route.continue();
      });
      try {
        await page.goto(origin + '/?view=vouchers&care=1');
        await page.getByText('보유 2장', { exact: true }).waitFor();
        const balance = page.locator('[data-care-vouchers]'), policy = page.locator('[data-care-policy]'), application = page.locator('[data-care-application]');
        await balance.getByText('추가 지급 교환권 2장 · 사용 전까지 유지', { exact: true }).waitFor();
        assert.equal(await policy.getAttribute('open'), null);
        assert.equal(await application.getAttribute('open'), null);
        assert.ok(await balance.evaluate(el => !!(el.compareDocumentPosition(document.querySelector('[data-care-policy]')) & Node.DOCUMENT_POSITION_FOLLOWING)));
        const select = page.getByLabel('추가 지급 교환권으로 교환할 상대', { exact: true });
        const options = await select.locator('option').allTextContents();
        assert.deepEqual(options, ['쌍방 수락한 상대 선택', '지윤', '서연']);
        const use = page.getByRole('button', { name: '이 매칭에 교환권 사용', exact: true });
        assert.equal(await use.isEnabled(), false);
        await select.selectOption('00000000-0000-4000-8000-000000000020');
        assert.equal(await use.isEnabled(), true);
        assert.equal(await page.getByRole('link', { name: '선택한 상대 프로필 확인' }).getAttribute('href'), '/community/dating/cards?tab=one_on_one&matchId=00000000-0000-4000-8000-000000000020#selected-one-on-one-match');
        const before = reads;
        await policy.locator('summary').click(); await policy.getByText(/교환 직후 무응답/).waitFor();
        await policy.locator('summary').click();
        await application.locator('summary').click();
        await page.getByLabel('연락 방법과 상황').fill('작성 중인 신청 내용이 접었다 펴도 유지되는지 확인합니다.');
        await application.locator('summary').click(); await application.locator('summary').click();
        assert.equal(await page.getByLabel('연락 방법과 상황').inputValue(), '작성 중인 신청 내용이 접었다 펴도 유지되는지 확인합니다.');
        // Allow the existing clock tick to re-render the panel.
        await page.waitForTimeout(1100);
        assert.equal(reads, before, 'nested summaries must not reload the outer panel');
        assert.equal(await page.locator('#contact-care').getAttribute('open'), '');
        await application.locator('summary').click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: path.join(output, `vouchers-${width}.png`), fullPage: true });
        await page.goto(origin + '/?view=apply&care=1');
        await page.getByLabel('내가 결제한 상대').waitFor();
        assert.equal(await page.locator('[data-care-application]').getAttribute('open'), '', 'without vouchers claim form stays discoverable');
        assert.equal(await page.getByRole('button', { name: '교환권 신청', exact: true }).isEnabled(), false, 'eligibility and evidence guards stay enabled');
        assert.equal(await page.locator('[data-care-vouchers]').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: path.join(output, `apply-${width}.png`), fullPage: true });
        for (const view of ['archived', 'held']) {
          await page.goto(origin + '/?view=' + view);
          await page.getByRole('region', { name: '내 프로필 상태' }).waitFor();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await page.screenshot({ path: path.join(output, `${view}-${width}.png`), fullPage: true });
        }
        assert.deepEqual(writes, []); assert.deepEqual(errors, []); assert.deepEqual(outside, []);
        passed++;
      } finally { await context.close(); }
    }
    console.log(JSON.stringify({ passed, widths: [320, 390, 768], productionRequests: 0, screenshots: output }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
