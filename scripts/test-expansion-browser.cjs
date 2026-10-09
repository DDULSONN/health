/* eslint-disable @typescript-eslint/no-require-imports */
// Invoked by the existing real-page fixture host with --expansion.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function expansionBrowser({ browser, origin, output }) {
  let passed = 0;
  for (const surface of ['home', 'mypage']) for (const width of [360, 1280]) {
    for (const scenario of ['success', 'disabled', 'empty', 'error', 'malformed', 'timeout', 'select', 'report', 'expiry']) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = [], alerts = [];
      let reads = 0, selected = 0, reports = 0, externals = 0;
      if (scenario === 'timeout') await page.addInitScript(() => {
        const original = window.setTimeout;
        window.setTimeout = (fn, delay, ...args) => original(fn, delay === 30000 ? 300 : delay, ...args);
      });
      if (scenario === 'expiry') await page.clock.install();
      const profile = { id: 'fixture-one', user_id: 'fixture-member', name: '검증 프로필', sex: 'female', age: 29, birth_year: 1998,
        height_cm: 165, job: '회사원', region: '서울', intro_text: '실제 회원이 아닌 로컬 검증용 프로필이에요.',
        strengths_text: '서로 배려해요.', preferred_partner_text: '대화가 잘 통하는 분', smoking: 'non_smoker',
        status: 'approved', created_at: new Date().toISOString(), photo_signed_urls: ['/fixture-photo.png', '/fixture-photo.png'] };
      const extra = Array.from({ length: 3 }, (_, i) => ({ ...profile, id: 'expanded-' + i, user_id: 'other-' + i, name: '확장 후보 ' + (i + 1), sex: 'male' }));
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.dismiss(); });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) { externals++; await route.abort(); return; }
        if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
        let body = { ok: true, items: [], cards: [], applications: [], loggedIn: true };
        if (req.method() !== 'GET') {
          assert.equal(req.method(), 'POST');
          const data = JSON.parse(req.postData());
          if (url.pathname === '/api/dating/1on1/recommendations/expand') {
            assert.deepEqual(data, { source_card_id: profile.id }); reads++;
            if (scenario === 'timeout') return;
            if (scenario === 'error') { await route.fulfill({ status: 503, json: { error: '추가 후보를 확인하지 못했어요.' } }); return; }
            body = { source_card_id: profile.id, day_key: '2026-10-09',
              expires_at: new Date(Date.now() + (scenario === 'expiry' ? 3000 : 86400000)).toISOString(),
              candidates: scenario === 'empty' ? [] : extra.filter(c => selected === 0 && reports === 0 || c.id !== 'expanded-0') };
            if (scenario === 'malformed') body.candidates = [null];
          } else if (url.pathname === '/api/dating/1on1/matches/auto') {
            assert.deepEqual(data, { source_card_id: profile.id, candidate_card_id: 'expanded-0' }); selected++;
          } else if (url.pathname === '/api/dating/user-reports') {
            assert.equal(data.target_type, 'one_on_one_card'); assert.equal(data.target_id, 'expanded-0');
            reports++; body = { ok: true, blocked: true, message: '신고가 접수됐습니다.' };
          } else throw new Error('Unexpected mutation: ' + url.pathname);
          await route.fulfill({ json: body }); return;
        }
        switch (url.pathname) {
          case '/api/dating/cards/queue-stats': body = { male: { public_count: 0, pending_count: 0, slot_limit: 45 }, female: { public_count: 0, pending_count: 0, slot_limit: 45 } }; break;
          case '/api/mypage/summary': body = { profile: { email: 'fixture@example.invalid', nickname: '검증회원', phone_verified: true, nickname_changed_count: 0, nickname_change_credits: 0, swipe_profile_visible: true }, account: { is_banned: false }, isAdmin: false, weekly_win_count: 0, bodycheck_posts: [] }; break;
          case '/api/dating/1on1/my': body = { items: [profile] }; break;
          case '/api/dating/1on1/write-status': body = { canWrite: false, phoneVerified: true, writeStatus: 'approved', activeRequestStatus: 'approved' }; break;
          case '/api/dating/1on1/recommendations/my': body = { items: [{ source_card_id: profile.id, source_card_status: 'approved',
            recommendations: [{ ...extra[0], id: 'main', name: '기본 추천' }], admin_recommendations: [], favorite_candidates: [],
            refresh_limit: 1, refresh_used_count: 0, refresh_remaining: 1, can_refresh: true, refresh_used_at: null,
            expansion_enabled: scenario !== 'disabled' }] }; break;
          case '/api/dating/cards/viewer-sex': body = { status: 'resolved', viewerSex: 'female', targetSex: 'male', source: 'one_on_one', canSwitchSex: false, requiresSexSelection: false }; break;
          case '/api/dating/cards/my/swipe-status': body = { outgoing_likes: [], incoming_likes: [], summary: { incoming_pending: 0, outgoing_pending: 0 } }; break;
          case '/api/dating/cards/write-enabled': body = { enabled: true }; break;
          case '/api/dating/apply-credits/status': body = { creditsRemaining: 5 }; break;
        }
        await route.fulfill({ json: body });
      });
      try {
        await page.goto(origin + (surface === 'home' ? '/community/dating/cards?tab=one_on_one' : '/mypage?section=matching&matching=one_on_one'));
        await page.getByText('기본 추천', { exact: false }).first().waitFor();
        assert.equal(reads, 0, 'no expansion read on page load');
        const panel = page.getByRole('region', { name: '후보 범위 넓히기' });
        if (scenario === 'disabled') assert.equal(await panel.count(), 0);
        else {
          const expand = panel.getByRole('button', { name: '후보 넓혀보기' });
          await expand.waitFor(); assert.ok((await expand.boundingBox()).height >= 44);
          await expand.evaluate(el => { el.click(); el.click(); });
          if (['error', 'malformed', 'timeout'].includes(scenario)) {
            await panel.getByRole('alert').waitFor(); assert.equal(await panel.locator('article').count(), 0);
            assert.equal(reads, 1); await panel.getByRole('button', { name: '닫고 다시 시도' }).click();
            await expand.waitFor(); assert.equal(await expand.isEnabled(), true);
          } else if (scenario === 'empty') {
            await panel.getByText(/오늘 더 보여드릴 후보가 없어요/).waitFor(); assert.equal(reads, 1);
          } else {
            await panel.getByText('확장 후보 1 / 29세 / 서울', { exact: true }).waitFor();
            assert.equal(await panel.locator('article').count(), 3); assert.equal(reads, 1);
            for (const img of await panel.locator('img').all()) {
              await img.scrollIntoViewIfNeeded(); await img.evaluate(el => el.decode());
              assert.ok(await img.evaluate(el => el.naturalWidth > 0 && el.naturalHeight > 0));
            }
            if (scenario === 'success') {
              await panel.scrollIntoViewIfNeeded();
              await page.screenshot({ path: path.join(output, `expansion-${surface}-${width}.png`), fullPage: true });
              await panel.getByRole('button', { name: '추가 후보 접기' }).click();
              assert.equal(await panel.locator('article').count(), 0); await expand.click();
              await panel.getByText('확장 후보 1 / 29세 / 서울', { exact: true }).waitFor(); assert.equal(reads, 2);
            } else if (scenario === 'select') {
              await panel.getByRole('button', { name: '매칭 요청 보내기' }).first().evaluate(el => { el.click(); el.click(); });
              await expand.waitFor(); assert.equal(selected, 1);
              await expand.click(); await panel.getByText('확장 후보 2 / 29세 / 서울', { exact: true }).waitFor();
              assert.equal(await panel.locator('article').count(), 2);
            } else if (scenario === 'report') {
              await panel.getByRole('button', { name: '확장 후보 1 신고' }).click();
              const dialog = page.getByRole('dialog', { name: '프로필 신고' }); await dialog.waitFor();
              await dialog.getByRole('combobox').selectOption({ index: 1 });
              await dialog.getByRole('button', { name: /신고.*차단|신고 접수|신고하기/ }).click();
              await dialog.getByRole('button', { name: '확인', exact: true }).click();
              await expand.waitFor(); assert.equal(reports, 1);
            } else if (scenario === 'expiry') {
              await page.clock.runFor(5000); await expand.waitFor(); assert.equal(await panel.locator('article').count(), 0);
            }
          }
        }
        assert.equal(externals, 0); assert.deepEqual(errors, []); assert.deepEqual(alerts, []);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.ok(!(await page.locator('body').innerText()).includes('\ufffd'));
        assert.equal(await page.getByRole('button', { name: /후보 새로고침 · 1회/ }).count(), 1);
        passed++; console.log(JSON.stringify({ surface, width, scenario, reads, selected, reports, passed: true }));
      } catch (e) {
        await page.screenshot({ path: path.join(output, `failed-expansion-${surface}-${width}-${scenario}.png`), fullPage: true });
        console.error({ surface, width, scenario, errors, output }); throw e;
      } finally { await context.close(); }
    }
  }
  return passed;
};
