/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
module.exports = async ({ browser, origin }) => {
  let passed = 0;
  for (const width of [360, 1280]) for (const mode of ['normal','hidden','unsupported','failure']) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage(), acknowledgements = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    if (mode === 'hidden') await page.addInitScript(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }));
    if (mode === 'unsupported') await page.addInitScript(() => { window.IntersectionObserver = undefined; });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, origin);
      if (url.pathname === '/api/dating/1on1/recommendations/impressions') {
        acknowledgements.push(JSON.parse(route.request().postData()));
        if (mode === 'failure') await route.abort(); else await route.fulfill({ json: { recorded: true } });
      } else await route.continue();
    });
    try {
      await page.goto(origin+'/impressions-fixture');
      await page.getByText('첫 후보', { exact: true }).waitFor();
      await page.waitForTimeout(1100);
      await page.getByRole('button', { name: '검증 저장' }).click();
      await page.waitForTimeout(150);
      if (mode === 'hidden' || mode === 'unsupported') assert.equal(acknowledgements.length, 0);
      else {
        assert.deepEqual(acknowledgements.flatMap(p => p.candidate_ids), ['first']);
        const offscreen = page.getByText('화면 밖 후보', { exact: true });
        await offscreen.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150); await page.evaluate(() => scrollTo(0,0)); await page.waitForTimeout(900);
        await page.getByRole('button', { name: '검증 저장' }).click();
        assert.ok(!acknowledgements.some(p => p.candidate_ids.includes('offscreen')), 'quick scroll is not a view');
        await offscreen.scrollIntoViewIfNeeded(); await page.waitForTimeout(1000);
        // Native page lifecycle must flush observed cards before navigating away.
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(150);
        assert.ok(acknowledgements.some(p => p.candidate_ids.includes('offscreen')));
        assert.ok(!acknowledgements.some(p => p.candidate_ids.includes('collapsed')));
        await page.getByText('긴 모바일 후보', { exact: true }).scrollIntoViewIfNeeded(); await page.waitForTimeout(1000);
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(150);
        assert.ok(acknowledgements.some(p => p.candidate_ids.includes('tall')));
      }
      assert.deepEqual(errors, []); passed++;
    } finally { await context.close(); }
  }
  // Real home/mypage wiring: acknowledgement finishes before quota POST.
  for (const surface of ['home','mypage']) for (const width of [360,1280]) for (const failure of [false,true]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage(), actions = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let posts = 0;
    const profile = { id: 'fixture-one', user_id: 'fixture-member', name: '검증 프로필', sex: 'female', age: 29, birth_year: 1998,
      height_cm: 165, job: '회사원', region: '서울', intro_text: '로컬 테스트 프로필', strengths_text: '배려', preferred_partner_text: '대화',
      status: 'approved', created_at: new Date().toISOString(), photo_signed_urls: ['/fixture-photo.png'], plus_expires_at: '2099-01-01T00:00:00Z' };
    const candidates = Array.from({ length: 13 }, (_, i) => ({ ...profile, id: 'candidate-'+i, user_id: 'other-'+i, name: '노출후보 '+i, sex: 'male' }));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()); assert.equal(url.origin, origin);
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      let body = { ok: true, items: [], cards: [], applications: [], loggedIn: true };
      if (url.pathname === '/api/dating/1on1/recommendations/impressions') {
        actions.push({ type: 'seen', ...JSON.parse(req.postData()) });
        if (failure) await route.abort(); else await route.fulfill({ json: { recorded: true } }); return;
      }
      if (url.pathname === '/api/dating/1on1/recommendations/refresh') {
        actions.push({ type: 'refresh' }); posts++;
        await route.fulfill({ json: { ok: true, refresh_consumed: false, changed_candidate_count: 0,
          source_card_id: profile.id, refresh_limit: 2, refresh_remaining: 2, refresh_used_count: 0 } }); return;
      }
      if (url.pathname === '/api/dating/1on1/recommendations/expand') {
        await route.fulfill({ json: { source_card_id: profile.id, day_key: '2026-10-12',
          expires_at: new Date(Date.now()+86400000).toISOString(), impression_ticket: 'expansion-receipt',
          candidates: [{ ...candidates[0], id: 'expanded', name: '넓힌 후보' }] } }); return;
      }
      switch (url.pathname) {
        case '/api/mypage/summary': body = { profile: { nickname: '검증', email: 'fixture@example.invalid', phone_verified: true }, account: { is_banned: false }, isAdmin: false }; break;
        case '/api/dating/1on1/my': body = { items: [profile], plus: { expires_at: profile.plus_expires_at } }; break;
        case '/api/dating/1on1/write-status': body = { canWrite: false, phoneVerified: true, writeStatus: 'approved', activeRequestStatus: 'approved' }; break;
        case '/api/dating/1on1/recommendations/my': body = { items: [{ source_card_id: profile.id, recommendations: candidates.slice(0,10),
          admin_recommendations: candidates.slice(10), favorite_candidates: [], impression_ticket: 'fixture-ticket', expansion_enabled: true,
          refresh_limit: 2, refresh_remaining: 2, refresh_used_count: 0, can_refresh: true }] }; break;
        case '/api/dating/cards/viewer-sex': body = { status: 'resolved', viewerSex: 'female', targetSex: 'male', source: 'one_on_one', canSwitchSex: false }; break;
        case '/api/dating/cards/my/swipe-status': body = { outgoing_likes: [], incoming_likes: [], summary: { incoming_pending: 0, outgoing_pending: 0 } }; break;
        case '/api/dating/cards/write-enabled': body = { enabled: true }; break;
        case '/api/dating/apply-credits/status': body = { creditsRemaining: 5 }; break;
      }
      await route.fulfill({ json: body });
    });
    try {
      await page.goto(origin+(surface === 'home' ? '/community/dating/cards?tab=one_on_one' : '/mypage?section=matching&matching=one_on_one'));
      const candidate = page.getByText(/^노출후보 0\b/).first();
      await candidate.scrollIntoViewIfNeeded(); await page.waitForTimeout(1000);
      const refresh = page.getByRole('button', { name: /후보 새로고침 · 2회/ }).first();
      await refresh.evaluate(el => el.click());
      const modal = page.getByRole('dialog', { name: '후보를 새로고침할까요?' }); await modal.waitFor();
      await modal.getByRole('button', { name: '1회 사용하기', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '횟수를 사용하지 않았어요.' }).waitFor();
      assert.equal(posts, 1);
      const firstSeen = actions.findIndex(a => a.type === 'seen' && a.candidate_ids.includes('candidate-0'));
      assert.ok(firstSeen >= 0 && firstSeen < actions.findIndex(a => a.type === 'refresh'));
      assert.ok(!actions.some(a => a.type === 'seen' && a.candidate_ids.includes('candidate-12')), 'offscreen extra must not count');
      await page.getByText(/^노출후보 12\b/).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(1000);
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(150);
      assert.ok(actions.some(a => a.type === 'seen' && a.candidate_ids.includes('candidate-12')), 'extra records only after visible');
      const panel = page.getByRole('region', { name: '후보 범위 넓히기' });
      await panel.getByRole('button', { name: '후보 넓혀보기' }).click();
      await panel.getByText(/^넓힌 후보/).waitFor();
      await panel.getByRole('button', { name: '추가 후보 접기' }).click(); await page.waitForTimeout(1000);
      assert.ok(!actions.some(a => a.type === 'seen' && a.candidate_ids.includes('expanded')), 'brief open then collapse must not count');
      await panel.getByRole('button', { name: '후보 넓혀보기' }).click();
      await panel.getByText(/^넓힌 후보/).scrollIntoViewIfNeeded(); await page.waitForTimeout(1000);
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(150);
      assert.ok(actions.some(a => a.type === 'seen' && a.ticket === 'expansion-receipt' && a.candidate_ids.includes('expanded')));
      assert.equal(posts, 1, 'impressions and expansion do not consume another refresh');
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      passed++;
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ impressionScenarios: passed, productionRequests: 0 }));
  return passed;
};
