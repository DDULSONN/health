/* eslint-disable @typescript-eslint/no-require-imports */
// Actual home page and matching panel, with loopback-only member data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('./test-browser-runtime.cjs');
const { start } = require('./preview-site-button-tone.cjs');

const HOME = '/community/dating/cards?tab=open_cards';
const NOTICE_API = '/api/dating/1on1/contact-home-notice';
const MATCHES_API = '/api/dating/1on1/matches/my';
const MATCH = '2f7bde57-2a5f-44f5-aa34-77eacc62c00c';
const NEW_MATCH = '7825b703-6cb3-478e-872a-c332ebc59493';
const doubleFrame = (page) => page.evaluate(() => new Promise(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function main() {
  const fixture = await start();
  let browser;
  const completed = [];
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await ctx.newPage();
      page.setDefaultTimeout(8_000);
      const problems = [];
      let mode = 'eligible', currentMatch = MATCH, noticeReads = 0, fullMatchReads = 0;
      page.on('pageerror', error => problems.push(error.message));

      await ctx.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== fixture.origin) {
          problems.push('External request: ' + url.origin);
          return route.abort();
        }
        if (url.pathname.startsWith('/api/payments/') ||
            (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()) &&
              !url.pathname.startsWith('/api/analytics/'))) {
          problems.push('Unexpected action: ' + request.method() + ' ' + url.pathname);
          return route.abort();
        }
        if (url.pathname === NOTICE_API) {
          assert.equal(request.method(), 'GET');
          assert.equal(url.search, '');
          noticeReads++;
          const result = { matchId: mode === 'eligible' ? currentMatch
            : mode === 'invalid' ? 'https://example.invalid/invalid' : null };
          return route.fulfill({ json: result, status: mode === 'error' ? 503 : 200 });
        }
        if (url.pathname === MATCHES_API) {
          fullMatchReads++;
          const res = await route.fetch();
          const { items } = await res.json();
          const match = { ...items[0], id: currentMatch, counterparty_phone: null,
            contact_exchange_status: 'awaiting_applicant_payment' };
          return route.fulfill({ json: { items: [match] } });
        }
        return route.continue();
      });

      const notice = page.getByRole('region', { name: '서로 수락한 1:1 매칭 안내', exact: true });
      const inspectHome = async (kind, match = MATCH) => {
        mode = kind;
        currentMatch = match;
        const read = page.waitForResponse(res => new URL(res.url()).pathname === NOTICE_API);
        if (page.url() === fixture.origin + HOME) await page.reload();
        else await page.goto(fixture.origin + HOME);
        const response = await read;
        assert.equal(response.status(), kind === 'error' ? 503 : 200);
        await doubleFrame(page);
      };

      for (const kind of ['ineligible', 'error', 'invalid']) {
        await inspectHome(kind);
        assert.equal(await notice.count(), 0, `${kind} must not show an invite`);
      }
      await inspectHome('eligible');
      await notice.waitFor();
      assert.equal(fullMatchReads, 0, 'home never loads the full match inbox for an invite');
      const link = notice.getByRole('link', { name: '매칭 확인', exact: true });
      const dismiss = notice.getByRole('button', { name: '안내 닫기', exact: true });
      assert((await link.boundingBox()).height >= 44);
      assert((await dismiss.boundingBox()).height >= 44);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (width === 320) await notice.screenshot({ path: path.join(fixture.output, 'contact-home-notice-320.png') });
      await dismiss.click();
      await notice.waitFor({ state: 'hidden' });

      await inspectHome('eligible');
      assert.equal(await notice.count(), 0, 'dismissal persists after reload for this match');
      await inspectHome('eligible', NEW_MATCH);
      await notice.waitFor();
      const href = `/community/dating/cards?tab=one_on_one&matchId=${NEW_MATCH}#selected-one-on-one-match`;
      assert.equal(await link.getAttribute('href'), href);
      await link.click();
      await page.waitForURL(fixture.origin + href);
      const selected = page.locator('#selected-one-on-one-match');
      await selected.getByText('서로 수락 완료', { exact: true }).waitFor();
      await page.waitForFunction(() => document.activeElement?.id === 'selected-one-on-one-match');
      assert.equal(await notice.count(), 0, 'no duplicate home invite above the focused match');
      assert.equal(fullMatchReads, 1);
      assert.equal(noticeReads, 6, 'one light read per eligible-home visit, none at checkout destination');
      assert.deepEqual(problems, []);
      completed.push(width);
      await ctx.close();
    }
    assert(!fixture.writes.some(write => !write.path.startsWith('/api/analytics/')));
    console.log(JSON.stringify({ widths: completed, noticeReads: 12, openedMatches: 2, payments: 0, externalRequests: 0, screenshot: path.join(fixture.output, 'contact-home-notice-320.png') }));
  } finally {
    await browser?.close();
    await fixture.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
