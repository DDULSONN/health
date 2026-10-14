/* eslint-disable @typescript-eslint/no-require-imports */
// Actual home/mypage components; all services are mocked and external requests blocked.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function regionNoticeBrowser({ browser, origin, output }) {
  const notice = '주변 새 후보가 적어 지역을 넓혔어요. 가까운 새 후보는 우선 추천해요.';
  let passed = 0;
  for (const surface of ['home', 'mypage']) for (const width of [360, 1280]) {
    for (const scenario of ['nearby', 'wider', 'legacy', 'nearby-arrives', 'quota-empty']) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = []; let posts = 0, externals = 0, nearbyArrived = false;
      const profile = { id: 'fixture-one', user_id: 'fixture-member', name: '검증 프로필', sex: 'female', age: 29, birth_year: 1998,
        height_cm: 165, job: '회사원', region: '서울', intro_text: '실제 회원이 아닌 로컬 검증용 프로필이에요.',
        strengths_text: '서로 배려해요.', preferred_partner_text: '대화가 잘 통하는 분', smoking: 'non_smoker',
        status: 'approved', created_at: new Date().toISOString(), photo_signed_urls: ['/fixture-photo.png'] };
      page.on('pageerror', e => errors.push(e.message));
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) { externals++; await route.abort(); return; }
        if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
        if (req.method() !== 'GET') { posts++; await route.fulfill({ status: 500, json: { error: 'Unexpected write' } }); return; }
        let body = { ok: true, items: [], cards: [], applications: [], loggedIn: true };
        switch (url.pathname) {
          case '/api/dating/cards/queue-stats': body = { male: { public_count: 0, pending_count: 0, slot_limit: 45 }, female: { public_count: 0, pending_count: 0, slot_limit: 45 } }; break;
          case '/api/mypage/summary': body = { profile: { email: 'fixture@example.invalid', nickname: '검증회원', phone_verified: true, nickname_changed_count: 0, nickname_change_credits: 0, swipe_profile_visible: true }, account: { is_banned: false }, isAdmin: false, weekly_win_count: 0, bodycheck_posts: [] }; break;
          case '/api/dating/1on1/my': body = { items: [profile] }; break;
          case '/api/dating/1on1/write-status': body = { canWrite: false, phoneVerified: true, writeStatus: 'approved', activeRequestStatus: 'approved' }; break;
          case '/api/dating/1on1/recommendations/my': {
            const widened = !nearbyArrived && !['nearby', 'legacy'].includes(scenario);
            const remaining = scenario === 'quota-empty' ? 0 : 2;
            body = { items: [{ source_card_id: profile.id, source_card_status: 'approved',
              ...(scenario === 'legacy' ? {} : { recommendation_region_widened: widened }),
              recommendations: [{ ...profile, id: 'candidate', name: widened ? '넓은 지역 후보' : '주변 후보', sex: 'male', region: widened ? '부산' : '경기' }],
              admin_recommendations: [], favorite_candidates: [], refresh_limit: 2, refresh_used_count: 2 - remaining,
              refresh_remaining: remaining, can_refresh: remaining > 0, refresh_used_at: null }] };
            break;
          }
          case '/api/dating/cards/viewer-sex': body = { status: 'resolved', viewerSex: 'female', targetSex: 'male', source: 'one_on_one', canSwitchSex: false, requiresSexSelection: false }; break;
          case '/api/dating/cards/my/swipe-status': body = { outgoing_likes: [], incoming_likes: [], summary: { incoming_pending: 0, outgoing_pending: 0 } }; break;
          case '/api/dating/cards/write-enabled': body = { enabled: true }; break;
          case '/api/dating/apply-credits/status': body = { creditsRemaining: 5 }; break;
        }
        await route.fulfill({ json: body });
      });
      try {
        await page.goto(origin + (surface === 'home' ? '/community/dating/cards?tab=one_on_one' : '/mypage?section=matching&matching=one_on_one'));
        await page.getByText(/넓은 지역 후보|주변 후보/).first().waitFor();
        const copy = page.getByText(notice, { exact: true });
        if (['nearby', 'legacy'].includes(scenario)) assert.equal(await copy.count(), 0);
        else {
          await copy.waitFor(); assert.equal(await copy.count(), 1);
          assert.equal(await copy.evaluate(el => getComputedStyle(el).fontSize), '12px');
          if (scenario === 'wider') {
            await copy.scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(output, `region-notice-${surface}-${width}.png`), fullPage: true });
          }
          if (scenario === 'nearby-arrives') {
            nearbyArrived = true; await page.reload();
            await page.getByText(/주변 후보/).first().waitFor();
            assert.equal(await copy.count(), 0, 'notice disappears when no remote candidates remain');
          }
        }
        assert.equal(await page.getByRole('group', { name: '추천 지역 범위' }).count(), 0);
        assert.equal(posts, 0); assert.equal(externals, 0); assert.deepEqual(errors, []);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.ok(!(await page.locator('body').innerText()).includes('\ufffd'));
        passed++; console.log(JSON.stringify({ surface, width, scenario, posts, passed: true }));
      } catch (e) {
        await page.screenshot({ path: path.join(output, `failed-region-notice-${surface}-${width}-${scenario}.png`), fullPage: true });
        console.error({ surface, width, scenario, errors, output }); throw e;
      } finally { await context.close(); }
    }
  }
  return passed;
};
