/* eslint-disable @typescript-eslint/no-require-imports */
// Real home and offer, only local fixture APIs. No actual ordering or user data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { start } = require('./preview-site-button-tone.cjs');
const { chromium } = require('./test-browser-runtime.cjs');

const API = '/api/dating/love-pass';
const HOME = '/community/dating/cards?tab=open_cards';
const MATCH = '2f7bde57-2a5f-44f5-aa34-77eacc62c00c';

async function main() {
  const fixture = await start({ adapter: path.join(__dirname, 'fixtures/love-pass-placement-adapters.tsx') });
  let browser;
  const checks = [];
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        const problems = [];
        let mode = 'live', reads = 0;
        page.on('pageerror', error => problems.push(error.message));
        await context.route('**/*', async route => {
          const req = route.request();
          const url = new URL(req.url());
          if (url.origin !== fixture.origin || url.pathname.startsWith('/api/payments/') ||
              (url.pathname.startsWith('/api/') && req.method() !== 'GET' && !url.pathname.startsWith('/api/analytics/'))) {
            problems.push(req.method() + ' ' + url.pathname);
            return route.abort();
          }
          if (url.pathname === API) {
            reads++;
            assert.equal(url.search, '?availability=1');
            return route.fulfill({ status: mode === 'error' ? 503 : 200, json: { saleAvailable: mode === 'live' } });
          }
          if (url.pathname === '/api/dating/1on1/contact-home-notice') return route.fulfill({ json: { matchId: MATCH } });
          return route.continue();
        });

        const offer = page.getByRole('link', { name: '짐툴 연애 패스 혜택 보기', exact: true });
        const match = page.getByRole('region', { name: '서로 수락한 1:1 매칭 안내', exact: true });
        const tabs = page.getByRole('region', { name: '매칭 서비스 선택', exact: true });
        const loadOpenCards = async saleMode => {
          mode = saleMode;
          const responsePromise = page.waitForResponse(res => new URL(res.url()).pathname === API);
          await page.goto(fixture.origin + HOME);
          const response = await responsePromise;
          assert.equal(response.status(), saleMode === 'error' ? 503 : 200);
          await match.waitFor();
        };

        for (const unavailable of ['paused', 'error']) {
          await loadOpenCards(unavailable);
          assert.equal(await offer.count(), 0, unavailable + ' should not display a sales link');
        }

        await loadOpenCards('live');
        await offer.getByText('근처 대기 카드 먼저 보기', { exact: true }).waitFor();
        assert.equal(await offer.count(), 1);
        assert.equal(await offer.getAttribute('href'), '/dating/love-pass');
        const [tabBox, matchBox, offerBox] = await Promise.all([tabs.boundingBox(), match.boundingBox(), offer.boundingBox()]);
        assert.ok(tabBox.y < matchBox.y && matchBox.y + matchBox.height <= offerBox.y, 'priority notice stays between the tabs and the offer');
        assert.ok(offerBox.y + offerBox.height <= 844 && offerBox.height >= 44, 'first-screen touch target');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow');
        await offer.focus();
        assert.equal(await offer.evaluate(node => node === document.activeElement), true);

        const beforeOneOnOne = reads;
        await tabs.getByRole('button', { name: /1대1매칭/ }).click();
        await page.getByRole('button', { name: '매칭 요청 보내기', exact: true }).waitFor();
        assert.equal(await offer.count(), 0);
        assert.equal(reads, beforeOneOnOne, '1:1 tab does not fetch the pass');

        await tabs.getByRole('button', { name: /빠른매칭/ }).click();
        const quickLink = page.getByRole('link', { name: '짐툴 연애 패스', exact: true });
        await quickLink.waitFor();
        assert.equal(await quickLink.getAttribute('href'), '/dating/love-pass');
        assert.equal(await offer.count(), 0, 'only the existing small link remains in quick match');

        await tabs.getByRole('button', { name: /오픈카드/ }).click();
        await offer.waitFor();
        await offer.click();
        await page.waitForURL(fixture.origin + '/dating/love-pass');
        assert.deepEqual(problems, []);
        checks.push(width);
      } finally { await context.close(); }
    }
    assert.equal(fixture.writes.filter(write => !write.path.startsWith('/api/analytics/')).length, 0);
    console.log(JSON.stringify({ widths: checks, paymentRequests: 0, externalRequests: 0 }));
  } finally {
    await browser?.close();
    await fixture.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
