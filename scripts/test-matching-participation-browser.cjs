/* eslint-disable @typescript-eslint/no-require-imports */
// Actual home page, local synthetic accounts; all external traffic is blocked.
const assert = require('node:assert/strict'), path = require('node:path');
module.exports = async ({ browser, origin, output }) => {
  let passed = 0;
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  for (const width of [360, 1280]) for (const scenario of [
    'first', 'sent', 'unknown', 'empty', 'hidden', 'archived', 'unverified', 'loading', 'error', 'incoming', 'canceled', 'onboarding', 'deep-link',
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } }), page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [], mutations = [], reads = []; let external = 0, sent = scenario === 'sent', failSend = true;
    let release; const pending = new Promise(resolve => { release = resolve; });
    const own = { id: id(1), name: '가상 본인', status: scenario === 'archived' ? 'rejected' : 'approved', archived: scenario === 'archived', age: 29, sex: 'female', region: '서울' };
    const candidate = { id: id(2), user_id: id(102), name: '다정한회원', age: 30, sex: 'male', region: '서울', intro_text: '서로 배려하며 편안하게 대화하고 싶어요.', photo_signed_urls: ['/fixture-photo.png'] };
    const matches = ['incoming', 'canceled', 'deep-link'].includes(scenario) ? [{ id: id(50), role: 'candidate', source_card_id: candidate.id,
      state: scenario === 'canceled' ? 'source_skipped' : 'source_selected', contact_exchange_status: 'none', counterparty_card: candidate }] : [];
    page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) { external++; await route.abort(); return; }
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      let body = { ok: true, loggedIn: true, items: [], cards: [], applications: [] };
      if (req.method() !== 'GET') {
        if (url.pathname.endsWith('/recommendations/impressions')) { await route.fulfill({ json: { ok: true } }); return; }
        mutations.push({ path: url.pathname, body: req.postDataJSON() });
        if (url.pathname.endsWith('/matches/auto')) {
          assert.deepEqual(req.postDataJSON(), { source_card_id: own.id, candidate_card_id: candidate.id });
          if (failSend) { await route.fulfill({ status: 503, json: { error: '요청 전송을 확인하지 못했어요.' } }); return; }
          sent = true; matches.push({ id: id(51), role: 'source', state: 'source_selected', contact_exchange_status: 'none', counterparty_card: candidate });
        } else if (url.pathname.endsWith('/matches/' + id(50))) {
          const action = req.postDataJSON().action;
          assert.ok(['candidate_accept', 'candidate_reject'].includes(action));
          matches[0].state = action === 'candidate_accept' ? 'mutual_accepted' : 'candidate_rejected';
          matches[0].contact_exchange_status = action === 'candidate_accept' ? 'awaiting_applicant_payment' : 'none';
        } else throw Error('Unexpected mutation: ' + url.pathname);
        await route.fulfill({ json: body }); return;
      }
      reads.push(url.pathname);
      switch (url.pathname) {
        case '/api/mypage/summary': body = { profile: { nickname: '가상계정별명', phone_verified: scenario !== 'unverified', email: 'fixture@example.invalid' }, account: { is_banned: false }, isAdmin: false, bodycheck_posts: [] }; break;
        case '/api/dating/cards/queue-stats': body = { male: { public_count: 0, pending_count: 0, slot_limit: 45 }, female: { public_count: 0, pending_count: 0, slot_limit: 45 } }; break;
        case '/api/dating/1on1/my':
          assert.equal(url.searchParams.get('participation'), '1');
          body = { items: [own], has_sent_request: scenario === 'unknown' ? null : sent }; break;
        case '/api/dating/1on1/write-status': body = { phoneVerified: scenario !== 'unverified', canWrite: false, writeStatus: 'approved' }; break;
        case '/api/dating/1on1/matches/my': body = { items: matches }; break;
        case '/api/dating/1on1/recommendations/my':
          if (scenario === 'loading') await pending;
          if (scenario === 'error') { await route.fulfill({ status: 503, json: { error: '후보 조회 실패' } }); return; }
          body = { items: [{ source_card_id: own.id, source_card_status: own.status, recommendations: scenario === 'empty' || sent ? [] : [candidate],
            hidden_candidate_ids: scenario === 'hidden' ? [candidate.id] : [], admin_recommendations: [], favorite_candidates: [],
            refresh_limit: 2, refresh_remaining: 2, refresh_used_count: 0, can_refresh: true }] }; break;
        case '/api/dating/cards/viewer-sex': body = { status: 'resolved', viewerSex: 'female', targetSex: 'male', source: 'one_on_one', canSwitchSex: false, requiresSexSelection: false }; break;
        case '/api/dating/cards/my/swipe-status': body = { outgoing_likes: [], incoming_likes: [], summary: { incoming_pending: 0, outgoing_pending: 0 } }; break;
        case '/api/dating/cards/write-enabled': body = { enabled: true }; break;
      }
      await route.fulfill({ json: body });
    });
    try {
      const extra = scenario === 'onboarding' ? '&from=onboarding' : scenario === 'deep-link' ? `&matchId=${id(50)}#selected-one-on-one-match` : '';
      await page.goto(origin + '/community/dating/cards?tab=one_on_one' + extra);
      await page.addStyleTag({ content: ':root { --font-korean-sans:"Malgun Gothic"; --font-geist-sans:Arial; } body,button { font-family:"Malgun Gothic",Arial,sans-serif; }' });
      const panel = page.locator('#one-on-one-candidates'), notice = page.getByRole('complementary', { name: '첫 매칭 요청 안내' });
      await panel.getByRole('navigation', { name: '1대1 바로가기' }).waitFor({ state: scenario === 'archived' ? 'hidden' : 'visible' });
      if (scenario === 'loading') {
        await panel.getByText('추천 후보를 불러오는 중이에요.', { exact: true }).waitFor();
        assert.equal(await notice.count(), 0); release(); await notice.waitFor();
      } else if (['first', 'canceled'].includes(scenario)) {
        await notice.waitFor();
      } else {
        if (scenario === 'error') await panel.getByText('추천 후보를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.').waitFor();
        else await page.waitForFunction(() => !document.querySelector('#one-on-one-candidates')?.textContent?.includes('1대1 정보를 불러오는 중'));
        assert.equal(await notice.count(), 0);
      }
      if (scenario === 'first') {
        await notice.screenshot({ path: path.join(output, `participation-first-${width}.png`) });
        const readCount = reads.length; await notice.getByRole('button', { name: /후보 확인하기/ }).click();
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-one-on-one-section')), 'recommendations');
        assert.equal(mutations.length, 0); assert.equal(reads.length, readCount);
        const button = panel.locator('[data-one-on-one-section="recommendations"]').getByRole('button', { name: '매칭 요청 보내기', exact: true }).first();
        await button.click(); await button.waitFor(); assert.equal(await notice.count(), 1); assert.equal(sent, false);
        failSend = false; await button.click(); await notice.waitFor({ state: 'hidden' }); assert.equal(sent, true);
        assert.equal(mutations.filter(m => m.path.endsWith('/matches/auto')).length, 2);
        await page.reload(); await panel.getByText('상대의 응답을 기다리고 있어요.').waitFor(); assert.equal(await notice.count(), 0);
      }
      if (scenario === 'incoming') {
        const inbox = page.getByRole('region', { name: '받은 1:1 매칭 요청', exact: true });
        const header = inbox.getByRole('button', { name: /나에게 온 요청/ }); await header.waitFor();
        assert.ok((await header.innerText()).includes('다정한회원님이 요청을 보냈어요.'));
        await header.click(); assert.equal(await header.getAttribute('aria-expanded'), 'false');
        await header.getByText('프로필 보기', { exact: false }).click();
        assert.equal(await header.getAttribute('aria-expanded'), 'true'); assert.equal(mutations.length, 0);
        await inbox.screenshot({ path: path.join(output, `participation-incoming-${width}.png`) });
        await inbox.getByRole('button', { name: width === 360 ? '수락' : '거절', exact: true }).click();
        await inbox.waitFor({ state: 'hidden' }); assert.equal(mutations.length, 1);
        assert.equal(matches[0].contact_exchange_status, width === 360 ? 'awaiting_applicant_payment' : 'none');
      }
      if (scenario === 'deep-link') {
        const selected = panel.locator('#selected-one-on-one-match'); await selected.waitFor();
        assert.ok((await selected.innerText()).includes('다정한회원')); assert.equal(mutations.length, 0);
      }
      assert.equal(external, 0); assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(mutations.every(m => !/payments|refresh|contact/.test(m.path)));
      console.log(JSON.stringify({ scenario, width, passed: true, mutations: mutations.length })); passed++;
    } catch (error) { await page.screenshot({ path: path.join(output, `failed-participation-${scenario}-${width}.png`), fullPage: true }); throw error; }
    finally { release(); await context.close(); }
  }
  return passed;
};
