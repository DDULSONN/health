/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const path = require('node:path');
const currentKeys = ['totalUsers','adminUsers','phoneVerifiedUsers','swipeVisibleUsers','publicOpenCards','pendingOpenCards',
  'pendingOpenCardsMale','pendingOpenCardsFemale','totalOpenCardApplications','publicPaidCards','totalPaidCardApplications',
  'approvedOneOnOneCards','pendingOneOnOneCards','activeMoreView','activeCityView','openSupport','totalSupportInquiries',
  'answeredSupportTotal','pendingCertRequests','approvedCertRequests','pendingApplyCreditOrders','approvedApplyCreditOrders',
  'pendingSwipeSubscriptions','activeSwipeSubscriptions','totalOpenCardMatches','totalSwipeMatches','totalDatingMatches','todayAnsweredSupport'];
const featureKeys = ['new_users','open_card_created','open_card_applied','paid_card_created','paid_card_applied','one_on_one_created',
  'more_view_requested','city_view_requested','swipe_likes','swipe_matches','apply_credit_orders','support_inquiries','cert_requests','bodybattle_entries','bodybattle_votes'];

module.exports = async function adminCountsBrowser({ browser, origin, output }) {
  let passed = 0;
  for (const width of [360, 1280]) for (const scenario of ['counts', 'zero', 'unavailable', 'legacy', 'member']) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = []; let dashboardReads = 0, writes = 0, external = 0;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) { external++; await route.abort(); return; }
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      if (req.method() !== 'GET') { writes++; await route.fulfill({ status: 500, json: { error: 'Unexpected write' } }); return; }
      let body = { ok: true, items: [], cards: [], applications: [], loggedIn: true };
      if (url.pathname === '/api/mypage/summary') body = {
        profile: { email: 'admin-fixture@example.invalid', nickname: '관리자검증', phone_verified: true,
          nickname_changed_count: 0, nickname_change_credits: 0, swipe_profile_visible: true },
        account: { is_banned: false }, isAdmin: scenario !== 'member', weekly_win_count: 0, bodycheck_posts: [],
      };
      if (url.pathname === '/api/admin/site-dashboard') {
        dashboardReads++;
        const counts = scenario === 'zero' ? { total: 0, male: 0, female: 0 } : { total: dashboardReads === 1 ? 1234 : 1235, male: dashboardReads === 1 ? 1000 : 1001, female: 234 };
        body = { ok: true, generatedAt: new Date().toISOString(), note: '로컬 검증용 통계',
          current: { ...Object.fromEntries(currentKeys.map(key => [key, 0])),
            ...(scenario === 'legacy' ? {} : { activeOneOnOneProfiles: scenario === 'unavailable' ? null : counts }) },
          today: Object.fromEntries(featureKeys.map(key => [key, 0])), featureLabels: Object.fromEntries(featureKeys.map(key => [key, key])),
          todayTopFeatures: [], recent7d: [], averages: { openCardApplicationsPerPublicCard: 0, paidCardApplicationsPerApprovedCard: 0 },
        };
      }
      await route.fulfill({ json: body });
    });
    try {
      await page.goto(origin + '/mypage?section=admin');
      await page.getByLabel('마이페이지 메뉴', { exact: true }).waitFor();
      const card = page.getByText('현재 활성 1:1 프로필', { exact: true }).locator('..');
      if (scenario === 'member') {
        assert.equal(await card.count(), 0); assert.equal(dashboardReads, 0);
      } else {
        await card.waitFor(); await card.scrollIntoViewIfNeeded();
        if (scenario === 'counts') {
          assert.match(await card.innerText(), /남 1,000명/); assert.match(await card.innerText(), /여 234명/);
          await page.getByRole('button', { name: '운영 현황 새로고침', exact: true }).click();
          await card.getByText('남 1,001명', { exact: true }).waitFor();
          assert.equal(dashboardReads, 2);
          await card.screenshot({ path: path.join(output, `admin-active-counts-${width}.png`) });
        } else if (scenario === 'zero') assert.match(await card.innerText(), /남 0명[\s\S]*여 0명/);
        else { assert.match(await card.innerText(), /새로고침/); assert.ok(!(await card.innerText()).includes('0명')); }
        const box = await card.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      }
      assert.deepEqual(errors, []); assert.equal(writes, 0); assert.equal(external, 0);
      assert.ok(!(await page.locator('body').innerText()).includes('\ufffd'));
      passed++; console.log(JSON.stringify({ width, scenario, dashboardReads, passed: true }));
    } catch (error) {
      await page.screenshot({ path: path.join(output, `failed-admin-${width}-${scenario}.png`), fullPage: true });
      console.error({ errors, dashboardReads, output }); throw error;
    } finally { await context.close(); }
  }
  return passed;
};
