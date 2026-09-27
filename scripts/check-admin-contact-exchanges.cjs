/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const me = uid(1), peer = uid(2), stranger = uid(3), adminId = uid(4), cardA = uid(5), cardB = uid(6), matchId = uid(10);
const listFile = 'app/api/admin/users/[id]/contact-exchanges/route.ts';
const closeFile = 'app/api/admin/users/[id]/contact-exchanges/[matchId]/close/route.ts';
function fixture(count = 1, options = {}) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: uid(10 + i), source_user_id: me, candidate_user_id: peer,
    source_card_id: cardA, candidate_card_id: cardB, state: 'mutual_accepted', contact_exchange_status: 'approved',
    contact_exchange_approved_at: '2026-09-27T01:00:00+00:00', contact_exchange_paid_at: '2026-09-27T01:00:00+00:00',
    contact_exchange_paid_by_user_id: me, contact_exchange_approved_by_user_id: adminId, contact_exchange_note: 'existing payment reference',
    created_at: '2026-09-26T00:00:00.123456+00:00', updated_at: '2026-09-27T01:00:00+00:00',
  }));
  const tables = { dating_1on1_match_proposals: rows,
    dating_1on1_cards: [{ id: cardA, name: '내이름', phone: 'SECRET-A' }, { id: cardB, name: '상대이름', phone: 'SECRET-B' }],
    profiles: [{ user_id: me, nickname: '내닉네임', phone_verified: true }, { user_id: peer, nickname: '상대닉네임', phone_verified: true }],
    toss_test_payment_orders: [{ id: uid(30), product_ref_id: matchId, status: 'paid', amount: 20000 }], dating_1on1_contact_nudges: [],
  };
  const calls = [], notifications = [], audits = [];
  const admin = { from(table) {
    const q = { table, fields: '', filters: [], orders: [], limit: Infinity, start: 0 };
    const b = {};
    for (const method of ['select', 'eq', 'in', 'or', 'order', 'limit', 'range', 'update']) b[method] = (...args) => {
      if (method === 'select') q.fields = args[0];
      else if (method === 'order') q.orders.push(args);
      else if (method === 'limit') q.limit = args[0];
      else if (method === 'range') { q.start = args[0]; q.limit = args[1] - args[0] + 1; }
      else if (method === 'update') q.patch = args[0];
      else q.filters.push([method, ...args]);
      return b;
    };
    b.maybeSingle = () => { q.single = true; return b; };
    b.then = (yes, no) => Promise.resolve().then(() => {
      calls.push(structuredClone(q));
      const error = options.fail?.(q, tables); if (error) return { data: null, error };
      if (q.patch && options.beforeUpdate) options.beforeUpdate(q, tables);
      let result = (tables[table] ?? []).filter(row => q.filters.every(([method, key, value]) => {
        if (method === 'eq') return row[key] === value;
        if (method === 'in') return value.includes(row[key]);
        if (key.startsWith('source_user_id.eq.')) return key.split(',').some(part => { const [field, , id] = part.split('.'); return row[field] === id; });
        const cursor = key.match(/^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.([^,)]+)\)$/);
        assert.ok(cursor, 'unexpected filter ' + key);
        return row.created_at < cursor[1] || (row.created_at === cursor[2] && row.id < cursor[3]);
      }));
      if (q.patch) result.forEach(row => Object.assign(row, q.patch));
      for (const [key, order] of [...q.orders].reverse()) result.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (order.ascending ? 1 : -1));
      result = result.slice(q.start, q.start + q.limit).map(row => Object.fromEntries(q.fields.split(',').map(key => [key, row[key]])));
      return { data: q.single ? result[0] ?? null : result, error: null };
    }).then(yes, no);
    return b;
  } };
  return { admin, tables, calls, notifications, audits, options };
}
function load(file, db, options = {}) {
  const overrides = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/admin-route': { requireAdminRoute: async () => options.authStatus
      ? { ok: false, response: Response.json({ error: 'unauthorized' }, { status: options.authStatus }) }
      : { ok: true, admin: db.admin, user: { id: adminId, email: 'admin@example.invalid' } } },
    '@/lib/admin-audit': { recordAdminAuditEvent: async data => { db.audits.push(data); if (options.auditFail) throw Error('audit failed'); } },
    '@/lib/dating-notifications': { notifyDatingUser: async (_, input) => { db.notifications.push(input); if (options.notifyFail) throw Error('notification failed'); } },
    '@/lib/supabase/server': { createAdminClient: () => db.admin },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user: { id: options.viewer || me } }) },
    '@/lib/dating-blocks': { getDatingBlockedUserIds: async () => new Set() },
    '@/lib/dating-contact-blocks': {
      getDatingContactBlockMapForUsers: async () => new Map(),
      getDatingProfilePhoneMapForUsers: async () => new Map([[me, '+821000000001'], [peer, '+821000000002']]),
      isDatingContactPhoneBlockedPair: () => false, normalizeDatingContactPhone: value => value,
    },
    '@/lib/dating-1on1': {
      getDatingOneOnOneCardsByIds: async () => new Map([[cardA, { id: cardA, name: '내이름' }], [cardB, { id: cardB, name: '상대이름' }]]),
      getDatingOneOnOneCardPhonesByIds: async (_, ids) => { db.phoneIds = ids; return new Map(); },
    },
  };
  function compile(file) {
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith('@/')) {
        if (options.fulfillment && !['@/lib/admin-contact-exchanges', '@/lib/request-origin'].includes(name)) return {};
        return compile(name.slice(2) + '.ts');
      }
      return require(name);
    }, mod, mod.exports);
    return mod.exports;
  }
  return compile(file);
}
async function list(db, query = '', options = {}) {
  const response = await load(listFile, db, options).GET(new Request('https://local.invalid/api?' + query), { params: Promise.resolve({ id: options.userId || me }) });
  return { response, body: await response.json() };
}
async function close(db, options = {}) {
  const response = await load(closeFile, db, options).POST(new Request('https://local.invalid/api', {
    method: 'POST', headers: { host: 'local.invalid', origin: options.origin || 'https://local.invalid' },
  }), { params: Promise.resolve({ id: options.userId || me, matchId: options.matchId || matchId }) });
  return { response, body: await response.json() };
}

for (const authStatus of [401, 403]) test(`list and close reject auth ${authStatus} before DB access`, async () => {
  const db = fixture();
  assert.equal((await list(db, '', { authStatus })).response.status, authStatus);
  assert.equal((await close(db, { authStatus })).response.status, authStatus);
  assert.equal(db.calls.length, 0);
});
test('cross-origin close and invalid identifiers cannot reach the DB', async () => {
  const db = fixture();
  assert.equal((await close(db, { origin: 'https://attacker.invalid' })).response.status, 403);
  assert.equal((await close(db, { userId: 'bad,filter' })).response.status, 400);
  assert.equal((await close(db, { matchId: 'bad' })).response.status, 400);
  assert.equal((await list(db, '', { userId: 'bad' })).response.status, 400);
  assert.equal(db.calls.length, 0);
});
test('10-row keyset pagination, precision, ties, oldest exchanges, no duplicates or phone/image payload', async () => {
  const db = fixture(65); let query = '', seen = [];
  do {
    const { response, body } = await list(db, query);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.ok(body.items.length <= 10);
    assert.equal(body.items[0].own_name, '내이름'); assert.equal(body.items[0].counterpart_name, '상대이름');
    assert.equal(body.items[0].counterpart_nickname, '상대닉네임');
    assert.ok(!JSON.stringify(body).includes('SECRET')); assert.ok(!JSON.stringify(body).includes('photo'));
    seen.push(...body.items.map(item => item.id));
    const cursor = body.next_cursor;
    query = cursor ? new URLSearchParams({ before_id: cursor.id, before_created_at: cursor.created_at }).toString() : '';
  } while (query);
  assert.equal(seen.length, 65); assert.equal(new Set(seen).size, 65);
  assert.ok(db.calls.filter(q => q.table === 'dating_1on1_match_proposals').every(q => q.limit === 11));
  assert.ok(db.calls.filter(q => q.table !== 'dating_1on1_match_proposals').every(q => q.filters.find(f => f[0] === 'in')[2].length <= 20));
});
test('pagination does not skip older rows after closing a first-page item', async () => {
  const db = fixture(12), first = await list(db);
  const cursor = first.body.next_cursor;
  await close(db, { matchId: first.body.items[0].id });
  const second = await list(db, new URLSearchParams({ before_id: cursor.id, before_created_at: cursor.created_at }));
  assert.equal(second.body.items.length, 2); assert.equal(second.body.items[1].id, matchId);
});
test('member-specific list supports both roles and excludes unapproved/closed/other-member rows', async () => {
  const db = fixture(4), rows = db.tables.dating_1on1_match_proposals;
  rows[1].contact_exchange_status = 'awaiting_applicant_payment'; rows[2].state = 'admin_canceled';
  rows[3].source_user_id = stranger; rows[3].candidate_user_id = adminId;
  const result = await list(db, '', { userId: peer });
  assert.equal(result.body.items.length, 1); assert.equal(result.body.items[0].own_name, '상대이름');
  assert.equal(result.body.items[0].counterpart_name, '내이름');
});
for (const query of ['before_id=' + matchId, 'before_created_at=2026-09-27', 'before_id=bad&before_created_at=bad',
  new URLSearchParams({ before_id: matchId, before_created_at: '2026-01-01T00:00:00Z),state.eq.approved' }).toString()]) {
  test('invalid cursor is rejected: ' + query, async () => { const db = fixture(); assert.equal((await list(db, query)).response.status, 400); assert.equal(db.calls.length, 0); });
}
test('missing profile metadata still leaves exchange manageable', async () => {
  const db = fixture(); db.tables.dating_1on1_cards = []; db.tables.profiles = [];
  const result = await list(db); assert.equal(result.body.items.length, 1); assert.equal(result.body.items[0].counterpart_name, null);
});
for (const userId of [me, peer]) test('close from either participant, keep payment/phone/profile/history untouched: ' + userId, async () => {
  const db = fixture(2), before = structuredClone(db.tables);
  const result = await close(db, { userId });
  assert.equal(result.response.status, 200); assert.equal(result.body.already_closed, false);
  const after = db.tables.dating_1on1_match_proposals[0];
  assert.equal(after.state, 'admin_canceled'); assert.equal(after.contact_exchange_status, 'canceled');
  for (const key of ['contact_exchange_paid_at', 'contact_exchange_paid_by_user_id', 'contact_exchange_approved_at', 'contact_exchange_approved_by_user_id']) assert.equal(after[key], before.dating_1on1_match_proposals[0][key]);
  assert.ok(after.contact_exchange_note.startsWith('existing payment reference | ')); assert.ok(after.contact_exchange_note.includes(adminId));
  assert.deepEqual(db.tables.dating_1on1_match_proposals[1], before.dating_1on1_match_proposals[1]);
  for (const table of ['dating_1on1_cards', 'profiles', 'toss_test_payment_orders']) assert.deepEqual(db.tables[table], before[table]);
  assert.equal(db.notifications.length, 2); assert.deepEqual(db.notifications.map(n => n.userId).sort(), [me, peer].sort());
  assert.equal(db.audits.length, 1); assert.equal(db.audits[0].targetId, matchId);
  assert.equal((await list(db)).body.items.length, 1);
});
test('wrong member or missing match cannot close an exchange', async () => {
  const db = fixture(); assert.equal((await close(db, { userId: stranger })).response.status, 404);
  assert.equal((await close(db, { matchId: uid(999) })).response.status, 404);
  assert.equal(db.calls.filter(q => q.patch).length, 0);
});
for (const status of ['none', 'awaiting_applicant_payment', 'payment_pending_admin', 'canceled']) test('close refuses non-approved status ' + status, async () => {
  const db = fixture(); db.tables.dating_1on1_match_proposals[0].contact_exchange_status = status;
  assert.equal((await close(db)).response.status, 409); assert.equal(db.calls.filter(q => q.patch).length, 0);
});
test('close refuses rejected match even with inconsistent approved flag', async () => {
  const db = fixture(); db.tables.dating_1on1_match_proposals[0].state = 'candidate_rejected';
  assert.equal((await close(db)).response.status, 409);
});
test('simultaneous and repeated closes succeed only once, without duplicated notifications/audit', async () => {
  const db = fixture(); const results = await Promise.all([close(db), close(db)]);
  assert.ok(results.every(r => r.response.status === 200));
  assert.deepEqual(results.map(r => r.body.already_closed).sort(), [false, true]);
  assert.equal((await close(db)).body.already_closed, true);
  assert.equal(db.notifications.length, 2); assert.equal(db.audits.length, 1);
});
test('concurrent state change is not overwritten', async () => {
  const db = fixture(1, { beforeUpdate: (_, tables) => { tables.dating_1on1_match_proposals[0].state = 'candidate_rejected'; } });
  assert.equal((await close(db)).response.status, 409); assert.equal(db.tables.dating_1on1_match_proposals[0].state, 'candidate_rejected');
  assert.equal(db.notifications.length, 0);
});
test('DB read/update errors are explicit and do not report success', async () => {
  const readDB = fixture(1, { fail: () => Error('test read failure') });
  assert.equal((await list(readDB)).response.status, 500); assert.equal((await close(readDB)).response.status, 500);
  const writeDB = fixture(1, { fail: q => q.patch && Error('test update failure') });
  assert.equal((await close(writeDB)).response.status, 500); assert.equal(writeDB.tables.dating_1on1_match_proposals[0].contact_exchange_status, 'approved');
  assert.equal(writeDB.notifications.length, 0);
});
test('notification/audit outage cannot undo closure or turn a saved mutation into failure', async () => {
  const db = fixture(); assert.equal((await close(db, { auditFail: true, notifyFail: true })).response.status, 200);
  assert.equal(db.tables.dating_1on1_match_proposals[0].contact_exchange_status, 'canceled');
});
test('both participants stop receiving phone numbers from the real matches API after close; other exchanges remain open', async () => {
  const db = fixture(2);
  for (const viewer of [me, peer]) {
    const api = load('app/api/dating/1on1/matches/my/route.ts', db, { viewer });
    const before = await (await api.GET(new Request('https://local.invalid/api'))).json();
    assert.ok(before.items.find(row => row.id === matchId).counterparty_phone);
  }
  await close(db);
  for (const viewer of [me, peer]) {
    const api = load('app/api/dating/1on1/matches/my/route.ts', db, { viewer });
    const after = await (await api.GET(new Request('https://local.invalid/api'))).json();
    assert.equal(after.items.find(row => row.id === matchId).counterparty_phone, null);
    assert.ok(after.items.find(row => row.id !== matchId).counterparty_phone);
  }
});
test('a fulfilled payment cannot reopen the closed match', async () => {
  const db = fixture(); await close(db);
  const fulfillment = load('lib/dating-purchase-fulfillment.ts', db, { fulfillment: true });
  const writes = db.calls.filter(q => q.patch).length;
  await assert.rejects(fulfillment.grantOneOnOneContactExchange(db.admin, { matchId, userId: me }));
  assert.equal(db.calls.filter(q => q.patch).length, writes);
  assert.equal(db.tables.dating_1on1_match_proposals[0].contact_exchange_status, 'canceled');
});
