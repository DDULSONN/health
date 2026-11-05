/* eslint-disable @typescript-eslint/no-require-imports */
// Real home/My Page trees, synthetic owner/matches, no production calls.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async ({ browser, origin, output }) => {
  let passed = 0;
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  for (const surface of ['home', 'mypage']) for (const scenario of ['archived', 'held', 'mixed', 'new']) for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = [], writes = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    const own = { id: id(1), user_id: 'fixture-member', name: '내 프로필', sex: 'female', age: 29,
      height_cm: 165, region: '서울', status: 'rejected', archived: scenario === 'archived',
      admin_note: 'PRIVATE_MODERATION_NOTE', created_at: new Date().toISOString(), photo_signed_urls: [] };
    const profiles = scenario === 'new' ? [] : scenario === 'mixed' ? [{ ...own, id: id(2), status: 'approved', archived: false }, own] : [own];
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (req.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 403, json: { error: 'Read-only test' } }); }
      let body = { ok: true, items: [], cards: [], applications: [], loggedIn: true };
      switch (url.pathname) {
        case '/api/mypage/summary': body = { profile: { email: 'fixture@example.invalid', nickname: '검증회원', phone_verified: true, nickname_changed_count: 0, nickname_change_credits: 0, swipe_profile_visible: true }, account: { is_banned: false }, isAdmin: false, weekly_win_count: 0, bodycheck_posts: [] }; break;
        case '/api/dating/1on1/my': body = { items: profiles }; break;
        case '/api/dating/1on1/write-status': body = { canWrite: scenario === 'new', phoneVerified: true, writeStatus: scenario === 'new' ? null : profiles[0].status, activeRequestStatus: scenario === 'new' ? null : profiles[0].status }; break;
        case '/api/dating/1on1/matches/my': body = { items: scenario === 'new' ? [] : [{ id: id(50), source_card_id: own.id, role: 'source', state: 'mutual_accepted', contact_exchange_status: 'approved', contact_exchange_approved_at: new Date().toISOString(), counterparty_phone: '01000000000', counterparty_card: { id: id(51), user_id: 'other', name: '기존 교환 상대', age: 30, sex: 'male', region: '서울', height_cm: 180, job: '회사원', photo_signed_urls: [] } }] }; break;
        case '/api/dating/cards/viewer-sex': body = { status: 'resolved', viewerSex: 'female', targetSex: 'male', source: 'one_on_one', canSwitchSex: false, requiresSexSelection: false }; break;
        case '/api/dating/cards/queue-stats': body = { male: { public_count: 0, pending_count: 0, slot_limit: 45 }, female: { public_count: 0, pending_count: 0, slot_limit: 45 } }; break;
        case '/api/dating/cards/my/swipe-status': body = { outgoing_likes: [], incoming_likes: [], summary: { incoming_pending: 0, outgoing_pending: 0 } }; break;
        case '/api/dating/cards/write-enabled': body = { enabled: true }; break;
        case '/api/dating/apply-credits/status': body = { creditsRemaining: 5 }; break;
      }
      await route.fulfill({ json: body });
    });
    try {
      await page.goto(origin + (surface === 'home' ? '/community/dating/cards?tab=one_on_one' : '/mypage?section=matching&match=one_on_one'));
      if (scenario !== 'new') await page.getByText('01000000000', { exact: true }).waitFor();
      else if (surface === 'home') await page.getByRole('link', { name: /프로필|1:1 작성|1대1 작성/ }).first().waitFor();
      else await page.locator('#one-on-one-status').waitFor();
      const notice = page.getByRole('region', { name: '내 프로필 상태' });
      if (scenario === 'archived' || scenario === 'held') {
        await notice.getByText(scenario === 'archived' ? '내가 내린 프로필이에요' : '프로필 공개가 보류돼 있어요', { exact: true }).waitFor();
        if (surface === 'home') assert.equal(await notice.getByRole('link').getAttribute('href'), '/mypage?section=matching&match=one_on_one#one-on-one-status');
        else if (scenario === 'archived') assert.equal(await page.getByRole('button', { name: '프로필 다시 올리기', exact: true }).count(), 1);
        else assert.equal(await page.getByRole('button', { name: '프로필 다시 올리기', exact: true }).count(), 0);
      } else if (surface === 'home') assert.equal(await notice.count(), 0, 'active/new users do not see inactive guidance');
      assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE_MODERATION_NOTE'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(writes, [], 'guidance cannot mutate matches, credits, profiles or payments');
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      if (width === 390 && ['archived', 'held'].includes(scenario)) {
        await notice.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${surface}-${scenario}.png`) });
      }
      passed++;
    } catch (error) { throw new Error(`${surface}/${scenario}/${width}: ${error.message}`, { cause: error }); }
    finally { await context.close(); }
  }
  return passed;
};
