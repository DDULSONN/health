/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), path = require('node:path');
const { chromium } = require('./test-browser-runtime.cjs');
const { start } = require('./preview-site-button-tone.cjs');
async function main() {
  const preview = await start(); let browser, passed = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390, 1280]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme }), page = await context.newPage(), errors = [];
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.dismiss());
      await context.route('**/*', route => new URL(route.request().url()).origin === preview.origin ? route.continue() : route.abort());
      preview.flags.archived = false;
      await page.goto(preview.origin + '/mypage?section=matching');
      const section = page.locator('#one-on-one-status');
      await section.getByRole('button', { name: '프로필 내리기', exact: true }).waitFor();
      const edit = section.getByRole('link', { name: '신청서 수정', exact: true });
      assert.equal(await edit.getAttribute('href'), '/dating/1on1?editId=fixture-one');
      assert((await edit.boundingBox()).height >= 44);
      await page.getByRole('button', { name: '카드 관리', exact: true }).click();
      const open = page.locator('#my-open-card-status');
      await open.getByRole('button', { name: '대기열에 다시 등록', exact: true }).waitFor();
      for (const label of ['대기열에 다시 등록', '5,000원 대기없이 다시 노출', '삭제']) {
        const box = await open.getByRole('button', { name: label, exact: true }).boundingBox();
        assert(box.height >= 44, label + ' touch height');
        assert(box.x >= 0 && box.x + box.width <= width + 1, label + ' within viewport');
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      await edit.focus(); await page.keyboard.press('Tab');
      const archive = section.getByRole('button', { name: '프로필 내리기', exact: true });
      assert(await archive.evaluate(el => el === document.activeElement));
      assert.equal(await archive.evaluate(el => getComputedStyle(el).outlineStyle), 'auto', 'Unchanged archive retains native keyboard focus');
      if (width === 390 && theme === 'light') {
        await open.screenshot({ path: path.join(preview.output, 'open-card-buttons-mobile.png') });
        await page.locator('#open-card-received').screenshot({ path: path.join(preview.output, 'received-buttons-mobile.png') });
      }
      const before = preview.writes.filter(w => w.method === 'DELETE').length;
      await archive.click();
      assert.equal(preview.writes.filter(w => w.method === 'DELETE').length, before, 'First press remains confirmation only');
      await section.getByRole('button', { name: '한 번 더 눌러 내리기', exact: true }).click();
      await section.getByRole('button', { name: '프로필 다시 올리기', exact: true }).waitFor();
      assert.equal(preview.writes.filter(w => w.method === 'DELETE').length, before + 1);
      assert(await section.getByText('010-0000-0000', { exact: true }).isVisible(), 'Existing contact remains rendered after lowering');
      assert.equal(await section.getByRole('button', { name: '삭제', exact: true }).count(), 0, 'Open match still prevents list deletion');
      await page.goto(preview.origin + '/mypage?section=settings');
      await page.getByRole('button', { name: '문의 펼치기', exact: true }).click();
      const support = page.getByRole('button', { name: '문의 접수하기', exact: true });
      await support.waitFor(); assert((await support.boundingBox()).height >= 44);
      assert.equal(await support.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(240, 0, 61)');
      await page.getByRole('button', { name: '문의 접기', exact: true }).click();
      assert.equal(await support.count(), 0);
      await page.goto(preview.origin + '/plans');
      const plan = page.getByRole('button', { name: /7일 먼저 써보기/ });
      await plan.waitFor(); assert((await plan.boundingBox()).height >= 44);
      const beforePayment = preview.writes.filter(w => w.path === '/api/payments/toss/create').length;
      await plan.click(); await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('7일 먼저 써보기') && !b.disabled));
      const payments = preview.writes.filter(w => w.path === '/api/payments/toss/create');
      assert.equal(payments.length, beforePayment + 1);
      assert.deepEqual(JSON.parse(payments.at(-1).body), { productType: 'one_on_one_plus_7d', cardId: 'fixture-one', offerPlacement: 'local_tone_preview' });
      assert.equal(await plan.isEnabled(), true, 'Checkout error must restore the existing button');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width === 390 && theme === 'light') await page.screenshot({ path: path.join(preview.output, 'plus-buttons-mobile.png') });
      assert.deepEqual(errors, []);
      await context.close(); passed++;
    }
    console.log(JSON.stringify({ passed, widths: [320, 390, 1280], themes: ['light', 'dark'], ui: 'actual member pages/components', requests: 'local synthetic API only', realPayments: 0, screenshots: preview.output }));
  } finally { if (browser) await browser.close(); await preview.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
