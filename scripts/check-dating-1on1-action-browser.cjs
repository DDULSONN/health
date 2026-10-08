/* eslint-disable @typescript-eslint/no-require-imports */
// Real React pages, fake local services only. No production requests or member writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const webpack = require('webpack');
const { chromium } = require('./test-browser-runtime.cjs');
const root = path.resolve(__dirname, '..');
async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-action-copy-browser-'));
  const adapter = path.join(__dirname, 'fixtures/recommendation-refresh-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false,
      entry: path.join(__dirname, 'fixtures/recommendation-refresh-browser.tsx'), output: { path: output, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], fallback: { crypto: false }, alias: {
        'next/link': adapter, 'next/image': adapter, 'next/navigation': adapter,
        '@/lib/supabase/client': adapter, '@/components/DatingAdultNotice': adapter, '@': root,
      } },
      plugins: [new webpack.DefinePlugin({ 'process.env.NEXT_PUBLIC_OPENKAKAO_URL': 'undefined' })],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/mypage-navigation-loader.cjs') }] },
    });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const cssRoot = path.join(root, '.next/static/css');
  const css = fs.readdirSync(cssRoot).filter(n => n.endsWith('.css')).map(n => fs.readFileSync(path.join(cssRoot, n), 'utf8')).join('\n');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); }
    else if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else if (req.url === '/fixture-photo.png') { res.setHeader('Content-Type', 'image/png'); res.end(fs.readFileSync(path.join(root, 'public/icon-192x192.png'))); }
    else if (req.url.startsWith('/api/')) { res.writeHead(500); res.end('Unmocked API'); }
    else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser, passed = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const surface of ['home', 'mypage']) for (const width of [320, 390, 1280]) for (const scenario of [
      'success', 'failure', 'proposed', 'read-failure', 'partial-read-failure', 'additional',
      ...(surface === 'mypage' ? ['favorite', 'incoming-other-error'] : []),
      'incoming-accept', 'incoming-reject', 'incoming-failure', 'incoming-many', 'incoming-none', 'incoming-read-error', 'incoming-missing-profile',
    ]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      const errors = [], alerts = [];
      let posts = 0, blocked = 0, release, responseAction = '';
      const gate = new Promise(resolve => { release = resolve; });
      const now = new Date().toISOString();
      const profile = { id: 'fixture-one', user_id: 'fixture-member', name: '검증 프로필', sex: 'female', age: 29, birth_year: 1998,
        height_cm: 165, job: '회사원', region: '서울', intro_text: '로컬 검증용 프로필입니다.', strengths_text: '배려해요.',
        preferred_partner_text: '대화가 잘 통하는 분', smoking: 'non_smoker', status: 'approved', created_at: now,
        photo_signed_urls: ['/fixture-photo.png', '/fixture-photo.png'], plus_expires_at: '2099-01-01T00:00:00Z' };
      const candidate = { ...profile, id: 'candidate-card', user_id: 'candidate-user', name: '추천상대', sex: 'male',
        intro_text: '주말에는 산책하고 맛있는 커피를 마시는 걸 좋아해요.\n'.repeat(16) + '끝까지 보이는 소개입니다.' };
      const incomingCase = scenario.startsWith('incoming-');
      function match(id, role, state, name, contact_exchange_status = 'none') {
        return { id, role, state, contact_exchange_status, source_card_id: role === 'source' ? profile.id : candidate.id,
          candidate_card_id: role === 'candidate' ? profile.id : candidate.id, created_at: now,
          source_card: role === 'source' ? profile : candidate, candidate_card: role === 'candidate' ? profile : candidate,
          counterparty_card: scenario === 'incoming-missing-profile' && id === 'incoming' ? null : { ...candidate, name }, action_required: role === 'candidate' && state === 'source_selected',
          matched_at: state === 'mutual_accepted' ? now : null, contact_exchanged_at: contact_exchange_status === 'approved' ? now : null };
      }
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.dismiss(); });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) { blocked++; await route.abort(); return; }
        if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
        let body = { ok: true, items: [], cards: [], applications: [], loggedIn: true };
        if (req.method() !== 'GET') {
          assert.equal(req.method(), 'POST'); posts++;
          if (incomingCase) {
            assert.equal(url.pathname, '/api/dating/1on1/matches/incoming');
            responseAction = scenario === 'incoming-reject' ? 'candidate_reject' : 'candidate_accept';
            assert.deepEqual(JSON.parse(req.postData()), { action: responseAction });
          } else if (scenario === 'proposed') {
            assert.equal(url.pathname, '/api/dating/1on1/matches/proposal');
            assert.deepEqual(JSON.parse(req.postData()), { action: 'select_candidate' });
          } else {
            assert.equal(url.pathname, '/api/dating/1on1/matches/auto');
            assert.deepEqual(JSON.parse(req.postData()), { source_card_id: profile.id, candidate_card_id: candidate.id });
          }
          await gate;
          const failed = ['failure', 'incoming-failure'].includes(scenario);
          await route.fulfill({ status: failed ? 409 : 200, json: failed ? { error: '테스트 요청 거절' } : { ok: true, id: 'sent-match' } }); return;
        }
        switch (url.pathname) {
          case '/api/dating/cards/my/applied':
            if (scenario === 'incoming-other-error') { await route.fulfill({ status: 503, json: { error: '로컬 오픈카드 조회 실패' } }); return; }
            break;
          case '/api/dating/cards/queue-stats': body = { male: { public_count: 0, pending_count: 0, slot_limit: 45 }, female: { public_count: 0, pending_count: 0, slot_limit: 45 } }; break;
          case '/api/mypage/summary': body = { profile: { email: 'fixture@example.invalid', nickname: '검증회원', phone_verified: true, nickname_changed_count: 0, nickname_change_credits: 0, swipe_profile_visible: true }, account: { is_banned: false }, isAdmin: false, weekly_win_count: 0, bodycheck_posts: [] }; break;
          case '/api/dating/1on1/my': body = { items: [profile], plus: { expires_at: profile.plus_expires_at, contact_exchange_included: false } }; break;
          case '/api/dating/1on1/write-status': body = { canWrite: false, phoneVerified: true, writeStatus: 'approved' }; break;
          case '/api/dating/1on1/matches/my':
            if (scenario === 'incoming-read-error') { await route.fulfill({ status: 503, json: { error: '로컬 받은 요청 조회 실패' } }); return; }
            if (posts && scenario === 'read-failure') { await route.fulfill({ status: 503, json: { error: '로컬 목록 조회 실패' } }); return; }
            body = { items: [
            ...(scenario === 'incoming-none' ? [] : [match('incoming', 'candidate',
              posts && incomingCase && scenario !== 'incoming-failure' ? (responseAction === 'candidate_accept' ? 'mutual_accepted' : 'candidate_rejected') : 'source_selected', '요청한회원')]),
            ...(scenario === 'incoming-many' ? Array.from({ length: 8 }, (_, i) => match('more-' + i, 'candidate', 'source_selected', '추가요청회원' + i)) : []),
            match('waiting', 'source', 'source_selected', '기다리는회원'),
            match('complete', 'source', 'mutual_accepted', '교환완료회원', 'approved'),
            ...(scenario === 'proposed' ? [match('proposal', 'source', posts ? 'source_selected' : 'proposed', candidate.name)] : []),
          ] }; break;
          case '/api/dating/1on1/recommendations/my':
            if (posts && ['read-failure', 'partial-read-failure'].includes(scenario)) { await route.fulfill({ status: 503, json: { error: '로컬 목록 조회 실패' } }); return; }
            body = { items: [{ source_card_id: profile.id, source_card_status: 'approved',
            recommendations: ['proposed', 'additional', 'favorite'].includes(scenario) || (posts && scenario === 'success') ? [] : [candidate],
            admin_recommendations: scenario === 'additional' ? [candidate] : [], favorite_candidates: scenario === 'favorite' ? [candidate] : [],
            refresh_limit: 2, refresh_remaining: 2, refresh_used_count: 0, can_refresh: true }] }; break;
          case '/api/dating/cards/viewer-sex': body = { status: 'resolved', viewerSex: 'female', targetSex: 'male', source: 'one_on_one', canSwitchSex: false, requiresSexSelection: false }; break;
          case '/api/dating/cards/my/swipe-status': body = { outgoing_likes: [], incoming_likes: [], summary: { incoming_pending: 0, outgoing_pending: 0 } }; break;
          case '/api/dating/cards/write-enabled': body = { enabled: true }; break;
          case '/api/dating/apply-credits/status': body = { creditsRemaining: 5 }; break;
        }
        await route.fulfill({ json: body });
      });
      try {
        await page.goto(origin + (surface === 'home' ? '/community/dating/cards?tab=one_on_one' : '/mypage?section=matching&matching=one_on_one'));
        if (incomingCase) {
          const inbox = page.getByRole('region', { name: '받은 1:1 매칭 요청' });
          if (scenario === 'incoming-none' || scenario === 'incoming-read-error') {
            if (scenario === 'incoming-none') await page.getByRole('button', { name: '매칭 요청 보내기', exact: true }).first().waitFor();
            else await page.getByText(/로컬 받은 요청 조회 실패|매칭 정보를 불러오지 못|일부 매칭/).first().waitFor();
            assert.equal(await inbox.count(), 0, 'no false request shortcut after empty/failed read');
          } else {
            const shortcut = inbox.getByRole('button', { name: /나에게 온 요청/ }); await shortcut.waitFor();
            assert.equal(await shortcut.getAttribute('aria-expanded'), 'false');
            assert.equal(await inbox.getByRole('button', { name: '수락', exact: true }).count(), 0, 'collapsed requests do not mount hidden action buttons');
            await shortcut.click();
            if (scenario === 'incoming-missing-profile') {
              await inbox.getByText(/상대 프로필을 확인할 수 없습니다/).waitFor();
              assert.equal(await inbox.getByRole('button', { name: '수락', exact: true }).count(), 0);
              assert.equal(await inbox.getByRole('button', { name: '거절', exact: true }).count(), 0);
            } else await inbox.getByText('내 수락 대기', { exact: true }).first().waitFor();
            // Source-selected sent requests and already mutual matches never appear in this inbox.
            assert.equal(await inbox.getByText('기다리는회원', { exact: true }).count(), 0);
            assert.equal(await inbox.getByText('교환완료회원', { exact: true }).count(), 0);
            if (scenario === 'incoming-many') {
              assert.equal(await inbox.getByRole('button', { name: '수락', exact: true }).count(), 3);
              await inbox.getByRole('button', { name: /받은 요청 더보기/ }).click();
              assert.equal(await inbox.getByRole('button', { name: '수락', exact: true }).count(), 6);
              await inbox.getByRole('button', { name: /받은 요청 더보기/ }).click();
              assert.equal(await inbox.getByRole('button', { name: '수락', exact: true }).count(), 9, 'all requests remain reachable beyond the old 8-item limit');
              assert.equal(await inbox.getByRole('button', { name: /받은 요청 더보기/ }).count(), 0);
            } else if (!['incoming-missing-profile', 'incoming-other-error'].includes(scenario)) {
              const action = inbox.getByRole('button', { name: scenario === 'incoming-reject' ? '거절' : '수락', exact: true }).first();
              await action.click();
              const busy = inbox.getByRole('button', { name: '처리 중...', exact: true }); await busy.waitFor();
              assert.equal(await busy.isDisabled(), true);
              assert.equal(await inbox.getByRole('button', { name: '거절', exact: true }).isDisabled(), true);
              // A synthetic second click must still be ignored while the real request is in flight.
              await busy.evaluate(el => el.click()); assert.equal(posts, 1);
              release();
              if (scenario === 'incoming-failure') {
                await inbox.getByRole('button', { name: '수락', exact: true }).waitFor();
                assert.equal(alerts.length, 1);
                assert.equal(await shortcut.getAttribute('aria-expanded'), 'true');
              } else {
                await inbox.waitFor({ state: 'hidden' });
              }
            }
            if (width === 390 && scenario === 'incoming-many') {
              await shortcut.scrollIntoViewIfNeeded();
              await page.screenshot({ path: path.join(output, `${surface}-incoming-mobile.png`) });
            }
          }
          assert.equal(posts, ['incoming-accept', 'incoming-reject', 'incoming-failure'].includes(scenario) ? 1 : 0);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'inbox fits mobile width');
          assert.equal(blocked, 0); assert.deepEqual(errors, []);
          console.log(`PASS ${surface} ${width}px ${scenario}`); passed++;
          continue;
        }
        const button = page.getByRole('button', { name: '매칭 요청 보내기', exact: true }).first(); await button.waitFor();
        const summary = page.locator('[data-profile-summary]').filter({ has: button }).first();
        const expand = summary.getByRole('button', { name: '소개 더보기' }); await expand.waitFor();
        assert.equal(await expand.getAttribute('aria-expanded'), 'false');
        assert.ok((await summary.locator(':scope > p').boundingBox()).height <= 41, 'long intro initially takes at most two lines');
        await expand.click();
        assert.equal(await summary.getByText('끝까지 보이는 소개입니다.', { exact: false }).count(), 2, 'full intro remains available in addition to the preview');
        const detail = summary.locator('div[id]').last(); assert.equal(await detail.isVisible(), true);
        await summary.getByRole('button', { name: '소개 접기' }).click(); assert.equal(await detail.isVisible(), false);
        assert.equal(posts, 0, 'expanding text never sends a request');
        await button.scrollIntoViewIfNeeded();
        const images = summary.locator('img');
        assert.ok(await images.count() > 0, 'photos remain outside the folded introduction');
        for (const img of await images.all()) {
          await img.scrollIntoViewIfNeeded();
          await page.waitForFunction(el => el.complete && el.naturalWidth > 0, await img.elementHandle(), { timeout: 5000 });
          assert.ok(await img.evaluate(el => el.naturalWidth > 0));
        }
        if (width === 390 && scenario === 'success') {
          await summary.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, `${surface}-compact-mobile.png`) });
        }
        await page.getByRole('button', { name: /나에게 온 요청/ }).click();
        await page.getByText('내 수락 대기', { exact: true }).first().waitFor();
        await page.getByText('상대 응답 대기', { exact: true }).first().waitFor();
        assert.equal(await page.getByText('확인 필요', { exact: true }).count(), 0);
        await button.click();
        const sending = page.getByRole('button', { name: '요청 보내는 중...', exact: true }).first(); await sending.waitFor();
        assert.equal(await sending.isDisabled(), true);
        assert.equal(await page.getByRole('status').filter({ hasText: '매칭 요청을 보냈어요.' }).count(), 0, 'no premature success');
        release();
        if (scenario === 'failure') {
          await button.waitFor(); assert.equal(alerts.length, 1);
          assert.equal(await page.getByRole('status').filter({ hasText: '매칭 요청을 보냈어요.' }).count(), 0);
        } else {
          const notice = page.getByRole('status').filter({ hasText: '추천상대님에게 매칭 요청을 보냈어요.' }); await notice.waitFor();
          if (scenario === 'read-failure') {
            await page.getByText(surface === 'home' ? /로컬 목록 조회 실패/ : /다시 요청하지 말고 화면을 새로고침/).first().waitFor();
          }
          assert.equal(alerts.length, 0);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
          if (width === 360) await page.screenshot({ path: path.join(output, `${surface}-${scenario}-mobile.png`) });
          await page.getByRole('button', { name: '요청 전송 안내 닫기' }).click(); await notice.waitFor({ state: 'hidden' });
        }
        assert.equal(posts, 1); assert.equal(blocked, 0); assert.deepEqual(errors, []);
        console.log(`PASS ${surface} ${width}px ${scenario}`); passed++;
      } catch (error) {
        await page.screenshot({ path: path.join(output, `failure-${surface}-${width}-${scenario}.png`), fullPage: true }); throw error;
      } finally { release(); await context.close(); }
    }
    console.log(`PASS: ${passed} browser cases. Evidence: ${output}`);
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
