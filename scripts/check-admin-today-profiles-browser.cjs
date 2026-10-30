/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), path = require('node:path');
const { startPreview } = require('./preview-admin-today-profiles.cjs');
const { chromium } = require('./test-browser-runtime.cjs');
(async () => {
  const fixture = await startPreview(); let browser, passed = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [360, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', route => { assert.equal(new URL(route.request().url()).origin, fixture.origin, 'No production traffic'); return route.continue(); });
      await page.goto(fixture.origin); await page.getByRole('button', { name: '오늘 신규 전체 보기', exact: true }).click();
      await page.getByText('2026-10-30 · 한국 시간 · 전체 23개', { exact: true }).waitFor();
      assert.equal(await page.getByRole('region', { name: '프로필 내용', exact: true }).count(), 20);
      assert.equal(await page.getByRole('button', { name: '일반 검수', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'AI 검수', exact: true }).count(), 0);
      const photo = page.getByRole('link', { name: '검수 사진 1 확대', exact: true }).first();
      assert.equal(await photo.getAttribute('target'), '_blank');
      await page.waitForFunction(() => [...document.querySelectorAll('img')].some(img => img.complete && img.naturalWidth > 0));
      await page.screenshot({ path: path.join(fixture.output, `today-profiles-${width}.png`), fullPage: false });
      await page.getByRole('button', { name: '✓ 정상 확인', exact: true }).first().click();
      await page.getByText('정상 확인 완료 (로컬)', { exact: true }).waitFor();
      assert.equal(await page.getByRole('region', { name: '프로필 내용', exact: true }).count(), 20, 'All view retains confirmed cards');
      assert.ok(await page.getByRole('button', { name: '정상 확인 취소', exact: true }).first().isVisible());
      await page.getByRole('button', { name: '오늘 목록 새로고침', exact: true }).click();
      await page.getByRole('button', { name: '정상 확인 취소', exact: true }).first().waitFor();
      await page.getByRole('button', { name: '정상 확인 취소', exact: true }).first().click();
      await page.getByText('정상 확인 취소 (로컬)', { exact: true }).waitFor();
      await page.getByRole('button', { name: '다음 20개', exact: true }).click();
      await page.getByText('2페이지', { exact: true }).waitFor();
      assert.equal(await page.getByRole('region', { name: '프로필 내용', exact: true }).count(), 3, 'No ever-growing DOM');
      assert.equal(await page.getByRole('button', { name: '다음 20개', exact: true }).isEnabled(), false);
      await page.getByRole('button', { name: '이전 20개', exact: true }).click();
      await page.getByText('1페이지', { exact: true }).waitFor();
      assert.equal(await page.getByRole('region', { name: '프로필 내용', exact: true }).count(), 20);
      await page.getByRole('combobox', { name: '검수 대상' }).selectOption('one_on_one');
      await page.getByText('2026-10-30 · 한국 시간 · 전체 2개', { exact: true }).waitFor();
      assert.equal(await page.getByRole('region', { name: '프로필 내용', exact: true }).count(), 2);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.route('**/api/admin/dating/card-ai-review?*', route => route.fulfill({ status: 500, json: { ok: false, message: '조회 실패 테스트' } }));
      await page.getByRole('button', { name: '오늘 목록 새로고침', exact: true }).click();
      await page.getByText('조회 실패 테스트', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '오늘 목록 새로고침', exact: true }).isEnabled(), true);
      await page.unroute('**/api/admin/dating/card-ai-review?*');
      await page.getByRole('button', { name: '오늘 목록 새로고침', exact: true }).click();
      await page.getByRole('region', { name: '프로필 내용', exact: true }).first().waitFor();
      assert.deepEqual(errors, []); passed++; await context.close();
    }
    assert.ok(fixture.calls.every(call => ['GET', 'PATCH'].includes(call.method)));
    console.log(JSON.stringify({ passed, screenshots: fixture.output, productionRequests: 0, realModerationActions: 0 }));
  } finally { await browser?.close(); await new Promise(resolve => fixture.server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
