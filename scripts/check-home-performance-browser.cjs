/* eslint-disable @typescript-eslint/no-require-imports */
// Real home + real lazy chunk, local fixture API only. Every external request is blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const webpack = require('webpack');
const { chromium } = require('./test-browser-runtime.cjs');
const root = path.resolve(__dirname, '..');
async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-home-perf-browser-'));
  const adapter = path.join(__dirname, 'fixtures/recommendation-refresh-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false,
      entry: path.join(__dirname, 'fixtures/home-performance-browser.tsx'),
      output: { path: output, filename: 'fixture.js', chunkFilename: '[name].chunk.js', publicPath: '/' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], fallback: { crypto: false }, alias: {
        'next/link': adapter, 'next/image': adapter, 'next/navigation': adapter,
        '@/lib/supabase/client': adapter, '@/components/DatingAdultNotice': adapter, '@': root,
      } },
      plugins: [new webpack.DefinePlugin({ 'process.env.NEXT_PUBLIC_OPENKAKAO_URL': 'undefined' })],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: {
        loader: path.join(__dirname, 'fixtures/mypage-navigation-loader.cjs'), options: { preserveHomeLazy: true },
      } }] },
    });
    compiler.run((error, stats) => { compiler.close(() => {});
      if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true }))); else resolve();
    });
  });
  const cssRoot = process.env.PROFILE_UX_CSS_DIR || path.join(root, '.next/static/css');
  const css = fs.readdirSync(cssRoot).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssRoot, f), 'utf8')).join('\n');
  const server = http.createServer((req, res) => {
    const filename = new URL(req.url, 'http://fixture.invalid').pathname.slice(1);
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    if (/^[A-Za-z0-9_.-]+\.js$/.test(filename) && fs.existsSync(path.join(output, filename))) {
      res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, filename)));
    } else if (filename === 'fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else if (filename === 'fixture-photo.png') { res.setHeader('Content-Type', 'image/png'); res.end(fs.readFileSync(path.join(root, 'public/icon-192x192.png'))); }
    else if (filename.startsWith('api/')) { res.writeHead(500); res.end('Unmocked API'); }
    else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser, passed = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390, 1280]) for (const firstTab of ['open_cards', 'one_on_one', 'quick_match']) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      const calls = [], chunks = [], errors = []; let blocked = 0, mutations = 0;
      const card = { id: 'fixture-one', name: '검증회원', user_id: 'fixture-member', status: 'approved', sex: 'female', age: 29, birth_year: 1998,
        region: '서울', height_cm: 165, job: '회사원', intro_text: '로컬 확인용 프로필이에요.', strengths_text: '배려해요.', preferred_partner_text: '편안한 대화', photo_signed_urls: ['/fixture-photo.png', '/fixture-photo.png'] };
      const audience = { status: 'resolved', viewerSex: 'female', targetSex: 'male', source: 'one_on_one', canSwitchSex: false, requiresSexSelection: false };
      const paidCard = { id: 'paid-fixture', nickname: '유료공개검증', gender: 'M', age: 30, region: '서울', height_cm: 180, job: '회사원',
        thumbUrl: '/fixture-photo.png', photo_visibility: 'public', image_urls: ['/fixture-photo.png'], expires_at: '2099-01-01T00:00:00Z', display_mode: 'instant_public', created_at: '2026-01-01T00:00:00Z' };
      page.on('pageerror', e => errors.push(e.message));
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) { blocked++; await route.abort(); return; }
        if (url.pathname.endsWith('.chunk.js')) chunks.push(url.pathname);
        if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
        calls.push(url.pathname + url.search);
        if (req.method() !== 'GET') { if (!url.pathname.startsWith('/api/analytics/')) mutations++; await route.fulfill({ json: { ok: true } }); return; }
        let body = { ok: true, items: [], cards: [], loggedIn: true };
        switch (url.pathname) {
          case '/api/admin/me': body = { isAdmin: false }; break;
          case '/api/mypage/summary': body = { profile: { phone_verified: true }, account: { is_banned: false } }; break;
          case '/api/dating/cards/list': body = { items: [], hasMore: false, audience }; break;
          case '/api/dating/cards/my': body = { items: [{ id: 'open-fixture', status: 'pending', sex: 'female', display_nickname: '검증회원' }] }; break;
          case '/api/dating/1on1/write-status': body = { canWrite: false, phoneVerified: true, activeRequestStatus: 'approved' }; break;
          case '/api/dating/1on1/my': body = { items: [card], plus: { expires_at: '2099-01-01T00:00:00Z', contact_exchange_included: false } }; break;
          case '/api/dating/1on1/recommendations/my': body = { items: [{ source_card_id: card.id, source_card_status: 'approved', refresh_limit: 2, refresh_remaining: 2,
            refresh_used_count: 0, can_refresh: true, recommendations: [{ ...card, id: 'candidate', name: '추천상대', sex: 'male' }], admin_recommendations: [] }] }; break;
          case '/api/dating/cards/queue-stats': body = { male: { public_count: 0, pending_count: 0, slot_limit: 45 }, female: { public_count: 0, pending_count: 0, slot_limit: 45 } }; break;
          case '/api/dating/cards/more-view/status': body = { loggedIn: true, male: 'none', female: 'none' }; break;
          case '/api/dating/paid/list': assert.equal(url.searchParams.get('sex'), 'male'); body = { items: [paidCard] }; break;
          case '/api/dating/cards/swipe': assert.equal(url.searchParams.get('sex'), 'male'); body = { loggedIn: true, canSwipe: true, remaining: 7, limit: 7, candidate: null, reason: null }; break;
          case '/api/dating/cards/swipe/subscription': body = { status: 'none', dailyLimit: 7, baseLimit: 7, premiumLimit: 20, priceKrw: 9900, durationDays: 7 }; break;
          case '/api/dating/all-pass-offer': body = { available: false }; break;
          case '/api/site/ad-inquiry': body = { enabled: false }; break;
        }
        await route.fulfill({ json: body });
      });
      const count = prefix => calls.filter(url => url.startsWith(prefix)).length;
      const tabButton = name => page.getByRole('button', { name, exact: false }).first();
      try {
        await page.goto(origin + '/community/dating/cards?tab=' + firstTab);
        await page.waitForFunction(() => document.body.innerText.includes('남자 카드 보기') || document.body.innerText.includes('빠른 매칭'));
        await page.waitForTimeout(350);
        const initialListReads = count('/api/dating/cards/list');
        if (firstTab !== 'open_cards') for (const endpoint of ['/api/dating/paid/list', '/api/dating/cards/queue-stats', '/api/dating/cards/more-view/status', '/api/dating/reels/listings']) assert.equal(count(endpoint), 0, firstTab + ' unexpected ' + endpoint);
        if (firstTab !== 'quick_match') assert.equal(count('/api/dating/cards/swipe'), 0);
        if (firstTab !== 'one_on_one') { assert.equal(count('/api/dating/1on1/recommendations/my'), 0); assert.equal(chunks.length, 0, 'hidden 1:1 chunk loaded'); }
        await tabButton('1대1매칭').click();
        await page.getByRole('button', { name: '매칭 요청 보내기', exact: true }).waitFor();
        assert.ok(chunks.some(name => name.includes('OneOnOneHomePanel')));
        const before = calls.length;
        await page.clock.install(); await page.clock.fastForward(6 * 60 * 1000); await page.waitForTimeout(150);
        assert.ok(!calls.slice(before).some(url => /\/paid\/list|\/queue-stats|\/more-view\/|\/cards\/swipe|\/reels\/listings/.test(url)), 'inactive tab polled');
        await page.clock.resume();
        await tabButton('오픈카드').click();
        await page.getByText('유료공개검증', { exact: true }).waitFor();
        assert.ok(count('/api/dating/paid/list') > 0); assert.ok(count('/api/dating/reels/listings') > 0);
        const paidBefore = count('/api/dating/paid/list');
        await tabButton('빠른매칭').click(); await page.waitForTimeout(350);
        assert.ok(count('/api/dating/cards/swipe?') > 0); assert.ok(count('/api/dating/cards/swipe/subscription') > 0);
        await tabButton('1대1매칭').click(); await page.getByRole('button', { name: '매칭 요청 보내기', exact: true }).waitFor();
        await tabButton('오픈카드').click(); await page.getByText('유료공개검증', { exact: true }).waitFor(); await page.waitForTimeout(200);
        assert.ok(count('/api/dating/paid/list') > paidBefore, 'return to open cards revalidates');
        assert.equal(count('/api/dating/cards/list'), initialListReads, 'tab return must preserve loaded open-card pages');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
        assert.equal(mutations, 0); assert.equal(blocked, 0); assert.deepEqual(errors, []);
        passed++; console.log('PASS home lazy/loading/lifecycle ' + width + 'px / initial ' + firstTab);
      } catch (error) { await page.screenshot({ path: path.join(output, 'failure-' + width + '-' + firstTab + '.png'), fullPage: true }); throw error; }
      finally { await context.close(); }
    }
    console.log(JSON.stringify({ passed, output, productionRequests: 0 }));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
