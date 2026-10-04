/* eslint-disable @typescript-eslint/no-require-imports */
// Runs actual route/helper/handler code against synthetic data. No network or mail.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
function load(file, deps = {}, extra = {}) {
  const exports = {};
  vm.runInNewContext(compile(read(file)), { exports, module: { exports }, URL, Date, Event, CustomEvent,
    console: { error() {}, log() {} }, process: { env: {} },
    fetch: () => { throw Error('No network'); },
    require: name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, ...extra });
  return exports;
}
function handler(file, name, context) {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) fn = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(fn, name);
  return vm.runInNewContext(compile('const fn = ' + fn + '; fn;'), { console, ...context });
}
const view = load('lib/notification-view.ts');
const nudge = load('lib/dating-1on1-contact-nudge.ts');
const notice = (id = 'notice', meta = {}, type = 'dating_application_received') => ({
  id, user_id: 'viewer', actor_id: 'actor', type, post_id: null, comment_id: null,
  meta_json: { application_id: 'app', ...meta }, is_read: false, created_at: '2026-10-01T12:00:00Z',
});
function fixture(options = {}) {
  const calls = [], writes = [];
  const tables = {
    notifications: options.notices ?? [notice()],
    profiles: [{ user_id: 'actor', nickname: '사이트 닉네임' }],
    dating_card_applications: options.open ?? [{ id: 'app', status: 'submitted' }],
    dating_paid_card_applications: options.paid ?? [],
    dating_1on1_match_proposals: options.matches ?? [],
    dating_1on1_contact_nudges: options.nudges ?? [],
    dating_1on1_cards: options.cards ?? [],
  };
  const db = { from(table) {
    const call = { table, filters: [] }; calls.push(call);
    let rows = [...(tables[table] ?? [])], head = false, patch;
    const q = {
      select(_columns, args = {}) { head = args.head; return q; },
      eq(k, v) { call.filters.push([k, v]); rows = rows.filter(row => row[k] === v); return q; },
      in(k, values) { call.ids = values; rows = rows.filter(row => values.includes(row[k])); return q; },
      order() { return q; }, limit(n) { call.limit = n; rows = rows.slice(0, n); return q; },
      update(value) { patch = value; return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (head && options.countError || options.failedTable === table) return { data: null, count: null, error: { message: 'synthetic failure' } };
        if (patch) { writes.push({ table, filters: call.filters }); rows.forEach(row => Object.assign(row, patch)); }
        return { data: head ? null : rows, count: head ? options.nullCount ? null : rows.length : null, error: null };
      }).then(resolve, reject); },
    }; return q;
  } };
  const api = load('app/api/notifications/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/public-profiles': { selectPublicProfiles: () => db.from('profiles').select('*') },
    '@/lib/dating-1on1-contact-nudge': nudge,
    '@/lib/notification-view': view,
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ client: db, user: options.anonymous ? null : { id: 'viewer' } }) },
    '@/lib/supabase/server': { createAdminClient: () => db },
  });
  return { api, calls, writes, tables };
}
const get = async (f, suffix = '') => { const res = await f.api.GET(new Request('https://test.invalid/api/notifications' + suffix)); return { res, body: await res.json() }; };
const patch = (f, body) => f.api.PATCH(new Request('https://test.invalid/api/notifications', { method: 'PATCH', body: JSON.stringify(body) }));
test('GET is owner-scoped, preserves Korean, and never caches private results', async () => {
  const f = fixture({ notices: [notice(), { ...notice('foreign'), user_id: 'other' }] });
  const { res, body } = await get(f);
  assert.equal(res.status, 200); assert.equal(body.items.length, 1); assert.equal(body.unread_count, 1);
  assert.equal(res.headers.get('cache-control'), 'private, no-store'); assert.match(body.items[0].body, /사이트 닉네임/);
  assert.equal(f.writes.length, 0);
});
for (const options of [{ countError: true }, { nullCount: true }]) test('failed count is unavailable, never a successful zero: ' + JSON.stringify(options), async () => {
  const { res, body } = await get(fixture(options)); assert.equal(res.status, 503); assert.equal(body.unread_count, undefined);
});
for (const [value, expected] of [['oops', 30], ['Infinity', 30], ['1.7', 1], ['-1', 1], ['9999', 100]]) test('bounded list limit: ' + value, async () => {
  const f = fixture(); await get(f, '?limit=' + value); assert.equal(f.calls[0].limit, expected);
});
for (const source of ['open', 'paid']) {
  test('deleted ' + source + ' acceptance cannot be revived by stale metadata', async () => {
    const f = fixture({ open: [], paid: [], notices: [notice('a', { source_kind: source, application_status: 'accepted', notification_title: '옛 수락', notification_body: '옛 내용' }, 'dating_application_accepted')] });
    const { body } = await get(f); assert.equal(body.items[0].title, '연결이 취소됐습니다'); assert.equal(body.items[0].link, '/mypage#' + (source === 'paid' ? 'paid' : 'open') + '-card-applied');
  });
  for (const first of ['accepted', 'rejected', 'canceled', 'missing']) test(source + ' group keeps remaining pending applications when first is ' + first, async () => {
    const rows = [{ id: 'other-app', status: 'submitted' }, ...(first === 'missing' ? [] : [{ id: 'app', status: first }])];
    const f = fixture({ [source]: rows, notices: [notice('a', { source_kind: source, application_ids: ['app', 'other-app', 'other-app'], reminder_kind: 'pending_72h', notification_title: '옛 알림', notification_body: '2건 대기' })] });
    const { body } = await get(f); assert.match(body.items[0].body, /1건이 아직 대기/); assert.equal(body.items[0].link, '/mypage#' + (source === 'paid' ? 'paid' : 'open') + '-card-received');
  });
}
test('completed group does not ask for another response', async () => {
  const { body } = await get(fixture({ open: [{ id: 'app', status: 'accepted' }], notices: [notice('a', { application_ids: ['app', 'deleted'], reminder_kind: 'pending_24h' })] }));
  assert.equal(body.items[0].title, '대기 중인 지원이 없습니다'); assert.doesNotMatch(body.items[0].body, /거절해 주세요/);
});
test('paid lookup failure does not hide or falsify independently loaded open status', async () => {
  const { body } = await get(fixture({ failedTable: 'dating_paid_card_applications', notices: [notice('open'), notice('paid', { source_kind: 'paid' })] }));
  assert.equal(body.items[0].title, '새 지원 도착'); assert.equal(body.items[1].title, '지원 상태 확인 필요');
});
test('same id in distinct tables cannot cross-contaminate status', async () => {
  const { body } = await get(fixture({ paid: [{ id: 'app', status: 'accepted' }], notices: [notice('open'), notice('paid', { source_kind: 'paid' })] }));
  assert.equal(body.items[0].title, '새 지원 도착'); assert.equal(body.items[1].title, '수락한 지원입니다');
});
test('large groups are chunked without losing pending members after index 200', async () => {
  const open = Array.from({ length: 205 }, (_, i) => ({ id: 'app-' + i, status: i === 204 ? 'submitted' : 'accepted' }));
  const f = fixture({ open, notices: [notice('group', { application_id: 'app-0', application_ids: open.map(row => row.id), reminder_kind: 'pending_24h' })] });
  const { body } = await get(f); assert.match(body.items[0].body, /1건이 아직/);
  assert.deepEqual(f.calls.filter(c => c.table === 'dating_card_applications').map(c => c.ids.length), [200, 5]);
});
test('oversized group fails visibly, never claims all applications gone', async () => {
  const f = fixture({ notices: [notice('group', { application_ids: Array.from({ length: 1001 }, (_, i) => 'large-' + i), reminder_kind: 'pending_24h' })] });
  const { body } = await get(f); assert.equal(body.items[0].title, '지원 상태 확인 필요');
  assert.equal(f.calls.filter(c => c.table === 'dating_card_applications').length, 0);
});
for (const type of ['dating_1on1_selected', 'dating_1on1_mutual', 'comment']) test('legacy 1:1 route is repaired on read for ' + type, async () => {
  const { body } = await get(fixture({ notices: [notice('n', { notification_title: '한글 요청', notification_body: '확인해 주세요', notification_route: '/dating/1on1' }, type)] }));
  assert.equal(body.items[0].link, '/community/dating/cards?tab=one_on_one');
});
test('legacy nudge uses the matching name, preserves Korean and safe destination', async () => {
  const f = fixture({ notices: [notice('n', { match_id: 'm', notification_type: 'dating_1on1_contact_nudge', notification_body: '첫 커피는 제가 살게요 ☕', notification_route: '/dating/1on1' }, 'comment')],
    matches: [{ id: 'm', source_card_id: 'sender', source_user_id: 'actor', candidate_card_id: 'receiver', candidate_user_id: 'viewer' }], cards: [{ id: 'sender', name: '매칭 이름' }] });
  const { body } = await get(f); assert.match(body.items[0].title, /매칭 이름님이/); assert.match(body.items[0].body, /☕/); assert.doesNotMatch(body.items[0].title, /사이트 닉네임/);
});
for (const link of ['//outside.invalid', '/\\outside.invalid', 'javascript:alert(1)']) test('server and client reject unsafe destinations ' + link, async () => {
  const { body } = await get(fixture({ notices: [notice('n', { notification_title: '안내', notification_body: '내용', notification_route: link }, 'comment')] }));
  assert.equal(body.items[0].link, null); assert.equal(view.notificationHref(link), null);
});
for (const body of [null, [], 'bad', {}, { mark_all: 'false' }, { mark_all: 1 }, { id: 123 }, { id: ' ' }]) test('invalid PATCH causes no writes ' + JSON.stringify(body), async () => {
  const f = fixture(); assert.equal((await patch(f, body)).status, 400); assert.equal(f.writes.length, 0);
});
for (const body of [{ id: 'notice' }, { mark_all: true }]) test('read writes only current user notifications ' + JSON.stringify(body), async () => {
  const f = fixture({ notices: [notice(), { ...notice('foreign'), user_id: 'other' }] });
  assert.equal((await patch(f, body)).status, 200); assert.equal(f.tables.notifications[0].is_read, true); assert.equal(f.tables.notifications[1].is_read, false);
  assert.ok(f.writes.every(write => write.filters.some(([key, value]) => key === 'user_id' && value === 'viewer')));
});
test('anonymous cannot list or mark any notification', async () => {
  const f = fixture({ anonymous: true }); assert.equal((await get(f)).res.status, 401); assert.equal((await patch(f, { mark_all: true })).status, 401); assert.equal(f.calls.length, 0);
});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
for (const name of ['markAllRead', 'markOneRead']) for (const ok of [true, false]) test(name + ' only successful acknowledgement invalidates header, including after navigation: ' + ok, async () => {
  const pending = deferred(), mounted = { current: true }; let invalidations = 0, localWrites = 0;
  const noop = () => {};
  const context = { mounted, markingAllRef: { current: false }, reading: { current: new Set() }, acknowledged: { current: new Set() }, unreadCount: 2, items: [],
    request: { cancel: noop }, setMarkingAll: noop, setActionError: noop, setLoading: noop, setReadingIds: noop,
    setItems: () => localWrites++, setUnreadCount: () => localWrites++,
    fetchClientJson: () => pending.promise, invalidateNotificationCount: () => invalidations++ };
  const run = handler('app/notifications/page.tsx', name, context)(notice());
  mounted.current = false; pending.resolve({ response: { ok }, body: { ok } }); await run;
  assert.equal(invalidations, ok ? 1 : 0); assert.equal(localWrites, 0);
});
test('notification navigation stays immediate and repairs old 1:1 link', () => {
  const hrefs = []; let reads = 0;
  handler('app/notifications/page.tsx', 'markReadAndGo', { markOneRead: () => { reads++; return new Promise(() => {}); }, notificationHref: view.notificationHref, router: { push: href => hrefs.push(href) } })({ link: '/dating/1on1' });
  assert.equal(reads, 1); assert.deepEqual(hrefs, ['/community/dating/cards?tab=one_on_one']);
});
const flush = () => new Promise(resolve => setImmediate(resolve));
test('actual header rejects old counts after read sync, refreshes on invalidation and ignores replies after sign-out', async () => {
  const window = new EventTarget(), document = new EventTarget(); document.visibilityState = 'visible';
  window.setInterval = () => 1; window.clearInterval = () => {};
  const counter = load('lib/notification-count.ts', {}, { window });
  const effects = [], state = [], requests = []; let stateIndex = 0, authListener, user = { id: 'viewer' };
  const Header = load('components/HeaderUserMenu.tsx', {
    react: { useEffect: fn => effects.push(fn), useMemo: fn => fn(), useState: value => { const i = stateIndex++; state[i] = value; return [value, next => { state[i] = next; }]; } },
    'react/jsx-runtime': require('react/jsx-runtime'), 'next/link': () => null,
    'next/navigation': { useRouter: () => ({ refresh() {} }) }, '@/lib/dating-onboarding-draft': { clearDatingDraft() {} },
    '@/lib/notification-count': counter,
    '@/lib/supabase/client': { createClient: () => ({ auth: { getUser: async () => ({ data: { user } }), onAuthStateChange: fn => { authListener = fn; return { data: { sub: undefined, subscription: { unsubscribe() {} } } }; } },
      from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { nickname: '테스트' } }) }) }) },
  }, { window, document, fetch: url => {
    if (url === '/api/admin/me') return Promise.resolve({ ok: true, json: async () => ({ isAdmin: false }) });
    const pending = deferred(); requests.push(pending); return pending.promise;
  } }).default;
  Header({ pathname: '/notifications' }); const cleanup = effects[0](); await flush();
  counter.publishNotificationCount(2); assert.equal(state[5], 2);
  requests[0].resolve({ ok: true, json: async () => ({ unread_count: 9 }) }); await flush(); assert.equal(state[5], 2);
  counter.invalidateNotificationCount(); await flush(); assert.equal(requests.length, 2);
  requests[1].resolve({ ok: true, json: async () => ({ unread_count: 1 }) }); await flush(); assert.equal(state[5], 1);
  counter.invalidateNotificationCount(); await flush();
  requests[2].resolve({ ok: true, json: async () => ({ unread_count: null }) }); await flush(); assert.equal(state[5], 1);
  counter.invalidateNotificationCount(); await flush(); user = null; authListener('SIGNED_OUT'); await flush();
  requests[3].resolve({ ok: true, json: async () => ({ unread_count: 10 }) }); await flush(); assert.equal(state[5], 0);
  cleanup();
});
for (const body of [{ data: { status: 'ok', id: 'ticket' } }, { data: [{ status: 'ok', id: 'ticket' }] }, { data: { status: 'error', details: { error: 'DeviceNotRegistered' } } }, { data: [] }, {}, null, { data: { status: 'ok' } }, { data: { status: 'ok', id: 'ticket' }, errors: [{ message: 'bad' }] }]) {
  test('push ticket acceptance, not HTTP alone: ' + JSON.stringify(body), async () => {
    let requests = 0;
    const send = load('lib/expo-push.ts', {}, { fetch: async (_url, init) => { requests++; assert.match(init.body, /한글 알림/); return { ok: true, json: async () => body }; } }).sendExpoPushToUser;
    const q = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { push_token: 'ExpoPushToken[synthetic]' }, error: null }) };
    const result = await send({ from: () => q }, 'viewer', { title: '한글 알림', body: '안녕하세요 ☕' });
    const ticket = Array.isArray(body?.data) ? body.data[0] : body?.data;
    assert.equal(result.sent, !!(ticket?.status === 'ok' && ticket.id && !body.errors)); assert.equal(requests, 1);
  });
}
test('new notifications and push share repaired route; fallback type still works', async () => {
  const inserts = [], pushes = [];
  const notify = load('lib/dating-notifications.ts', { '@/lib/notification-view': view, '@/lib/expo-push': { sendExpoPushToUser: async (_db, _id, payload) => { pushes.push(payload); return { sent: true }; } } }).notifyDatingUser;
  const db = { from: () => ({ insert: async row => { inserts.push(row); return { error: inserts.length === 1 ? { code: '23514', message: 'notifications_type_check' } : null }; } }) };
  const result = await notify(db, { userId: 'viewer', type: 'dating_1on1_selected', title: '새 요청', body: '확인해 주세요', route: '/dating/1on1', meta: { route: '//bad.invalid' } });
  assert.equal(result.stored, true); assert.equal(inserts[1].type, 'comment'); assert.equal(inserts[1].meta_json.notification_route, '/community/dating/cards?tab=one_on_one');
  assert.equal(pushes[0].data.route, '/community/dating/cards?tab=one_on_one');
});
