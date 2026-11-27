/* eslint-disable @typescript-eslint/no-require-imports */
// Real Home and MyPage controls against a local, isolated API fixture.
const assert = require('node:assert/strict');
const path = require('node:path');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const replacePath = '/api/dating/1on1/recommendations/replace';
const listPath = '/api/dating/1on1/recommendations/my';
const availabilityWait = 180_010;
const checkedThrough = '1795700000000';

module.exports = async ({ browser, origin, output }) => {
  let passed = 0;
  for (const surface of ['home', 'mypage']) for (const scenario of ['success', 'seen-fallback', 'core-outage', 'empty', 'limit', 'slow-down', 'stale', 'unknown', 'identity-change', 'access-lost', 'availability-stock', 'availability-reload', 'availability-identity', 'availability-ineligible']) {
    if (surface === 'mypage' && scenario === 'access-lost') continue;
    const width = scenario === 'empty' ? 1280 : 360;
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const own = { id: id(1), user_id: 'fixture-member', sex: 'female', name: '검증 프로필', age: 29, region: '서울', status: 'approved', created_at: new Date().toISOString() };
    const card = (n, name) => ({ ...own, id: id(n), user_id: id(n + 50), sex: 'male', name, age: 30, photo_signed_urls: [] });
    const old = card(2, '교체 대상'), other = card(3, '유지 후보'), added = card(4, '추가 추천 회원'), favorite = card(5, '찜한 추천 회원');
    if (surface === 'home' && scenario === 'success') {
      old.region = '부산 해운대구';
      other.age = 31;
      other.region = '서울 강남구';
    }
    const fresh = { ...card(6, '처음 보는 회원'), recommendation_region_widened: true };
    const fallback = card(10, '이전에 본 다른 회원');
    const matched = card(7, '연락처 유지 회원');
    const nextOwn = { ...own, id: id(8), user_id: 'another-fixture-member', name: '다른 계정' }, nextCandidate = card(9, '다른 계정 후보');
    const requests = [], errors = [];
    let substituted = false, reads = 0, posts = 0, online = scenario !== 'unknown', external = 0, newIdentity = false;
    const availabilityScenario = scenario.startsWith('availability-');
    let availabilityReads = 0, availabilityReady = scenario === 'availability-reload' || scenario === 'availability-identity';
    let releaseAvailability, startAvailability;
    const holdAvailability = new Promise(resolve => { releaseAvailability = resolve; });
    const availabilityStarted = new Promise(resolve => { startAvailability = resolve; });
    let releasePost, startPost;
    const holdPost = new Promise(resolve => { releasePost = resolve; });
    const postStarted = new Promise(resolve => { startPost = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    if (availabilityScenario) {
      await page.clock.install();
      await page.addInitScript(() => {
        let visibility = 'visible';
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
        window.fixtureSetVisibility = next => {
          visibility = next;
          document.dispatchEvent(new Event('visibilitychange'));
        };
        // Wait for the first reply to reach React before hiding the page;
        // otherwise aborting the request legitimately discards its cutoff.
        const readJson = Response.prototype.json;
        Response.prototype.json = function (...args) {
          const body = readJson.apply(this, args);
          if (this.headers.has('X-Jimtul-Candidate-Checked-Through')) {
            void body.then(() => queueMicrotask(() => {
              document.documentElement.dataset.fixtureAvailabilityBodyRead = 'true';
            }), () => {});
          }
          return body;
        };
      });
    }
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) { external++; await route.abort(); return; }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      requests.push([req.method(), url.pathname]);
      if (req.method() === 'GET' && url.pathname === replacePath) {
        assert.deepEqual(Object.fromEntries(url.searchParams), { source_card_id: own.id, generation_key: 'demo-generation', probe_candidate_id: old.id });
        assert.equal(req.headers()['x-jimtul-candidate-receipt'], 'demo-receipt');
        assert.equal(req.headers()['x-jimtul-candidate-checked-through'], availabilityReads > 0 ? checkedThrough : undefined);
        assert.equal(url.href.includes('demo-receipt'), false);
        availabilityReads++;
        startAvailability();
        if (scenario === 'availability-identity') await holdAvailability;
        return route.fulfill({ headers: { 'X-Jimtul-Candidate-Checked-Through': checkedThrough },
          json: { available: availabilityReady, generation_key: 'demo-generation', refresh_list: scenario === 'availability-reload' } }).catch(() => {});
      }
      if (req.method() !== 'GET') {
        if (url.pathname === '/api/dating/1on1/recommendations/impressions' || url.pathname.startsWith('/api/analytics/')) return route.fulfill({ json: { ok: true } });
        assert.equal(url.pathname, replacePath);
        assert.equal(req.method(), 'POST');
        assert.deepEqual(req.postDataJSON(), { source_card_id: own.id, candidate_card_id: old.id, generation_key: 'demo-generation', impression_ticket: 'demo-receipt' });
        posts++;
        startPost();
        await holdPost;
        if (scenario === 'empty') return route.fulfill({ status: 409, json: { code: 'NO_UNSEEN_CANDIDATE' } });
        if (scenario === 'limit') return route.fulfill({ status: 409, json: { code: 'SINGLE_REFRESH_LIMIT' } });
        if (scenario === 'slow-down') return route.fulfill({ status: 429, json: { code: 'SINGLE_REFRESH_SLOW_DOWN' } });
        if (scenario === 'stale') return route.fulfill({ status: 409, json: { code: 'SINGLE_REFRESH_STALE' } });
        if (scenario === 'identity-change') return route.fulfill({ json: { ok: true, changed: true } }).catch(() => {});
        substituted = true;
        if (scenario === 'unknown') return route.abort();
        return route.fulfill({ json: { ok: true, changed: true, ...(scenario === 'seen-fallback' ? { replacement_kind: 'seen_fallback' } : {}) } });
      }
      let body = { ok: true, items: [], cards: [], applications: [], loggedIn: true };
      switch (url.pathname) {
        case '/api/dating/cards/queue-stats': body = { male: { public_count: 0, pending_count: 0, slot_limit: 45 }, female: { public_count: 0, pending_count: 0, slot_limit: 45 } }; break;
        case '/api/mypage/summary': body = { profile: { email: 'local@example.invalid', nickname: '검증회원', phone_verified: true, swipe_profile_visible: true }, account: { is_banned: false } }; break;
        case '/api/dating/1on1/my': body = { items: [newIdentity ? nextOwn : own] }; break;
        case '/api/dating/1on1/write-status': body = { canWrite: false, phoneVerified: true, writeStatus: 'approved', activeRequestStatus: 'approved' }; break;
        case '/api/dating/1on1/matches/my':
          if (scenario === 'core-outage' && posts) return route.fulfill({ status: 503, json: { error: 'unrelated match core unavailable' } });
          body = { items: newIdentity ? [] : [{ id: id(101), source_card_id: own.id, role: 'source', state: 'mutual_accepted', contact_exchange_status: 'approved', counterparty_card: matched, counterparty_phone: '01000000000', contact_exchange_approved_at: new Date().toISOString() }] }; break;
        case '/api/dating/cards/viewer-sex': body = { status: 'resolved', viewerSex: 'female', targetSex: 'male', source: 'one_on_one', canSwitchSex: false }; break;
        case listPath:
          reads++;
          if (newIdentity) { body = { items: [{ source_card_id: nextOwn.id, source_card_status: 'approved', recommendations: [nextCandidate], refresh_limit: 2, refresh_remaining: 2, can_refresh: true }] }; break; }
          if (posts && scenario === 'access-lost') return route.fulfill({ status: 403, json: { error: 'fixture permission revoked' } });
          if (posts && !online) return route.fulfill({ status: 503, json: { error: 'offline fixture' } });
          body = { items: [{ source_card_id: own.id, source_card_status: 'approved', hides_enabled: false,
            recommendations: [substituted ? (scenario === 'seen-fallback' ? fallback : fresh) : old, other], admin_recommendations: [added], favorite_candidates: [favorite],
            // Extra/favorite intentionally included in the mock allowlist to verify the separate render gate.
            single_refresh_candidate_ids: substituted ? [] : [old.id, added.id, favorite.id],
            new_candidate_notice: availabilityScenario && scenario !== 'availability-ineligible' ? { state: 'waiting', new_candidate_count: 0 } : null,
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
      const replaceTip = page.getByRole('complementary', { name: '개별 후보 새로고침 안내' });
      const name = display => surface === 'home' ? page.getByText(display, { exact: true }) : page.getByText(`${display} / 30세 / 서울`, { exact: true });
      await replace.waitFor(); await quota.waitFor();
      assert.equal(await replace.count(), 1);
      assert.ok((await replace.boundingBox()).height >= 44);
      if (surface === 'home' && scenario === 'success') {
        await replaceTip.waitFor();
        assert.match(await replaceTip.innerText(), /이미 본 후보만 바꿔보세요/);
        assert.match(await replaceTip.innerText(), /전체 새로고침 횟수는 그대로예요/);
        const acknowledge = replaceTip.getByRole('button', { name: '확인', exact: true });
        assert.ok((await acknowledge.boundingBox()).height >= 44);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await replaceTip.screenshot({ path: path.join(output, 'single-candidate-feature-tip-mobile.png') });
        await acknowledge.click();
        await replaceTip.waitFor({ state: 'hidden' });
        assert.equal(posts, 0, 'dismissing the tip never replaces a candidate');
        const initialReads = reads;
        const options = page.getByText('후보 보기 조건', { exact: true });
        await options.click();
        await page.getByRole('checkbox', { name: '내 등록 지역에서 가까운 순' }).check();
        assert.equal(await name(other.name).evaluate((first, laterName) => {
          const second = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,p,span"))
            .find(node => node.textContent.trim() === laterName);
          return Boolean(second && (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING));
        }, old.name), true);
        await page.getByRole('spinbutton', { name: '최소 나이' }).fill('31');
        await page.getByRole('spinbutton', { name: '최대 나이' }).fill('31');
        await name(other.name).waitFor();
        await name(old.name).waitFor({ state: 'hidden' });
        await page.getByText('받은 후보 3명 중 1명 표시 · 새로고침 차감 없음', { exact: true }).waitFor();
        await quota.waitFor();
        assert.equal(posts, 0, 'display settings never swap or debit candidates');
        assert.equal(reads, initialReads, 'display settings never refetch recommendations');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.getByRole('button', { name: '조건 초기화' }).click();
        await name(old.name).waitFor();
        await page.reload();
        await replace.waitFor(); await quota.waitFor();
        assert.equal(await replaceTip.count(), 0, 'an acknowledged tip does not return for this member on reload');
      }
      if (surface === 'mypage') assert.equal(await replaceTip.count(), 0, 'feature tip is limited to the 1:1 home tab');
      if (availabilityScenario) {
        const stock = page.getByText('조건에 맞는 새 후보가 있어요', { exact: true });
        const checkNew = page.getByRole('button', { name: '새 후보 확인', exact: true });
        await page.clock.fastForward(60_000);
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        assert.equal(availabilityReads, 0, 'opening/focusing never skips the initial three-minute delay');
        await page.clock.fastForward(availabilityWait);
        if (scenario === 'availability-ineligible') {
          assert.equal(availabilityReads, 0, 'a repeated card alone does not start checks');
        } else {
          await availabilityStarted;
          if (scenario === 'availability-identity') {
            newIdentity = true;
            await page.evaluate(() => {
              sessionStorage.setItem('gymtools-fixture-viewer', 'another-fixture-member');
              window.dispatchEvent(new Event('gymtools-fixture-viewer-changed'));
            });
            await name(nextCandidate.name).waitFor();
            releaseAvailability();
            await page.clock.fastForward(availabilityWait);
            assert.equal(await stock.count(), 0);
            assert.equal(availabilityReads, 1);
          } else if (scenario === 'availability-reload') {
            await stock.waitFor();
            const before = reads;
            substituted = true;
            await checkNew.evaluate(el => { el.click(); el.click(); });
            await name(fresh.name).waitFor();
            assert.equal(reads, before + 1);
            assert.equal(await stock.count(), 0);
          } else {
            await page.locator('html[data-fixture-availability-body-read="true"]').waitFor({ state: 'attached' });
            assert.equal(await stock.count(), 0);
            await page.evaluate(() => window.fixtureSetVisibility('hidden'));
            availabilityReady = true;
            await page.clock.fastForward(availabilityWait);
            assert.equal(availabilityReads, 1, 'hidden document did not poll');
            await page.evaluate(() => window.fixtureSetVisibility('visible'));
            await stock.waitFor(); assert.equal(availabilityReads, 2);
            assert.equal(await checkNew.count(), 0, 'stock-only response does not open the canonical list');
            await page.clock.fastForward(3 * availabilityWait);
            assert.equal(availabilityReads, 2, 'positive notice stops polling');
            assert.equal(posts, 0);
            releasePost();
            await replace.click();
            await name(fresh.name).waitFor();
            assert.equal(posts, 1); assert.equal(await stock.count(), 0);
          }
        }
        assert.equal(posts, scenario === 'availability-stock' ? 1 : 0, 'GET probe and canonical read never issue a replacement');
        assert.deepEqual(errors, []); assert.equal(external, 0);
        passed++; console.log(`PASS single candidate ${surface} / ${scenario}: read-only availability until explicit swap`);
        continue;
      }
      const before = reads;
      await replace.evaluate(el => { el.click(); el.click(); });
      await page.getByRole('button', { name: '바꾸는 중…', exact: true }).waitFor();
      assert.equal(await quota.isDisabled(), true);
      if (scenario === 'identity-change') {
        await postStarted;
        newIdentity = true;
        await page.evaluate(() => {
          sessionStorage.setItem('gymtools-fixture-viewer', 'another-fixture-member');
          window.dispatchEvent(new Event('gymtools-fixture-viewer-changed'));
        });
        await name(nextCandidate.name).waitFor();
        const identityReads = reads;
        releasePost();
        await page.waitForTimeout(200);
        assert.equal(reads, identityReads, 'late old-account response must not reload under the new account');
        assert.equal(posts, 1); assert.equal(await replace.count(), 0);
        assert.equal(await replaceTip.count(), 0, 'no tip when the current account has no eligible candidate');
        assert.ok(!(await page.locator('body').innerText()).includes('01000000000'));
        assert.equal(await page.getByText('이 후보 한 명을 새 후보로 바꿨어요.', { exact: true }).count(), 0);
        assert.deepEqual(errors, []); assert.equal(external, 0);
        passed++; console.log(`PASS single candidate ${surface} / ${scenario}: old POST response isolated`);
        continue;
      }
      releasePost();
      if (scenario === 'access-lost') {
        await page.getByText('로그인 상태와 이용 권한을 다시 확인해 주세요.', { exact: true }).waitFor();
        assert.ok(!(await page.locator('body').innerText()).includes('01000000000'), '403 clears previously visible private contact');
        assert.equal(await page.getByText('이 후보 한 명을 새 후보로 바꿨어요.', { exact: true }).count(), 0);
        assert.equal(posts, 1); assert.deepEqual(errors, []); assert.equal(external, 0);
        passed++; console.log(`PASS single candidate ${surface} / ${scenario}: protected matches cleared`);
        continue;
      }
      if (scenario === 'success' || scenario === 'seen-fallback' || scenario === 'core-outage') {
        const repeat = scenario === 'seen-fallback';
        const freshFeedback = page.getByText('이 후보 한 명을 새 후보로 바꿨어요.', { exact: true });
        const feedback = repeat ? page.getByText('이미 본 분 중에서 나이와 지역을 고려해 다른 후보로 바꿨어요.', { exact: true }) : freshFeedback;
        await feedback.waitFor();
        await name((repeat ? fallback : fresh).name).waitFor();
        if (repeat) {
          assert.equal(await freshFeedback.count(), 0, 'a previously seen fallback must not be described as fresh');
          assert.equal(await page.getByText('조건에 맞는 새 후보가 있어요', { exact: true }).count(), 0);
          assert.equal(await replace.count(), 0, 'the replacement is not immediately replaceable again');
        } else await page.getByText('조금 더 넓은 지역의 후보예요.', { exact: true }).waitFor();
        await name(old.name).waitFor({ state: 'hidden' });
        assert.ok(reads > before);
        assert.ok(!requests.slice(requests.findIndex(([method, url]) => method === 'POST' && url === replacePath) + 1)
          .some(([, url]) => ['/api/dating/1on1/matches/my', '/api/dating/1on1/my', '/api/dating/1on1/write-status'].includes(url)),
        'replacing one candidate must not reread unrelated match, profile or registration status');
        if (scenario === 'success') await page.screenshot({ path: path.join(output, `single-candidate-${surface}-mobile.png`) });
      } else if (scenario === 'unknown') {
        const recovery = page.getByRole('button', { name: /명단 다시 불러오기 · 횟수 차감 없음|추천 후보 다시 불러오기 · 횟수 차감 없음/ }).first();
        await recovery.waitFor();
        await page.getByText(/교체 결과를 확인하지 못했어요/).first().waitFor();
        assert.ok((await page.locator('body').innerText()).includes('01000000000'), 'known match stays visible even while the candidate read fails');
        assert.equal(posts, 1);
        online = true;
        await recovery.click();
        await name(fresh.name).waitFor();
        assert.ok(!requests.slice(requests.findIndex(([method, url]) => method === 'POST' && url === replacePath) + 1)
          .some(([, url]) => ['/api/dating/1on1/matches/my', '/api/dating/1on1/my', '/api/dating/1on1/write-status'].includes(url)), 'read-only recovery after failure is recommendation-only');
      } else {
        const feedback = scenario === 'empty' ? '지금 보여드릴 다른 후보가 없어 현재 후보는 그대로예요.'
          : scenario === 'limit' ? '최근 24시간 동안 한 명씩 바꾸기를 모두 사용했어요. 현재 후보는 그대로예요.'
          : scenario === 'slow-down' ? '잠시 후 다시 눌러 주세요. 현재 후보는 그대로예요.' : '명단을 다시 불러왔어요. 현재 후보를 확인해 주세요.';
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
    } finally { releasePost(); releaseAvailability(); await context.close(); }
  }
  return passed;
};
