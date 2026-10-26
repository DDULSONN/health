const assert = require('node:assert/strict'), path = require('node:path');
const { chromium } = require('./test-browser-runtime.cjs');
const { start } = require('./preview-legacy-ux.cjs');
async function main() {
  const preview = await start(); let browser, passed = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390, 1280]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme }), page = await context.newPage(), errors = [], dialogs = [];
      page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { dialogs.push(d.message()); return d.dismiss(); });
      await context.route('**/*', route => new URL(route.request().url()).origin === preview.origin ? route.continue() : route.abort());
      preview.flags.creditsError = false; preview.flags.checkoutSuccess = false;
      await page.goto(preview.origin + '/dating/apply-credits?returnTo=%2Fcommunity%2Fdating%2Fcards%2F00000000-0000-4000-8000-000000000001%2Fapply');
      await page.getByText('5장', { exact: true }).waitFor(); assert.equal(await page.getByRole('link', { name: '이상형 더보기', exact: true }).count(), 0);
      const buy = page.getByRole('button', { name: '지원권 5장 구매', exact: true }); assert((await buy.boundingBox()).height >= 44);
      if (width === 390 && theme === 'light') await page.screenshot({ path: path.join(preview.output, 'credits-mobile.png'), fullPage: true });
      const count = preview.writes.filter(w => w.path === '/api/payments/toss/create').length;
      await buy.click(); await page.getByRole('alert').waitFor(); assert.equal(await buy.isEnabled(), true);
      const payments = preview.writes.filter(w => w.path === '/api/payments/toss/create'); assert.equal(payments.length, count + 1);
      assert.deepEqual(JSON.parse(payments.at(-1).body), { productType: 'apply_credits', returnTo: '/community/dating/cards/00000000-0000-4000-8000-000000000001/apply' });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width === 390 && theme === 'light') await page.screenshot({ path: path.join(preview.output, 'credits-error-mobile.png'), fullPage: true });
      preview.flags.creditsError = true; await page.reload(); await page.getByText('남은 지원권을 불러오지 못했어요. 다시 확인해 주세요.').waitFor();
      assert.equal(await page.locator('dd').allTextContents().then(x => x.join(',')), '—,—');
      preview.flags.creditsError = false; await page.getByRole('button', { name: '다시 확인' }).click(); await page.getByText('5장', { exact: true }).waitFor();
      preview.flags.checkoutSuccess = true; await buy.click(); await page.waitForURL('**/fixture-checkout'); preview.flags.checkoutSuccess = false;
      await page.goto(preview.origin + '/complete'); await page.getByRole('heading', { name: '지원이 완료됐어요' }).waitFor();
      assert(await page.getByRole('heading').evaluate(el => el === document.activeElement));
      assert.equal(await page.getByRole('link', { name: '내 지원 확인' }).getAttribute('href'), '/mypage?section=matching&match=applied#paid-card-applied');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width === 390 && theme === 'light') await page.screenshot({ path: path.join(preview.output, 'application-complete-mobile.png') });
      await page.goto(preview.origin + '/dating/paid/fixture-paid'); await page.getByRole('link', { name: '목록으로' }).waitFor();
      assert.equal(await page.getByRole('link', { name: '목록으로' }).getAttribute('href'), '/community/dating/cards?tab=open_cards');
      await page.goto(preview.origin + '/dating/paid/fixture-paid/apply'); await page.getByRole('link', { name: '뒤로가기' }).waitFor();
      assert.equal(await page.getByRole('link', { name: '뒤로가기' }).getAttribute('href'), '/dating/paid/fixture-paid');
      for (const legacy of [false, true]) {
        preview.flags.legacy = legacy; await page.goto(preview.origin + '/dating/more-view'); await page.getByText(legacy ? '남자 카드 · 이용 중' : '남자 카드 · 이용 중인 열람권 없음', { exact: true }).waitFor();
        assert.equal(await page.getByRole('link', { name: '지원하기', exact: true }).count(), legacy ? 1 : 0);
        assert.equal(await page.getByRole('button', { name: /구매|결제/ }).count(), 0);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      await page.goto(preview.origin + '/plans'); await page.getByRole('button', { name: /7일 먼저 써보기/ }).click(); await page.getByRole('alert').waitFor();
      assert.equal(await page.getByRole('button', { name: /7일 먼저 써보기/ }).isEnabled(), true);
      assert.deepEqual(dialogs, []); assert.deepEqual(errors, []); passed++; await context.close();
    }
    console.log(JSON.stringify({ passed, widths: [320,390,1280], themes: ['light','dark'], realPayments: 0, screenshots: preview.output }));
  } finally { if (browser) await browser.close(); await preview.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
