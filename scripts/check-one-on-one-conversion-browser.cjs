/* eslint-disable @typescript-eslint/no-require-imports */
// Real Home and 1:1 components. The router, accounts and all writes are local
// fixtures; the checkout deliberately returns a local order-review page.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('./test-browser-runtime.cjs');
const { start } = require('./preview-site-button-tone.cjs');

const home = '/community/dating/cards?tab=one_on_one';
const profileId = 'fixture-one';
const viewerId = 'fixture-member';
const shortId = (i) => `68586980-1c11-43f0-92eb-${String(i).padStart(12, '0')}`;
const matchId = shortId(901);
const incomingId = shortId(902);
const declinedId = shortId(903);
const href = `${home}&matchId=${matchId}#selected-one-on-one-match`;
const incomingHref = `${home}&matchId=${incomingId}#selected-one-on-one-match`;
const phone = '010-0000-0701';
const checkout = '/fixture-contact-checkout/review';
const noOverflow = async (page) =>
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow');

async function main() {
  const fixture = await start();
  let browser;
  const scenes = [];
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const stamp = new Date().toISOString();
      const previous = new Date(Date.now() - 60000).toISOString();
      const writes = [], remote = [], errors = [];
      let stage = 'recommendation';
      let authoritativeAccept = false;
      let incomingReads = 0;
      const candidate = (i) => ({
        id: shortId(i), user_id: shortId(i + 100), name: `검증 후보 ${i}`, status: 'approved',
        sex: 'male', age: 31 + i, birth_year: 1990, height_cm: 178, job: '회사원',
        region: i === 1 ? '서울 마포구' : '서울 강서구',
        intro_text: '퇴근 후 운동하는 시간을 좋아해요. ' + '대화가 잘 통하면 좋겠어요. '.repeat(12),
        strengths_text: '시간 약속을 잘 지켜요.', preferred_partner_text: '산책을 같이 하면 좋아요.',
        smoking: 'non_smoker', created_at: stamp, photo_signed_urls: ['/fixture-photo.svg', '/fixture-photo.svg'],
      });
      const candidates = [1, 2, 3, 4, 5].map(candidate);
      const first = candidates[0];
      const item = (id, state, contactStatus, card = first) => ({
        id, role: 'source', state, contact_exchange_status: contactStatus,
        source_card_id: profileId, source_user_id: viewerId, candidate_card_id: card.id, candidate_user_id: card.user_id,
        counterparty_card: card, created_at: stamp,
        candidate_responded_at: ['candidate_accepted', 'mutual_accepted'].includes(state) ? stamp : null,
        source_final_responded_at: state === 'mutual_accepted' ? stamp : null,
        contact_exchange_paid_at: ['approved', 'payment_pending_admin'].includes(contactStatus) ? stamp : null,
        contact_exchange_approved_at: contactStatus === 'approved' ? stamp : null,
        counterparty_phone: contactStatus === 'approved' ? phone : null,
      });
      const pending = [6, 7, 8, 9].map(i => item(shortId(900 + i), 'candidate_accepted', 'none', candidate(i)));
      const declined = {
        ...item(declinedId, 'mutual_accepted', 'awaiting_applicant_payment', candidate(10)),
        contact_nudge: { available: true, replies_available: true, sent_by_me: {
          id: shortId(905), created_at: previous, preset_key: 'contact_ready', message_text: '가상 메시지',
          reply: { created_at: stamp, preset_key: 'not_right_now', message_text: '지금은 어려울 것 같아요.' },
        } },
      };
      const incoming = (accepted = false) => ({
        ...item(incomingId, accepted ? 'mutual_accepted' : 'source_selected', accepted ? 'awaiting_applicant_payment' : 'none', candidate(11)),
        role: 'candidate', source_user_id: shortId(111), source_card_id: shortId(11),
        candidate_user_id: viewerId, candidate_card_id: profileId, action_required: !accepted,
      });
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== fixture.origin) { remote.push(url.origin); return route.abort(); }
        if (url.pathname === checkout) return route.fulfill({ contentType: 'text/html; charset=utf-8',
          body: '<!doctype html><html lang="ko"><meta charset="utf-8"><main><h1>테스트 주문 확인</h1><p>18,000원</p></main></html>' });
        if (req.method() !== 'GET' && !url.pathname.startsWith('/api/analytics/')) {
          const body = req.postDataJSON();
          writes.push({ method: req.method(), path: url.pathname, body });
          if (url.pathname === '/api/dating/1on1/matches/auto' && stage === 'recommendation') {
            stage = 'waiting';
            return route.fulfill({ json: { ok: true, id: matchId } });
          }
          if (url.pathname === '/api/payments/toss/create' && stage === 'mutual') {
            stage = 'payment_pending';
            return route.fulfill({ json: { ok: true, amount: 18000, checkoutUrl: checkout } });
          }
          if (url.pathname === `/api/dating/1on1/matches/${incomingId}` && body.action === 'candidate_accept' && stage === 'receiving') {
            if (!authoritativeAccept) return route.fulfill({ json: { ok: true } });
            stage = 'incoming_mutual';
            return route.fulfill({ json: { ok: true, item: incoming(true) } });
          }
          return route.fulfill({ status: 409, json: { error: 'Unexpected mutation in fixture' } });
        }
        if (url.pathname === '/api/dating/1on1/recommendations/my') {
          return route.fulfill({ json: { items: [{
            source_card_id: profileId, source_card_status: 'submitted',
            recommendations: (stage === 'recommendation' ? candidates : candidates.slice(1)),
            admin_recommendations: [], favorite_candidates: [], refresh_limit: 1,
            refresh_remaining: 1, refresh_used_count: 0, can_refresh: true,
          }] } });
        }
        if (url.pathname === '/api/dating/1on1/matches/my') {
          if (stage === 'receiving' || stage === 'incoming_mutual') {
            incomingReads++;
            return route.fulfill({ json: { items: [incoming(stage === 'incoming_mutual')] } });
          }
          const current = stage === 'recommendation' ? [] : [item(matchId,
            stage === 'waiting' ? 'source_selected' : 'mutual_accepted',
            { waiting: 'none', mutual: 'awaiting_applicant_payment', payment_pending: 'payment_pending_admin', approved: 'approved' }[stage])];
          if (stage === 'mutual') current[0].source_final_responded_at = previous;
          return route.fulfill({ json: { items: [...pending, ...(stage === 'mutual' ? [declined] : []), ...current] } });
        }
        if (url.pathname === '/api/dating/1on1/contact-intro-offer') {
          return route.fulfill({ json: { offer: null, instagramContactAvailable: true } });
        }
        return route.continue();
      });

      try {
        await page.goto(fixture.origin + home);
        const rec = page.locator('[data-one-on-one-section="recommendations"]');
        const profileCard = (card) => rec.locator('article').filter({ has: page.getByText(card.name, { exact: true }) });
        const request = profileCard(first).getByRole('button', { name: '매칭 요청 보내기', exact: true });
        await request.waitFor();
        assert.ok((await request.boundingBox()).height >= 44);
        for (const card of candidates.slice(0, 3)) assert.equal(await profileCard(card).isVisible(), true);
        assert.equal(await profileCard(candidates[3]).count(), 0, 'extra profiles are not mounted until requested');
        if (width === 390) await profileCard(first).screenshot({ path: path.join(fixture.output, 'conversion-candidate-card-390.png') });
        const expand = rec.getByRole('button', { name: width === 320 ? '전체 후보 펼치기' : '후보 2명 더 보기', exact: true });
        assert.equal(await expand.getAttribute('aria-expanded'), 'false');
        await expand.click();
        for (const card of candidates) assert.equal(await profileCard(card).isVisible(), true, `${card.name} remains reachable`);
        const visibleOrder = await rec.locator('article').evaluateAll(articles =>
          articles.map(article => article.innerText.match(/검증 후보 \d+/)?.[0]).filter(Boolean));
        assert.deepEqual(visibleOrder, candidates.map(card => card.name), 'show more preserves server rank');
        assert.equal(await rec.getByText(phone, { exact: true }).count(), 0);
        await noOverflow(page);
        if (width === 390) await rec.screenshot({ path: path.join(fixture.output, 'conversion-candidates-390.png') });
        assert.deepEqual(writes, [], 'browsing does not create a request, use refresh quota or pay');
        await request.click();
        await page.getByText(/검증 후보 1님에게 매칭 요청을 보냈어요/).waitFor();
        await request.waitFor({ state: 'hidden' });
        assert.deepEqual(writes, [{ method: 'POST', path: '/api/dating/1on1/matches/auto',
          body: { source_card_id: profileId, candidate_card_id: first.id } }]);
        assert.equal(await page.getByRole('button', { name: '연락처 교환하기', exact: true }).count(), 0,
          'a sent request is not a mutual match');
        assert.equal(await page.getByText(phone, { exact: true }).count(), 0);

        // The other user's separate acceptance arrives on the next genuine GET.
        stage = 'mutual';
        await page.reload();
        const next = page.locator('[data-one-on-one-section="next-steps"]');
        const nextLink = next.locator(`a[href="${href}"]`);
        await nextLink.waitFor();
        assert.equal(await next.locator('a[href*="matchId="]').first().getAttribute('href'), href,
          'an actual mutual match must not be buried behind earlier acceptances');
        assert.equal(writes.length, 1, 'reading next steps does not pay');
        const inlinePay = next.getByRole('button', { name: '연락처 교환하기', exact: true });
        assert.equal(await inlinePay.count(), 1, 'first actionable match is visible without an extra tap');
        const declinedRow = next.locator('article').filter({ has: page.locator(`a[href*="${declinedId}"]`) });
        assert.equal(await declinedRow.getByRole('button', { name: '연락처 교환하기', exact: true }).count(), 0,
          'a newer declining reply has a read path, not a promoted payment action');
        assert.equal(await declinedRow.getByRole('link', { name: /답장 확인/ }).count(), 1);
        if (width === 390) await next.screenshot({ path: path.join(fixture.output, 'conversion-next-390.png') });
        await nextLink.click();
        await page.waitForURL(fixture.origin + href);
        const focused = page.locator('#selected-one-on-one-match');
        const pay = focused.getByRole('button', { name: '연락처 교환하기', exact: true });
        await pay.waitFor();
        assert.equal(await inlinePay.count(), 0, 'a focused match does not duplicate its inline checkout in the shortcut');
        await focused.getByText(first.name, { exact: true }).waitFor();
        assert.ok((await pay.boundingBox()).height >= 44);
        assert.equal(await focused.getByText('18,000원', { exact: true }).count(), 1);
        assert.equal(await focused.getByText(phone, { exact: true }).count(), 0);
        assert.equal(writes.length, 1, 'navigating to a match does not pay');
        await noOverflow(page);
        if (width === 390) await focused.screenshot({ path: path.join(fixture.output, 'conversion-exchange-390.png') });
        const reviewRequested = page.waitForRequest(req => req.url() === fixture.origin + checkout && req.isNavigationRequest());
        await pay.click();
        await reviewRequested;
        await page.waitForURL(fixture.origin + checkout);
        assert.deepEqual(writes[1], { method: 'POST', path: '/api/payments/toss/create',
          body: { productType: 'one_on_one_contact_exchange', matchId } });
        assert.equal(await page.getByText(phone, { exact: true }).count(), 0);

        await page.goto(fixture.origin + href);
        await focused.getByText(first.name, { exact: true }).waitFor();
        assert.equal(await pay.count(), 0, 'a pending confirmation must not create another order');
        assert.equal(await focused.getByText(phone, { exact: true }).count(), 0);
        stage = 'approved';
        await page.reload();
        await focused.getByText(phone, { exact: true }).waitFor();
        assert.equal(await pay.count(), 0);
        assert.equal(writes.length, 2, 'only the explicit request and checkout were written to the local fixture');

        // A recipient accepting an incoming request gets a shortcut only
        // after the action result confirms an exchange-ready state for this id.
        stage = 'receiving';
        await page.goto(fixture.origin + home);
        const inbox = page.getByRole('region', { name: '받은 1:1 매칭 요청' });
        const accept = inbox.getByRole('button', { name: '수락', exact: true });
        const toastShortcut = page.getByRole('link', { name: '매칭 확인', exact: true });
        await accept.waitFor();
        assert.equal(await toastShortcut.count(), 0);
        const readsBefore = incomingReads;
        const nextRead = page.waitForResponse(res => res.url().endsWith('/api/dating/1on1/matches/my'));
        await accept.click();
        await nextRead;
        await accept.waitFor();
        assert.ok(incomingReads > readsBefore);
        assert.equal(await toastShortcut.count(), 0, 'a successful request with no authoritative item cannot show mutual acceptance');
        authoritativeAccept = true;
        await accept.click();
        await toastShortcut.waitFor();
        assert.ok((await toastShortcut.boundingBox()).height >= 44);
        assert.equal(await toastShortcut.getAttribute('href'), incomingHref);
        const acceptedPost = { method: 'POST', path: `/api/dating/1on1/matches/${incomingId}`, body: { action: 'candidate_accept' } };
        assert.deepEqual(writes.slice(2), [acceptedPost, acceptedPost]);
        if (width === 390) await toastShortcut.locator('..').screenshot({ path: path.join(fixture.output, 'conversion-accept-toast-390.png') });
        await toastShortcut.click();
        await page.waitForURL(fixture.origin + incomingHref);
        await focused.getByText(candidate(11).name, { exact: true }).waitFor();
        await pay.waitFor();
        assert.equal(await toastShortcut.count(), 0);
        assert.equal(await focused.getByText(phone, { exact: true }).count(), 0);
        assert.equal(writes.length, 4, 'the toast’s navigation does not submit an exchange');
        assert.deepEqual(errors, []);
        assert.deepEqual(remote, []);
        await noOverflow(page);
        scenes.push({ width, requests: 1, acceptanceChecks: 2, simulatedCheckouts: 1, realCharges: 0 });
      } finally { await context.close(); }
    }
    console.log(JSON.stringify({ scenes, screenshots: fixture.output }));
  } finally { await browser?.close(); await fixture.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
