/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');
// Use the real server-side notice rule, not hardcoded metadata. Browser requests
// still stay in the local fixture and cannot reach production or write records.
const modules = new Map();
function load(name) {
  if (!name.startsWith('@/')) return require(name);
  if (modules.has(name)) return modules.get(name).exports;
  const mod = { exports: {} }; modules.set(name, mod);
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', name.slice(2) + '.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)(load, mod, mod.exports);
  return mod.exports;
}
const { getOneOnOneNewCandidateNotice } = load('@/lib/dating-1on1-new-candidate-notice');
module.exports = async function newCandidatesBrowser({ browser, origin, output }) {
  let passed = 0;
  for (const surface of ['home', 'mypage']) for (const width of [360, 1280]) {
    for (const scenario of ['waiting', 'arrives', 'ordinary', 'legacy', 'quota-empty', 'quota-empty-arrives',
      'disjoint-history', 'no-page-history', 'current-page-only', 'old-exposures']) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = []; let posts = 0, externals = 0, arrived = false;
      const at = Date.now(), day = 86400000, pageAt = at - 3600000;
      const profile = { id: 'fixture-one', user_id: 'fixture-member', name: '검증 프로필', sex: 'female', age: 29, birth_year: 1998,
        height_cm: 165, job: '회사원', region: '서울', intro_text: '실제 회원이 아닌 로컬 검증용 프로필이에요.',
        strengths_text: '서로 배려해요.', preferred_partner_text: '대화가 잘 통하는 분', smoking: 'non_smoker',
        status: 'approved', created_at: new Date(at - 14 * day).toISOString(), photo_signed_urls: ['/fixture-photo.png'] };
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
            const remaining = scenario.startsWith('quota-empty') ? 0 : 1;
            const recommendations = [{ ...profile, id: arrived ? 'new-candidate' : 'candidate', name: arrived ? '새로 등록한 후보' : '기존 후보', sex: 'male', region: '경기',
              created_at: arrived ? new Date(at - 1000).toISOString() : profile.created_at },
              ...['held-1','held-2'].map(id=>({...profile,id,name:`다른 후보 ${id}`,sex:'male'}))];
            const observationAt = scenario === 'current-page-only' ? pageAt : scenario === 'old-exposures' ? at - 8 * day : pageAt - day;
            const notice = getOneOnOneNewCandidateNotice({ source: profile, visible: recommendations, pageAt, nowMs: at,
              observations: scenario === 'ordinary' ? [] : ['candidate','held-1','held-2'].map(id=>({id,at:observationAt})),
              pages: scenario === 'no-page-history' ? undefined : [{at:pageAt-day,ids:['page-a']},{at:pageAt,ids:[scenario==='disjoint-history'?'page-b':'page-a']}] });
            body = { items: [{ source_card_id: profile.id, source_card_status: 'approved',
              ...(scenario === 'legacy' ? {} : { new_candidate_notice: notice }),
              recommendation_region_widened: true,
              recommendations,
              candidate_pool_count: 13, admin_recommendations: [], favorite_candidates: [], refresh_limit: 1, refresh_used_count: 1 - remaining,
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
        await page.getByText(/^기존 후보(?: \/|$)/).first().waitFor();
        const notice = page.getByTestId('new-candidate-notice');
        const ordinary = ['ordinary', 'legacy', 'current-page-only', 'old-exposures'].includes(scenario);
        if (ordinary) assert.equal(await notice.count(), 0);
        else {
          await notice.waitFor(); assert.equal(await notice.count(), 1);
          assert.match(await notice.innerText(), /다음에 후보를 볼 때 먼저/);
          assert.equal(await notice.evaluate(el => getComputedStyle(el).fontSize), '12px');
          assert.equal(await page.getByText(/아직 새로고침이 남아 있어요/).count(), 0);
          assert.equal(await page.getByText(/주변 새 후보가 적어 지역을 넓혔어요/).count(), 0);
          assert.equal(await page.getByRole('dialog').count(), 0);
          if (scenario === 'waiting') {
            await notice.scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(output, `new-candidate-${surface}-${width}.png`) });
          }
        }
        if (scenario.endsWith('arrives')) {
          arrived = true; await page.reload();
          await page.getByText(/^새로 등록한 후보(?: \/|$)/).first().waitFor();
          assert.match(await notice.innerText(), /새로 등록한 후보 1명.*횟수는 그대로/);
          await page.reload();
          await page.getByText(/^새로 등록한 후보(?: \/|$)/).first().waitFor();
          assert.equal(await notice.count(), 1);
        }
        if (scenario.startsWith('quota-empty')) assert.equal(await page.getByRole('button', { name: '다음 이용 대기', exact: true }).isDisabled(), true);
        assert.equal(posts, 0); assert.equal(externals, 0); assert.deepEqual(errors, []);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.ok(!(await page.locator('body').innerText()).includes('\ufffd'));
        passed++; console.log(JSON.stringify({ surface, width, scenario, posts, passed: true }));
      } catch (e) {
        await page.screenshot({ path: path.join(output, `failed-new-candidate-${surface}-${width}-${scenario}.png`), fullPage: true });
        console.error({ surface, width, scenario, errors, output }); throw e;
      } finally { await context.close(); }
    }
  }
  return passed;
};
