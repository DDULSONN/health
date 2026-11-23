/* eslint-disable @typescript-eslint/no-require-imports */
// Real Home and MyPage controls against a local, isolated API fixture.
const assert = require('node:assert/strict');
const path = require('node:path');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const replacePath = '/api/dating/1on1/recommendations/replace';
const listPath = '/api/dating/1on1/recommendations/my';

module.exports = async ({ browser, origin, output }) => {
  let passed = 0;
  for (const surface of ['home', 'mypage']) for (const scenario of ['success', 'empty', 'limit', 'stale', 'unknown']) {
    const width = scenario === 'empty' ? 1280 : 360;
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const own = { id: id(1), user_id: 'fixture-member', sex: 'female', name: '검증 프로필', age: 29, region: '서울', status: 'approved', created_at: new Date().toISOString() };
    const card = (n, name) => ({ ...own, id: id(n), user_id: id(n + 50), sex: 'male', name, age: 30, photo_signed_urls: [] });
    const old = card(2, '교체 대상'), other = card(3, '유지 후보'), added = card(4, '추가 추천 회원'), favorite = card(5, '찜한 추천 회원'), fresh = card(6, '처음 보는 회원');
    const matched = card(7, '연락처 유지 회원');
    const requests = [], errors = [];
    let substituted = false, reads = 0, posts = 0, online = scenario !== 'unknown', external = 0;
    let releasePost;
    const holdPost = new Promise(resolve => { releasePost = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) { external++; await route.abort(); return; }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      requests.push([req.method(), url.pathname]);
      if (req.method() !== 'GET') {
        if (url.pathname === '/api/dating/1on1/recommendations/impressions' || url.pathname.startsWith('/api/analytics/')) return route.fulfill({ json: { ok: true } });
        assert.equal(url.pathname, replacePath);
        assert.equal(req.method(), 'POST');
        assert.deepEqual(req.postDataJSON(), { source_card_id: own.id, candidate_card_id: old.id, generation_key: 'demo-generation', impression_ticket: 'demo-receipt' });
        posts++;
        await holdPost;
        if (scenario === 'empty') return route.fulfill({ status: 409, json: { code: 'NO_UNSEEN_CANDIDATE' } });
        if (scenario === 'limit') return route.fulfill({ status: 429, json: { code: 'SINGLE_REFRESH_LIMIT' } });
        if (scenario === 'stale') return route.fulfill({ status: 409, json: { code: 'SINGLE_REFRESH_STALE' } });
        substituted = true;
        if (scenario === 'unknown') return route.abort();
        return route.fulfill({ json: { ok: true, changed: true } });
      }
      let body = { ok: true, items: [], cards: [], applications: [], loggedIn: true };
      switch (url.pathname) {
        case '/api/dating/cards/queue-stats': body = { male: { public_count: 0, pending_count: 0, slot_limit: 45 }, female: { public_count: 0, pending_count: 0, slot_limit: 45 } }; break;
        case '/api/mypage/summary': body = { profile: { email: 'local@example.invalid', nickname: '검증회원', phone_verified: true, swipe_profile_visible: true }, account: { is_banned: false } }; break;
        case '/api/dating/1on1/my': body = { items: [own] }; break;
        case '/api/dating/1on1/write-status': body = { canWrite: false, phoneVerified: true, writeStatus: 'approved', activeRequestStatus: 'approved' }; break;
        case '/api/dating/1on1/matches/my': body = { items: [{ id: id(101), source_card_id: own.id, role: 'source', state: 'mutual_accepted', contact_exchange_status: 'approved', counterparty_card: matched, counterparty_phone: '01000000000', contact_exchange_approved_at: new Date().toISOString() }] }; break;
        case '/api/dating/cards/viewer-sex': body = { status: 'resolved', viewerSex: 'female', targetSex: 'male', source: 'one_on_one', canSwitchSex: false }; break;
        case listPath:
          reads++;
          if (posts && !online) return route.fulfill({ status: 503, json: { error: 'offline fixture' } });
          body = { items: [{ source_card_id: own.id, source_card_status: 'approved', hides_enabled: false,
            recommendations: [substituted ? fresh : old, other], admin_recommendations: [added], favorite_candidates: [favorite],
            // Extra/favorite intentionally included in the mock allowlist to verify the separate render gate.
            single_refresh_candidate_ids: substituted ? [] : [old.id, added.id, favorite.id],
            impression_ticket: substituted ? 'next-receipt' : 'demo-receipt', single_refresh_generation: substituted ? 'next-generation' : 'demo-generation',
            refresh_limit: 2, refresh_remaining: 2, refresh_used_count: 0, can_refresh: true }] };
          break;
      }
      return route.fulfill({ json: body });
    });
    try {
      await page.goto(origin + (surface === 'home' ? '/community/dating/cards?tab=one_on_one' : '/mypage?section=matching&matching=one_on_one'));
      const replace = page.getByRole('button', { name: '새 후보', exact: true });
      const quota = page.getByRole('button', { name: /후보 새로고침 · 2회/ }).first();
      const name = display => surface === 'home' ? page.getByText(display, { exact: true }) : page.getByText(`${display} / 30세 / 서울`, { exact: true });
      await replace.waitFor(); await quota.waitFor();
      assert.equal(await replace.count(), 1);
      assert.ok((await replace.boundingBox()).height >= 44);
      const before = reads;
      await replace.evaluate(el => { el.click(); el.click(); });
      await page.getByRole('button', { name: '바꾸는 중…', exact: true }).waitFor();
      assert.equal(await quota.isDisabled(), true);
      releasePost();
      if (scenario === 'success') {
        await page.getByText('이 후보 한 명을 새 후보로 바꿨어요.', { exact: true }).waitFor();
        await name(fresh.name).waitFor();
        await name(old.name).waitFor({ state: 'hidden' });
        assert.ok(reads > before);
        await page.screenshot({ path: path.join(output, `single-candidate-${surface}-mobile.png`) });
      } else if (scenario === 'unknown') {
        const recovery = page.getByRole('button', { name: /명단 다시 불러오기 · 횟수 차감 없음|추천 후보 다시 불러오기 · 횟수 차감 없음/ }).first();
        await recovery.waitFor();
        await page.getByText(/교체 결과를 확인하지 못했어요/).first().waitFor();
        assert.equal(posts, 1);
        online = true;
        await recovery.click();
        await name(fresh.name).waitFor();
      } else {
        const feedback = scenario === 'empty' ? '아직 안 본 후보가 없어서 지금 후보를 그대로 뒀어요.'
          : scenario === 'limit' ? '오늘 한 명씩 바꾸기는 모두 사용했어요. 현재 후보는 그대로예요.' : '명단을 다시 불러왔어요. 현재 후보를 확인해 주세요.';
        await page.getByText(feedback, { exact: true }).waitFor(); await name(old.name).waitFor();
        if (scenario === 'stale') assert.ok(reads > before);
        else assert.equal(reads, before);
      }
      await name(other.name).waitFor(); await quota.waitFor();
      assert.equal(posts, 1);
      assert.equal(requests.some(([method, url]) => !['GET'].includes(method) && (/\/payments\//.test(url) || /\/recommendations\/refresh$/.test(url) || /\/matches\//.test(url))), false);
      assert.ok((await page.locator('body').innerText()).includes('01000000000'));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []); assert.equal(external, 0);
      passed++; console.log(`PASS single candidate ${surface} / ${scenario}: one replacement POST, bulk quota unchanged, 0 external requests`);
    } finally { releasePost(); await context.close(); }
  }
  return passed;
};
