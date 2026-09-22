/* eslint-disable @typescript-eslint/no-require-imports */
// Actual React pages in a local fake-service host. Every external request is blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const webpack = require('webpack');
const root = path.resolve(__dirname, '..');
const runtime = process.env.CODEX_NODE_PACKAGES || 'C:/Users/DDULSONN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(path.join(runtime, 'playwright'));
async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-refresh-browser-'));
  const adapter = path.join(__dirname, 'fixtures/recommendation-refresh-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: 'development', devtool: false,
      entry: path.join(__dirname, 'fixtures/recommendation-refresh-browser.tsx'),
      output: { path: output, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], fallback: { crypto: false }, alias: {
        'next/link': adapter, 'next/image': adapter, 'next/navigation': adapter,
        '@/lib/supabase/client': adapter, '@/components/DatingAdultNotice': adapter, '@': root,
      } },
      plugins: [new webpack.DefinePlugin({ 'process.env.NEXT_PUBLIC_OPENKAKAO_URL': 'undefined' })],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/mypage-navigation-loader.cjs') }] },
    });
    compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true })));
      else resolve();
    });
  });
  const cssRoot = path.join(root, '.next/static/css');
  const css = fs.readdirSync(cssRoot).filter(name => name.endsWith('.css')).map(name => fs.readFileSync(path.join(cssRoot, name), 'utf8')).join('\n');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); }
    else if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else if (req.url === '/fixture-photo.png') { res.setHeader('Content-Type', 'image/png'); res.end(fs.readFileSync(path.join(root, 'public/icon-192x192.png'))); }
    else if (req.url.startsWith('/api/')) { res.writeHead(500); res.end('Unmocked fixture API'); }
    else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser, passed = 0;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const surface of ['home', 'mypage']) for (const width of [390, 1280]) {
      for (const scenario of ['success', 'read-failure', 'bad-read', 'lost-post']) {
        const context = await browser.newContext({ viewport: { width, height: 844 } });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const errors = [], alerts = [];
        let posts = 0, recover = false, blocked = 0;
        const now = new Date().toISOString();
        const profile = { id: 'fixture-one', user_id: 'fixture-member', name: '검증 프로필', sex: 'female', age: 29, birth_year: 1998,
          height_cm: 165, job: '회사원', region: '서울', intro_text: '실제 회원이 아닌 로컬 테스트 프로필이에요.',
          strengths_text: '배려하는 편이에요.', preferred_partner_text: '대화가 잘 통하는 분', smoking: 'non_smoker',
          status: 'approved', created_at: now, photo_signed_urls: ['/fixture-photo.png', '/fixture-photo.png'] };
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', async dialog => { if (dialog.type() !== 'confirm') alerts.push(dialog.message()); await dialog.accept(); });
        await context.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url());
          if (url.origin !== origin) { blocked++; await route.abort(); return; }
          if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
          let body = { ok: true, items: [], cards: [], applications: [], loggedIn: true };
          if (req.method() !== 'GET') {
            assert.equal(req.method(), 'POST');
            assert.equal(url.pathname, '/api/dating/1on1/recommendations/refresh');
            assert.equal(JSON.parse(req.postData()).source_card_id, profile.id);
            posts++;
            if (scenario === 'lost-post') { await route.abort(); return; }
            await route.fulfill({ json: { ok: true, source_card_id: profile.id, refresh_limit: 2, refresh_remaining: 1, refresh_used_count: 1, refresh_used_at: now } }); return;
          }
          switch (url.pathname) {
            case '/api/dating/cards/queue-stats': body = { male: { public_count: 0, pending_count: 0, slot_limit: 45 }, female: { public_count: 0, pending_count: 0, slot_limit: 45 } }; break;
            case '/api/mypage/summary': body = { profile: { email: 'fixture@example.invalid', nickname: '검증회원', phone_verified: true,
              nickname_changed_count: 0, nickname_change_credits: 0, swipe_profile_visible: true },
              account: { is_banned: false }, isAdmin: false, weekly_win_count: 0, bodycheck_posts: [] }; break;
            case '/api/dating/1on1/my': body = { items: [profile], plus: { expires_at: '2099-01-01' } }; break;
            case '/api/dating/1on1/write-status': body = { canWrite: false, phoneVerified: true, writeStatus: 'approved', activeRequestStatus: 'approved' }; break;
            case '/api/dating/1on1/recommendations/my':
              if (posts && !recover && scenario === 'read-failure') { await route.fulfill({ status: 503, json: { error: '로컬 조회 실패' } }); return; }
              if (posts && !recover && scenario === 'bad-read') { await route.fulfill({ json: { items: [null] } }); return; }
              body = { items: [{ source_card_id: profile.id, source_card_status: 'approved', recommendations: [{
                ...profile, id: posts ? 'candidate-new' : 'candidate-old', user_id: 'other', sex: 'male',
                name: posts ? '새 후보' : '이전 후보',
              }], admin_recommendations: [], favorite_candidates: [],
                refresh_limit: 2, refresh_used_count: posts ? 1 : 0, refresh_remaining: posts ? 1 : 2, can_refresh: true,
                refresh_used_at: posts ? now : null }] }; break;
            case '/api/dating/cards/viewer-sex': body = { status: 'resolved', viewerSex: 'female', targetSex: 'male', source: 'one_on_one', canSwitchSex: false, requiresSexSelection: false }; break;
            case '/api/dating/cards/my/swipe-status': body = { outgoing_likes: [], incoming_likes: [], summary: { incoming_pending: 0, outgoing_pending: 0 } }; break;
            case '/api/dating/cards/write-enabled': body = { enabled: true }; break;
            case '/api/dating/apply-credits/status': body = { creditsRemaining: 5 }; break;
          }
          await route.fulfill({ json: body });
        });
        const url = origin + (surface === 'home' ? '/community/dating/cards?tab=one_on_one' : '/mypage?section=matching&matching=one_on_one');
        await page.goto(url);
        const refresh = page.getByRole('button', { name: /후보 새로고침 · 2회/ }).first();
        try {
          await refresh.waitFor();
          if (scenario === 'success') await refresh.evaluate(el => { el.click(); el.click(); });
          else await refresh.click();
          if (scenario !== 'success') {
            const recovery = page.getByRole('button', { name: '명단 다시 불러오기 · 횟수 차감 없음', exact: true });
            await recovery.waitFor();
            assert.equal(posts, 1);
            assert.ok(!alerts.some(text => text.startsWith('새로고침 1회를 사용했어요.')));
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile overflow');
            if (width === 390 && scenario === 'read-failure') await page.screenshot({ path: path.join(output, surface + '-mobile-recovery.png'), fullPage: true });
            recover = true;
            await recovery.click();
          }
          await page.getByText('새 후보', { exact: false }).first().waitFor();
          await page.getByRole('button', { name: /후보 새로고침 · 1회/ }).first().waitFor();
          assert.equal(posts, 1, 'GET recovery cannot consume an additional refresh');
          assert.equal(alerts.filter(text => text.startsWith('새로고침 1회를 사용했어요.')).length, scenario === 'success' ? 1 : 0);
          assert.equal(errors.length, 0, errors.join('\n'));
          assert.equal(blocked, 0, 'unexpected external request');
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page overflow');
          assert.ok(!(await page.locator('body').innerText()).includes('\ufffd'));
          console.log(JSON.stringify({ surface, width, scenario, posts, errors: errors.length, passed: true }));
          passed++;
        } catch (error) {
          await page.screenshot({ path: path.join(output, 'failed-' + surface + '-' + width + '-' + scenario + '.png'), fullPage: true });
          console.error(JSON.stringify({ surface, width, scenario, errors, diagnosticScreenshot: output }));
          throw error;
        } finally { await context.close(); }
      }
    }
    console.log(JSON.stringify({ passed, productionRequests: 0, screenshots: output }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
