/* eslint-disable @typescript-eslint/no-require-imports */
// Render the real Home and My Page with the existing loopback-only member fixture.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('./test-browser-runtime.cjs');
const { start } = require('./preview-site-button-tone.cjs');

const home = '/community/dating/cards?tab=open_cards';
const supportUrl = 'https://open.kakao.com/o/s2gvTdhi';
const navigationRows = [
  { status: 'public', label: '받은 지원 보기', href: '/mypage?section=matching&match=received#open-card-received', marker: '#open-card-received h2' },
  { status: 'pending', label: '카드 관리', href: '/mypage?section=matching#my-open-card-status', marker: '#my-open-card-status summary' },
];
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const noOverflow = async page => {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
};

async function main() {
  const fixture = await start();
  let browser;
  let navigationChecks = 0, bannerChecks = 0, historyReads = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const errors = [], external = [], mutations = [];
      page.on('pageerror', error => errors.push(error.message));
      let cardStatus = 'public', ad = null, gate, creditCount = 5;

      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== fixture.origin) {
          external.push(url.origin);
          return route.abort();
        }
        if (gate && url.pathname.startsWith('/api/')) gate.paths.push(url.pathname);
        if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()) && !url.pathname.startsWith('/api/analytics/')) {
          mutations.push({ path: url.pathname, method: request.method() });
          return route.abort();
        }
        if (url.pathname === '/api/site/ad-inquiry') return route.fulfill({ json: ad ?? { enabled: false } });
        if (url.pathname === '/api/mypage/payments') {
          assert.equal(request.method(), 'GET');
          historyReads++;
          return route.fulfill({ json: {
            ok: true, summary: { creditsRemaining: creditCount, baseRemaining: 2, moreViewMale: 'none', moreViewFemale: 'none' },
            orders: [],
          } });
        }
        if (['/api/dating/cards/my', '/api/dating/cards/my/received'].includes(url.pathname)) {
          // Hold the actual async data request until the first render is complete.
          // The fragment anchor must still work after the target becomes visible.
          const pending = gate;
          if (pending && url.pathname === '/api/dating/cards/my/received') {
            pending.requested.resolve();
            await pending.ready.promise;
          }
          const response = await route.fetch();
          const body = await response.json();
          for (const card of body.items ?? body.cards ?? []) {
            Object.assign(card, { status: cardStatus, queue_position: 12345, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
          }
          return route.fulfill({ response, json: body });
        }
        return route.continue();
      });

      for (const row of navigationRows) {
        cardStatus = row.status;
        for (const entry of ['home', 'direct']) {
          // Return to another document even for direct URLs: navigating to the
          // browser's *current* fragment wouldn't trigger a new data load.
          await page.goto(fixture.origin + home);
          if (entry === 'home') {
            const link = page.getByRole('link', { name: row.label, exact: true });
            assert.equal(await link.getAttribute('href'), row.href);
            assert((await link.boundingBox()).height >= 44, 'home control remains touch-sized');
            await noOverflow(page);
          }
          gate = { requested: deferred(), ready: deferred(), paths: [] };
          const delayed = gate;
          try {
            if (entry === 'home') await page.getByRole('link', { name: row.label, exact: true }).click();
            else await page.goto(fixture.origin + row.href);
            await page.waitForURL(fixture.origin + row.href);
            await Promise.race([
              delayed.requested.promise,
              page.waitForTimeout(8_000).then(() => {
                throw Error(`Expected delayed My Page data request (${width}px/${entry}/${row.status}; ${delayed.paths.join(', ')})`);
              }),
            ]);
            // Keep the data out through the first paint. Pending management is
            // genuinely unavailable until the fixture supplies its first card.
            if (row.status === 'pending') assert.equal(await page.locator(row.marker).isVisible(), false);
          } finally {
            gate = null;
            delayed.ready.resolve();
          }
          await page.waitForFunction(selector => {
            const marker = document.querySelector(selector);
            if (!marker) return false;
            const box = marker.getBoundingClientRect();
            return window.scrollY > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight;
          }, row.marker);
          if (row.status === 'pending') assert.equal(await page.locator('#my-open-card-status').evaluate(el => el.open), true);
          await noOverflow(page);
          navigationChecks++;
        }
      }

      for (const title of ['1대1 매칭은 대기가 없어요!', '1:1 매칭은 대기가 없어요!']) {
        ad = { enabled: true, title, linkUrl: supportUrl };
        await page.goto(fixture.origin + home);
        const link = page.getByRole('link', { name: '1:1 매칭 보기', exact: true });
        assert.equal(await link.getAttribute('href'), '/community/dating/cards?tab=one_on_one');
        const help = page.locator(`a[href="${supportUrl}"]`).filter({ hasText: /문의/ });
        assert.equal(await help.count(), 1, 'provide a separate support link');
        await noOverflow(page);
        await link.click();
        await page.waitForFunction(() => new URL(location.href).searchParams.get('tab') === 'one_on_one');
        const toolbar = page.getByRole('region', { name: '매칭 서비스 선택' });
        assert.match(await toolbar.locator('button[aria-pressed=true]').innerText(), /1\s*(?:대|:)\s*1/);
        assert.equal(await link.count(), 0, 'open-card banner does not remain in the 1:1 tab');
        bannerChecks++;
      }
      ad = { enabled: true, title: '제휴 소식 보기', linkUrl: '/fixture-partnership' };
      await page.goto(fixture.origin + home);
      assert.equal(await page.getByRole('link', { name: /제휴 소식 보기/ }).getAttribute('href'), ad.linkUrl);
      assert.equal(await page.getByRole('link', { name: '1:1 매칭 보기', exact: true }).count(), 0);
      bannerChecks++;

      const historyStart = historyReads;
      await page.goto(fixture.origin + '/mypage?section=payment');
      await page.getByRole('button', { name: '결제센터 펼치기', exact: true }).click();
      const control = page.getByRole('button', { name: '결제 내역 새로고침', exact: true });
      const title = page.getByText('내 결제 내역', { exact: true });
      await control.waitFor();
      assert.equal(historyReads, historyStart + 1, 'payment tab initially only reads history');
      const box = await control.boundingBox();
      assert(box.height >= 44, 'payment refresh is touch-sized');
      assert(box.x >= 0 && box.x + box.width <= width + 1, 'button remains in viewport width');
      assert(box.y >= (await title.boundingBox()).y + (await title.boundingBox()).height, 'payment header stacks on narrow mobile');
      assert.equal(await control.evaluate(el => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()].filter(r => r.width > 0);
        return new Set(rects.map(r => Math.round(r.top))).size;
      }), 1, 'whole refresh label stays on one line');
      if (width === 320) await page.screenshot({ path: path.join(fixture.output, 'payment-history-320.png'), fullPage: true });
      creditCount = 6;
      await control.click();
      await page.getByText('6장', { exact: true }).waitFor();
      assert.equal(historyReads, historyStart + 2, 'only one history GET per explicit refresh');
      await noOverflow(page);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, [], 'no external requests');
      assert.deepEqual(mutations, [], 'no payment, contact or member mutation');
      await context.close();
    }
    console.log(JSON.stringify({ navigationChecks, bannerChecks, historyReads, realCharges: 0, widths: [320, 390], screenshots: fixture.output }));
  } finally {
    await browser?.close();
    await fixture.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
