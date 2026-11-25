/* eslint-disable @typescript-eslint/no-require-imports */
// Real home and offer, only local fixture APIs. No actual ordering or user data.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { start } = require('./preview-site-button-tone.cjs');

const API = '/api/dating/love-pass';
const HOME = '/community/dating/cards?tab=open_cards';
const QUICK = '/community/dating/cards?tab=quick_match';
const GUEST = '&fixture_auth=guest';
const MATCH = '2f7bde57-2a5f-44f5-aa34-77eacc62c00c';
const subscriptions = '/api/dating/cards/swipe/subscription';
const swipe = '/api/dating/cards/swipe';
const openCards = '/api/dating/cards/list';
const started = () => start({
  entry: path.join(__dirname, 'fixtures/love-pass-placement-home.tsx'),
  adapter: path.join(__dirname, 'fixtures/love-pass-placement-adapters.tsx'),
});
const candidate = { card_id: 'local-quick-card', user_id: 'fixture-peer', sex: 'male',
  display_nickname: '빠른매칭 가상 후보', age: 30, region: '서울', height_cm: 178, job: '회사원',
  source_status: 'public', photo_visibility: 'blur', image_url: null };
function swipePayload(guest = false, active = false) {
  return { loggedIn: !guest, canSwipe: !guest, remaining: guest ? 0 : 5, limit: active ? 50 : 5,
    unlimitedPass: active, candidate, reason: null };
}
const subscriptionPayload = (active = false) => ({ status: 'none', lovePassActive: active, baseLimit: 5, premiumLimit: 30 });
const guestOpenCards = { items: [], hasMore: false, audience: {
  status: 'guest', viewerSex: null, targetSex: 'male', canSwitchSex: true, requiresSexSelection: false,
} };

async function main() {
  const { chromium } = require('./test-browser-runtime.cjs');
  const fixture = await started();
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-guest-pass-review-'));
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
        let mode = 'live', reads = 0, activePass = false;
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
          if (url.pathname === subscriptions) return route.fulfill({ json: subscriptionPayload(activePass) });
          if (url.pathname === swipe) return route.fulfill({ json: swipePayload(false, activePass) });
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
        const plus = page.getByRole('button', { name: '빠른매칭 플러스', exact: true });
        await plus.click();
        const plusDialog = page.getByRole('dialog').filter({ hasText: '빠른매칭 플러스' });
        await plusDialog.waitFor();
        assert.ok(await plusDialog.getByRole('button', { name: /빠른매칭 플러스 30일/ }).isEnabled());
        await plusDialog.getByRole('button', { name: '빠른매칭 플러스 안내 닫기' }).click();
        assert.equal(await plusDialog.count(), 0);

        await tabs.getByRole('button', { name: /오픈카드/ }).click();
        await offer.waitFor();
        await offer.click();
        await page.waitForURL(fixture.origin + '/dating/love-pass');

        activePass = true;
        await page.goto(fixture.origin + QUICK);
        await page.getByRole('link', { name: '연애 패스 이용 중', exact: true }).waitFor();
        assert.equal(await plus.count(), 0, 'do not upsell Plus to an active Love Pass member');
        assert.deepEqual(problems, []);
        checks.push({ width, session: 'member' });
      } finally { await context.close(); }

      const guest = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
      try {
        const page = await guest.newPage();
        page.setDefaultTimeout(10_000);
        const forbidden = [], errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await guest.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url());
          if (url.origin !== fixture.origin || url.pathname.startsWith('/api/payments/') ||
            (url.pathname.startsWith('/api/') && req.method() !== 'GET' && !url.pathname.startsWith('/api/analytics/'))) {
            forbidden.push(req.method() + ' ' + url.pathname); return route.abort();
          }
          if (url.pathname === API || url.pathname === subscriptions) {
            forbidden.push(req.method() + ' ' + url.pathname); return route.fulfill({ json: { saleAvailable: true } });
          }
          if (url.pathname === swipe) return route.fulfill({ json: swipePayload(true) });
          if (url.pathname === openCards) return route.fulfill({ json: guestOpenCards });
          return route.continue();
        });
        const offer = page.getByRole('link', { name: /연애 패스/ });
        const plus = page.getByRole('button', { name: /빠른매칭 플러스/ });
        await page.goto(fixture.origin + HOME + GUEST);
        await page.getByRole('link', { name: '가입하고 내 소개 쓰기', exact: true }).waitFor();
        assert.equal(await offer.count(), 0, 'guest cannot see paid offers on Open Cards');
        if (width === 390) await page.screenshot({ path: path.join(screenshots, 'guest-open-card.png') });

        for (const entry of ['tab-change', 'direct-url']) {
          if (entry === 'tab-change') {
            await page.getByRole('region', { name: '매칭 서비스 선택' }).getByRole('button', { name: /빠른매칭/ }).click();
          } else {
            await page.goto(fixture.origin + QUICK + GUEST);
          }
          await page.getByRole('link', { name: '로그인하고 보기', exact: true }).waitFor();
          await page.getByRole('link', { name: '로그인하고 라이크', exact: true }).waitFor();
          assert.equal(await offer.count(), 0, 'guest cannot see Love Pass on Quick Match');
          assert.equal(await plus.count(), 0, 'guest cannot open Quick Plus');
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        }
        if (width === 390) await page.screenshot({ path: path.join(screenshots, 'guest-quick-match.png') });
        assert.deepEqual(forbidden, [], 'guest makes no offer availability, subscription, or checkout requests');
        assert.deepEqual(errors, []);
        checks.push({ width, session: 'guest' });
      } finally { await guest.close(); }
    }
    assert.equal(fixture.writes.filter(write => !write.path.startsWith('/api/analytics/')).length, 0);
    console.log(JSON.stringify({ checks, screenshots, paymentRequests: 0, externalRequests: 0 }));
  } finally {
    await browser?.close();
    await fixture.close();
  }
}
async function preview() {
  const fixture = await started();
  // The shared preview server only supplies mock data. Supply this fixture's
  // offer and quick-match responses here as well when no Playwright is attached.
  const original = fixture.server.listeners('request')[0];
  fixture.server.removeListener('request', original);
  fixture.server.on('request', (req, res) => {
    const url = new URL(req.url, fixture.origin);
    if (req.method !== 'GET') {
      res.statusCode = 405; return res.end('이 화면은 확인 전용이에요.');
    }
    if (req.headers.host === new URL(fixture.origin).host) {
      const entry = new URL(req.headers.referer || url, fixture.origin);
      const guest = entry.searchParams.get('fixture_auth') === 'guest';
      const body = url.pathname === API ? { saleAvailable: true }
        : url.pathname === subscriptions ? subscriptionPayload()
        : url.pathname === swipe ? swipePayload(guest)
        : guest && url.pathname === openCards ? guestOpenCards : null;
      if (body) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.end(JSON.stringify(body));
      }
    }
    return original(req, res);
  });
  console.log(JSON.stringify({ guestOpenCard: fixture.origin + HOME + GUEST, guestQuickMatch: fixture.origin + QUICK + GUEST,
    memberOpenCard: fixture.origin + HOME, memberQuickMatch: fixture.origin + QUICK }));
}

(process.argv.includes('--preview') ? preview : main)().catch(error => { console.error(error); process.exitCode = 1; });
