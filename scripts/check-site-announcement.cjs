/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function evaluate(file, imports, globals = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
    name => Object.hasOwn(imports, name) ? imports[name] : require(name), mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const noticeContent = evaluate('lib/contact-price-update-notice.ts', {
  '@/lib/dating-contact-price': evaluate('lib/dating-contact-price.ts', {}),
});
const policyImports = { '@/lib/contact-price-update-notice': noticeContent };
const policy = evaluate('lib/site-announcement.ts', policyImports);
const notice = policy.SITE_ANNOUNCEMENT;
const start = Date.parse(notice.startsAt), end = Date.parse(notice.endsAt);
const key = `site-announcement:${notice.id}`;
function browser({ at = start + 1000, pathname = '/mypage', storage = new Map(), denied = false } = {}) {
  let time = at, open = false, pendingEffect, cleanup;
  const timers = new Map(), listeners = new Map();
  const navigations = [];
  let sequence = 0;
  const Clock = class extends Date { static now() { return time; } };
  const dom = {
    localStorage: {
      getItem: k => { if (denied) throw Error('Storage denied'); return storage.get(k) ?? null; },
      setItem: (k, v) => { if (denied) throw Error('Storage denied'); storage.set(k, v); },
    },
    setTimeout: (cb, delay) => { const id = ++sequence; timers.set(id, { cb, at: time + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener: (name, cb) => listeners.set(name, cb),
    removeEventListener: (name, cb) => { if (listeners.get(name) === cb) listeners.delete(name); },
  };
  const component = evaluate('components/PaymentMethodAnnouncement.tsx', {
    'react': { useState: () => [open, value => { open = value; }], useEffect: cb => { pendingEffect = cb; } },
    'next/navigation': { usePathname: () => pathname, useRouter: () => ({ push: url => { navigations.push({ url, acknowledged: storage.get(key), open }); } }) },
    '@/lib/site-announcement': evaluate('lib/site-announcement.ts', policyImports, { Date: Clock }),
    '@/components/dating/sharing/FriendRecommendationNotice': { default: 'test-notice' },
  }, { window: dom, document: dom, Date: Clock }).default;
  return {
    render: () => component(),
    mount: () => { component(); cleanup = pendingEffect(); },
    unmount: () => cleanup?.(),
    navigate: value => { cleanup?.(); pathname = value; component(); cleanup = pendingEffect(); },
    advance: value => {
      for (;;) {
        const next = [...timers].filter(([, t]) => t.at <= value).sort(([, a], [, b]) => a.at - b.at)[0];
        if (!next) break;
        const [id, timer] = next; timers.delete(id); time = timer.at; timer.cb();
      }
      time = value;
    },
    suspendUntil: value => { time = value; },
    event: name => listeners.get(name)?.(),
    timers, storage, navigations,
  };
}
function button(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'test-notice') return { props: { onClick: node.props.onClose } };
  if (node.type === 'button') return node;
  for (const child of [].concat(node.props?.children ?? [])) { const found = button(child); if (found) return found; }
  return null;
}

test('new Korean notice replaces the old release and has a fixed 48-hour window', () => {
  assert.equal(end - start, 48 * 3600000);
  assert.notEqual(notice.id, 'one-on-one-refresh-fixed-2026-09-08');
  assert.equal(notice.title, '친구 추천 기능 안내');
  assert.match(notice.message, /오픈카드나 1:1 후보/);
  assert.match(notice.message, /친구에게 추천/);
  assert.match(notice.message, /원치 않으면 설정에서 끌 수 있어요/);
  assert.equal(noticeContent.CONTACT_PRICE_UPDATE_NOTICE.priceLabel, '1:1 연락처 교환 · 10% 인하');
  assert.doesNotMatch(JSON.stringify(noticeContent.CONTACT_PRICE_UPDATE_NOTICE), /18,?000|20,?000/);
  assert.doesNotMatch(notice.message, /모든 회원|전부 새로운|100%/);
  assert.equal(/\uFFFD/.test(notice.title + notice.message), false);
  assert.equal(policy.isSiteAnnouncementActive(start - 1), false);
  assert.equal(policy.isSiteAnnouncementActive(start), true);
  assert.equal(policy.isSiteAnnouncementActive(end - 1), true);
  assert.equal(policy.isSiteAnnouncementActive(end), false);
});
test('rendered notice shows only the percentage, while actual checkout price remains unchanged', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const Component = evaluate('components/dating/ContactPriceUpdateNotice.tsx', {
    '@/lib/contact-price-update-notice': noticeContent,
  }).default;
  const html = renderToStaticMarkup(React.createElement(Component, { onClose() {} }));
  assert.match(html, /1:1 연락처 교환 · 10% 인하/);
  assert.doesNotMatch(html, /18,?000|20,?000|\d[\d,]*\s*원/);
  assert.match(html, /적용 이후 새로 생성하는 웹 결제부터 적용됩니다/);
  assert.equal(evaluate('lib/dating-contact-price.ts', {}).ONE_ON_ONE_CONTACT_PRICE_KRW, 18000);
});
test('new notice still appears after acknowledging the previous notice, but only once itself', () => {
  const storage = new Map([['site-announcement:contact-price-quality-update-2026-10', '1']]);
  const page = browser({ storage }); page.mount(); page.advance(start + 1450);
  assert.ok(page.render()); button(page.render()).props.onClick();
  assert.equal(page.render(), null); assert.equal(storage.get(key), '1');
  page.navigate('/dating/1on1'); page.advance(start + 2000); assert.equal(page.render(), null);
  const reload = browser({ storage }); reload.mount(); reload.advance(start + 2000); assert.equal(reload.render(), null);
});
test('site-wide update has a new acknowledgement and fixed expiry', () => {
  assert.equal(notice.id, 'friend-recommendation-2026-10-28');
  assert.equal(notice.endsAt, '2026-10-30T22:30:00+09:00');
  for (const pathname of ['/', '/landing', '/community', '/community/dating/cards', '/dating/1on1', '/mypage', '/chat', '/notifications', '/tools', '/1rm', '/protein']) {
    const page = browser({ pathname }); page.mount(); page.advance(start+1450);
    assert.ok(page.render(), pathname);
    const acknowledged = browser({ pathname, storage:new Map([[key,'1']]) });
    acknowledged.mount(); acknowledged.advance(start+1450); assert.equal(acknowledged.render(),null,pathname);
  }
});
test('site-wide notice never interrupts checkout, account recovery, verification or profile forms', () => {
  for (const pathname of ['/payments/success', '/payments/fail', '/login', '/signup', '/auth/callback', '/account-recovery',
    '/phone-verification', '/verify-email', '/onboarding/dating', '/dating/card/new', '/dating/paid/card-id/apply',
    '/community/write', '/community/post-id/edit', '/admin', '/mypage/admin/dating-1on1', '/api/dating/1on1/my', '/s', '/s/share-token']) {
    const page=browser({ pathname }); page.mount(); page.advance(start+1450);
    assert.equal(page.render(),null,pathname); assert.equal(page.timers.size,0,pathname);
  }
});

test('notice actions acknowledge before navigation and never change sharing preferences', () => {
  for (const [action, url] of [['onExplore', '/community/dating/cards'], ['onSettings', '/mypage?section=settings']]) {
    const page = browser(); page.mount(); page.advance(start + 1450);
    page.render().props[action]();
    assert.deepEqual(page.navigations, [{ url, acknowledged: '1', open: false }]);
    assert.equal(page.render(), null);
    assert.deepEqual([...page.storage], [[key, '1']]);
  }
});
test('expired visitors do not mount a notice or timers', () => {
  for (const at of [end, end + 86400000]) {
    const page = browser({ at }); page.mount(); assert.equal(page.render(), null); assert.equal(page.timers.size, 0);
  }
});
test('open dialog closes exactly at expiry without navigation or reload', () => {
  const page = browser({ at: end - 1000 }); page.mount(); page.advance(end - 550); assert.ok(page.render());
  page.advance(end); assert.equal(page.render(), null);
});
test('expiry during the initial display delay never briefly shows the notice', () => {
  const page = browser({ at: end - 100 }); page.mount(); page.advance(end + 1000); assert.equal(page.render(), null);
});
test('page opened before the release can display at the release time', () => {
  const page = browser({ at: start - 60000 }); page.mount(); page.advance(start - 1); assert.equal(page.render(), null);
  page.advance(start); assert.ok(page.render());
});
test('resuming a background tab after expiry hides the dialog even if timers were suspended', () => {
  const page = browser(); page.mount(); page.advance(start + 1450); assert.ok(page.render());
  page.suspendUntil(end + 1000); page.event('visibilitychange'); assert.equal(page.render(), null);
});
test('acknowledgement from another tab closes the open dialog', () => {
  const page = browser(); page.mount(); page.advance(start + 1450); assert.ok(page.render());
  page.storage.set(key, '1'); page.event('storage'); assert.equal(page.render(), null);
});
test('storage-disabled visitors still dismiss the notice during the current visit', () => {
  const page = browser({ denied: true }); page.mount(); page.advance(start + 1450);
  button(page.render()).props.onClick(); page.navigate('/dating/1on1'); page.advance(start + 3000);
  assert.equal(page.render(), null);
});
test('unrelated paths never display it, and navigation/unmount cleans up timers', () => {
  const page = browser({ pathname: '/payments/success' }); page.mount(); page.advance(start + 1450);
  assert.equal(page.render(), null); assert.equal(page.timers.size, 0);
  page.navigate('/community/dating/cards'); page.advance(start + 1900); assert.ok(page.render());
  page.navigate('/login'); assert.equal(page.render(), null); assert.equal(page.timers.size, 0);
  page.navigate('/mypage'); page.unmount(); assert.equal(page.timers.size, 0);
});

const incident = evaluate('lib/candidate-repeat-incident-notice.ts', {});
test('historical incident includes lapsed and removed profiles but never mere registrations or post-fix use', () => {
  const start='2026-03-26T13:21:30Z', end='2026-10-12T11:51:46Z';
  const cards=[
    {id:'old',user_id:'lapsed',created_at:'2026-04-01T00:00:00Z',status:'hidden',recommendation_refresh_used_at:'2026-04-02T00:00:00Z'},
    {id:'new',user_id:'signup-only',created_at:'2026-04-01T00:00:00Z',status:'approved',recommendation_refresh_used_at:null},
    {id:'fixed',user_id:'post-fix',created_at:'2026-04-01T00:00:00Z',status:'approved',recommendation_refresh_used_at:end},
    {id:'invalid',user_id:'invalid',created_at:'2026-04-03T00:00:00Z',status:'approved',recommendation_refresh_used_at:'2026-04-02T00:00:00Z'},
  ];
  const events=[
    {id:1,user_id:'legacy',card_id:'removed-profile',refreshed_at:'2026-07-16T00:00:00Z'},
    {id:1,user_id:'legacy',card_id:'removed-profile',refreshed_at:'2026-07-16T00:00:00Z'},
    {id:2,user_id:'wrong-owner',card_id:'old',refreshed_at:'2026-07-16T00:00:00Z'},
    {id:3,user_id:'bonus-only',card_id:'bonus',refreshed_at:'2026-07-16T00:00:00Z',compensation_campaign:'incident'},
    {id:4,user_id:'outside',card_id:'outside',refreshed_at:'2026-03-22T00:00:00Z'},
  ];
  const rows=incident.historicalRefreshEvidence(cards,events,start,end);
  assert.deepEqual(rows.map(r=>r.userId),['lapsed','legacy']);
  assert.equal(rows.find(r=>r.userId==='legacy').eventCount,1);
  assert.deepEqual(rows.find(r=>r.userId==='lapsed').legacyCardIds,['old']);
  assert.throws(()=>incident.historicalRefreshEvidence([],[],end,start));
});
test('same incident notices deduplicate across old campaigns and channels, not unrelated feature announcements', () => {
  for(const row of [
    {campaign_key:'nearby-variety-repair-notice-2026-10-12'}, {campaign_key:'nearby-variety-repair-notice-2026-10-12-sms'},
    {campaign_key:incident.REPEAT_INCIDENT_CAMPAIGN}, {subject:'[짐툴 문의 답변] 추천목록의 후보 반복 관련 안내'},
    {campaign_key:'one_on_one_outreach',subject:'(광고) 짐툴 1:1 후보 반복 노출 관련 개선 안내'},
  ]) assert.equal(incident.isPriorRepeatIncidentNotice(row),true);
  for(const subject of ['사진 업로드 오류 개선 안내','1:1 요청이 도착했어요','1:1, 하루 최대 3명의 후보를 더 확인해 보세요'])
    assert.equal(incident.isPriorRepeatIncidentNotice({subject}),false);
});
test('incident email distinguishes possible impact, preserves Korean and does not promise individual repair or rewards', () => {
  const text=incident.REPEAT_INCIDENT_BODY;
  assert.match(text,/가능성이 있는 이용자/); assert.match(text,/단정하는 것은 아닙니다/);
  assert.match(text,/실제로 화면에서 확인한 후보/); assert.match(text,/차감하지 않도록/);
  assert.match(text,/기존 매칭 요청·수락 내역/); assert.match(text,/브라우저의 페이지 새로고침/);
  assert.doesNotMatch(text,/할인|지원권|무료|둘러보|복귀|신규 가입|보상.*지급|회원님.*재추천.*완료/);
  assert.doesNotMatch(text,/\uFFFD|\u0000/);
  assert.equal(Buffer.from(text,'utf8').toString('utf8'),text);
});
