/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const me = uid(1), peer = uid(2), stranger = uid(3), threadId = uid(10), appId = uid(20), cardId = uid(30), ownCardId = uid(31);
// Verified against production using SELECT ... LIMIT 0 (no member rows).
// A loose fixture used to silently accept dating_cards.intro_text, which does not exist.
const schema = Object.fromEntries(Object.entries({
  dating_chat_threads: 'id,source_kind,source_id,user_a_id,user_b_id,status,user_a_hidden_at,user_b_hidden_at,last_message_at,last_message_preview,created_at',
  dating_chat_messages: 'id,thread_id,sender_id,receiver_id,content,is_read,created_at',
  profiles: 'user_id,nickname,is_banned',
  dating_card_applications: 'id,card_id,applicant_user_id,status,created_at,applicant_display_nickname,age,region,height_cm,job,training_years,intro_text,photo_paths',
  dating_paid_card_applications: 'id,paid_card_id,applicant_user_id,status,created_at,applicant_display_nickname,age,region,height_cm,job,training_years,intro_text,photo_paths',
  dating_cards: 'id,owner_user_id,display_nickname,age,region,height_cm,job,training_years,strengths_text,ideal_type,photo_visibility,photo_paths,blur_paths,blur_thumb_path,status',
  dating_paid_cards: 'id,user_id,nickname,age,region,height_cm,job,training_years,intro_text,strengths_text,ideal_text,photo_visibility,photo_paths,blur_thumb_path,status,expires_at',
  dating_card_swipe_matches: 'id,user_a_id,user_b_id,user_a_card_id,user_b_card_id,created_at',
}).map(([table, columns]) => [table, new Set(columns.split(','))]));
function database(initial, fail) {
  const tables = structuredClone(initial), calls = [];
  const admin = { from(table) {
    const q = { table, fields: '', filters: [], orders: [], limit: Infinity };
    const b = {};
    for (const method of ['select', 'eq', 'gt', 'in', 'or', 'order', 'limit']) b[method] = (...args) => {
      if (method === 'select') q.fields = args[0];
      else if (method === 'order') q.orders.push(args);
      else if (method === 'limit') q.limit = args[0];
      else q.filters.push([method, ...args]);
      return b;
    };
    b.maybeSingle = () => { q.single = true; return b; };
    b.then = (yes, no) => Promise.resolve().then(() => {
      calls.push(structuredClone(q));
      const missing = q.fields.split(',').map(field => field.trim()).find(field => !schema[table]?.has(field));
      if (missing) return { data: null, error: { code: '42703', message: `column ${table}.${missing} does not exist` } };
      const error = fail?.(q); if (error) return { data: null, error };
      let rows = (tables[table] ?? []).filter(row => q.filters.every(([method, key, value]) => {
        if (method === 'eq') return row[key] === value;
        if (method === 'gt') return row[key] > value;
        if (method === 'in') return value.includes(row[key]);
        if (key.startsWith('user_a_id.eq.')) return key.split(',').some(value => { const [field, , id] = value.split('.'); return row[field] === id; });
        const match = key.match(/^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.([^,)]+)\)$/);
        assert.ok(match, 'unexpected or: ' + key);
        return row.created_at < match[1] || (row.created_at === match[2] && row.id < match[3]);
      }));
      for (const [key, options] of [...q.orders].reverse()) rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options.ascending ? 1 : -1));
      rows = rows.slice(0, q.limit).map(row => Object.fromEntries(q.fields.split(',').map(key => [key, row[key]])));
      return { data: q.single ? rows[0] ?? null : rows, error: null };
    }).then(yes, no);
    return b;
  } };
  return { admin, tables, calls };
}
function load(file, db, options = {}) {
  const cache = new Map(), overrides = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user: options.noUser ? null : { id: options.userId ?? me } }) },
    '@/lib/supabase/server': { createAdminClient: () => db.admin },
    '@/lib/dating-blocks': { hasDatingBlockBetween: async () => { if (options.blockError) throw Error('block lookup failed'); return !!options.blocked; } },
    '@/lib/dating-contact-blocks': { hasDatingContactBlockBetween: async () => !!options.contactBlocked },
  };
  function compile(file) {
    if (cache.has(file)) return cache.get(file);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => overrides[name] ?? (name.startsWith('@/') ? compile(name.slice(2) + '.ts') : require(name)), loaded, loaded.exports);
    cache.set(file, loaded.exports); return loaded.exports;
  }
  return compile(file);
}
function initial(kind = 'open', owner = false) {
  const card = { id: cardId, owner_user_id: owner ? me : peer, user_id: owner ? me : peer, status: kind === 'paid' ? 'approved' : 'public', nickname: '상대 카드', display_nickname: '상대 카드', age: 29, region: '서울', height_cm: 170, job: '직장인', training_years: 2, intro_text: '한글 소개입니다', strengths_text: '대화', ideal_type: '다정함', ideal_text: '다정함', photo_visibility: 'blur', photo_paths: ['cards/' + peer + '/raw/a.jpg'], blur_paths: ['cards/' + peer + '/blur/a.webp'], blur_thumb_path: 'cards/' + peer + '/blur/a.webp', phone: 'never-return', email: 'never-return' };
  const application = { id: appId, card_id: cardId, paid_card_id: cardId, applicant_user_id: owner ? peer : me, status: 'accepted', applicant_display_nickname: '지원한 상대', age: 27, region: '인천', height_cm: 165, job: '회사원', training_years: 1, intro_text: '지원자 소개', photo_paths: ['applications/' + peer + '/a.jpg'], created_at: '2026-09-27T00:00:00Z', phone: 'never-return' };
  card.expires_at = '2099-01-01T00:00:00Z';
  const openCard = { ...card };
  delete openCard.intro_text;
  return { profiles: [{ user_id: me, nickname: '내 계정', is_banned: false }, { user_id: peer, nickname: '상대 계정', is_banned: false }],
    dating_chat_threads: [{ id: threadId, source_kind: kind, source_id: appId, user_a_id: me, user_b_id: peer, status: 'open', user_a_hidden_at: null, user_b_hidden_at: null }],
    dating_cards: [openCard, { ...openCard, id: ownCardId, owner_user_id: me }], dating_paid_cards: [card],
    dating_card_applications: [application], dating_paid_card_applications: [application],
    dating_card_swipe_matches: [{ id: appId, user_a_id: me, user_b_id: peer, user_a_card_id: ownCardId, user_b_card_id: cardId }],
    dating_chat_messages: Array.from({ length: 125 }, (_, i) => ({ id: uid(1000 + i), thread_id: threadId, sender_id: peer, receiver_id: me, content: '대화 ' + i, is_read: false, created_at: '2026-09-27T00:00:00.123456+00:00' })),
  };
}
async function get(db, file, params, options) {
  const response = await load(file, db, options).GET(new Request('https://local.invalid/api?' + params));
  return { response, body: await response.json() };
}
const historyRoute = 'app/api/dating/chat/thread/route.ts', profileRoute = 'app/api/dating/chat/profile/route.ts';
test('latest 50, tied timestamps, every older page and legacy compatibility', async () => {
  const db = database(initial()); let cursor = '', seen = [];
  do {
    const { response, body } = await get(db, historyRoute, `thread_id=${threadId}&paged=1${cursor ? '&before=' + cursor : ''}`);
    assert.equal(response.status, 200); assert.ok(body.messages.length <= 50); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    seen = [...body.messages.map(row => row.id), ...seen]; cursor = body.pagination.has_more ? body.pagination.older_cursor : '';
  } while (cursor);
  assert.deepEqual(seen, db.tables.dating_chat_messages.map(row => row.id)); assert.equal(new Set(seen).size, 125);
  assert.ok(db.calls.filter(q => q.table === 'dating_chat_messages' && !q.single).every(q => q.limit === 51));
  const legacy = await get(db, historyRoute, `thread_id=${threadId}`); assert.equal(legacy.body.messages.length, 125); assert.equal(legacy.body.pagination, undefined);
});
test('new messages between older-page requests do not shift offsets or skip messages', async () => {
  const db = database(initial()); const first = await get(db, historyRoute, `thread_id=${threadId}&paged=1`);
  db.tables.dating_chat_messages.push({ ...db.tables.dating_chat_messages[0], id: uid(9999), created_at: '2026-09-28T00:00:00Z' });
  const older = await get(db, historyRoute, `thread_id=${threadId}&paged=1&before=${first.body.pagination.older_cursor}`);
  assert.deepEqual(older.body.messages.map(row => row.id), db.tables.dating_chat_messages.slice(25, 75).map(row => row.id));
});
for (const kind of ['noUser', 'outsider', 'hidden', 'foreign-cursor', 'injection']) test('history rejects ' + kind, async () => {
  const data = initial(), options = kind === 'noUser' ? { noUser: true } : kind === 'outsider' ? { userId: stranger } : {};
  if (kind === 'hidden') data.dating_chat_threads[0].user_a_hidden_at = '2026-09-27';
  if (kind === 'foreign-cursor') data.dating_chat_messages.push({ ...data.dating_chat_messages[0], id: uid(8888), thread_id: uid(99) });
  const db = database(data); const before = kind === 'foreign-cursor' ? uid(8888) : kind === 'injection' ? 'x),id.gt.a' : '';
  const { response } = await get(db, historyRoute, `thread_id=${threadId}&paged=1&before=${encodeURIComponent(before)}`, options);
  assert.ok([400, 401, 404].includes(response.status)); assert.equal(db.calls.filter(q => q.table === 'dating_chat_messages' && !q.single).length, 0);
});
test('empty and exact-sized history has truthful continuation', async () => {
  for (const count of [0, 1, 50, 51]) {
    const data = initial(); data.dating_chat_messages.length = count;
    const { body } = await get(database(data), historyRoute, `thread_id=${threadId}&paged=1`);
    assert.equal(body.messages.length, Math.min(count, 50)); assert.equal(body.pagination.has_more, count > 50);
  }
});
for (const source of ['open', 'paid', 'swipe']) for (const owner of source === 'swipe' ? [false] : [false, true]) test(`authorized ${source} profile, owner=${owner}`, async () => {
  const db = database(initial(source, owner)); const { response, body } = await get(db, profileRoute, `thread_id=${threadId}`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(body.profile.name, owner ? '지원한 상대' : '상대 카드');
  assert.equal(body.profile.intro_text, owner ? '지원자 소개' : source === 'paid' ? '한글 소개입니다' : null);
  if (!owner) {
    assert.equal(body.profile.strengths_text, '대화');
    assert.equal(body.profile.ideal_type, '다정함');
  }
  assert.ok(!JSON.stringify(body).includes('never-return')); assert.ok(!('phone' in body.profile)); assert.ok(!('instagram_id' in body.profile));
  assert.equal(body.profile.photo_urls.length, 1); assert.ok(body.profile.photo_urls[0].startsWith('/i/signed/'));
  if (!owner) assert.ok(body.profile.photo_urls.every(url => url.includes('/blur/') && !url.includes('/raw/')));
  assert.ok(db.calls.every(q => !q.fields.split(',').some(field => ['phone', 'phone_e164', 'email', 'instagram_id'].includes(field))));
});
test('schema fixture rejects nonexistent open-card intro even with no rows', async () => {
  const result = await database({ dating_cards: [] }).admin.from('dating_cards').select('id,intro_text').limit(0);
  assert.equal(result.error?.code, '42703');
});
for (const source of ['open', 'swipe']) test(`${source} profile works without intro_text for both chat entry modes`, async () => {
  for (const started of [false, true]) {
    const data = initial(source);
    if (!started) data.dating_chat_threads = [];
    const db = database(data);
    const params = started ? `thread_id=${threadId}` : `source_kind=${source}&source_id=${appId}`;
    const { response, body } = await get(db, profileRoute, params);
    assert.equal(response.status, 200);
    assert.equal(body.profile.intro_text, null);
    assert.equal(body.profile.strengths_text, '대화');
    assert.equal(body.profile.ideal_type, '다정함');
    assert.ok(db.calls.filter(q => q.table === 'dating_cards').every(q => !q.fields.split(',').includes('intro_text')));
  }
});
test('swipe reverse participant sees their peer card without intro_text', async () => {
  const db = database(initial('swipe'));
  const { response, body } = await get(db, profileRoute, `thread_id=${threadId}`, { userId: peer });
  assert.equal(response.status, 200);
  assert.equal(body.profile.intro_text, null);
  assert.ok(db.calls.some(q => q.table === 'dating_cards' && q.filters.some(([op, key, value]) => op === 'eq' && key === 'id' && value === ownCardId)));
});
for (const kind of ['noUser', 'outsider', 'hidden', 'closed', 'canceled', 'deleted', 'banned', 'blocked', 'contactBlocked', 'blockError', 'mismatched-peer']) test('profile denies ' + kind, async () => {
  const data = initial(), options = {};
  if (kind === 'noUser') options.noUser = true;
  if (kind === 'outsider') options.userId = stranger;
  if (kind === 'hidden') data.dating_chat_threads[0].user_a_hidden_at = '2026-09-27';
  if (kind === 'closed') data.dating_chat_threads[0].status = 'closed';
  if (kind === 'canceled') data.dating_card_applications[0].status = 'canceled';
  if (kind === 'deleted') data.profiles.pop();
  if (kind === 'banned') data.profiles[1].is_banned = true;
  if (['blocked', 'contactBlocked', 'blockError'].includes(kind)) options[kind] = true;
  if (kind === 'mismatched-peer') data.dating_chat_threads[0].user_b_id = stranger;
  const db = database(data); const { response, body } = await get(db, profileRoute, `thread_id=${threadId}`, options);
  assert.ok([401, 404, 500].includes(response.status)); assert.equal(body.profile, undefined);
});
test('not-yet-started accepted connection works; source parameters cannot bypass a hidden thread', async () => {
  const data = initial(); data.dating_chat_threads = [];
  assert.equal((await get(database(data), profileRoute, `source_kind=open&source_id=${appId}`)).response.status, 200);
  data.dating_chat_threads = initial().dating_chat_threads; data.dating_chat_threads[0].user_a_hidden_at = 'now';
  assert.equal((await get(database(data), profileRoute, `source_kind=open&source_id=${appId}`)).response.status, 404);
});
test('blurry card never falls back to raw and deleted profile fails without breaking chat API', async () => {
  const data = initial(); data.dating_cards[0].blur_paths = []; data.dating_cards[0].blur_thumb_path = null;
  const db = database(data); const result = await get(db, profileRoute, `thread_id=${threadId}`); assert.deepEqual(result.body.profile.photo_urls, []);
  db.tables.profiles.pop(); assert.equal((await get(db, profileRoute, `thread_id=${threadId}`)).response.status, 404);
  assert.equal((await get(db, historyRoute, `thread_id=${threadId}&paged=1`)).response.status, 200);
});
test('message merging preserves history, deduplicates realtime and resets disjoint windows', () => {
  const { mergeLatestChatPage, mergeChatMessages } = load('lib/chat-messages.ts', {});
  const rows = initial().dating_chat_messages;
  const current = { messages: rows.slice(25, 100), pagination: { older_cursor: rows[25].id, has_more: true } };
  const latest = { messages: rows.slice(75), pagination: { older_cursor: rows[75].id, has_more: true } };
  const merged = mergeLatestChatPage(current, latest);
  assert.deepEqual(merged.messages, rows.slice(25)); assert.equal(merged.pagination.older_cursor, rows[25].id);
  assert.equal(mergeChatMessages(rows, rows).length, rows.length);
  assert.deepEqual(mergeLatestChatPage({ ...current, messages: rows.slice(0, 20) }, latest), latest);
});
test('microseconds, whole seconds and timezone offsets sort correctly', () => {
  const { sortChatMessages } = load('lib/chat-messages.ts', {});
  const values = ['2026-09-27T00:00:00.000002Z', '2026-09-27T00:00:00.000001+00:00', '2026-09-27T00:00:00Z', '2026-09-27T09:00:01+09:00'];
  assert.deepEqual(sortChatMessages(values.map((created_at, i) => ({ id: uid(i), created_at }))).map(row => row.created_at), [values[2], values[1], values[0], values[3]]);
});
test('expired paid card never offers images rejected by the existing image guard', async () => {
  const data = initial('paid'); data.dating_paid_cards[0].expires_at = '2020-01-01T00:00:00Z';
  const { body } = await get(database(data), profileRoute, `thread_id=${threadId}`); assert.deepEqual(body.profile.photo_urls, []);
});
test('inbox reads only unread IDs, counts beyond 1000, and uses stored previews', async () => {
  const data = initial(); data.dating_chat_threads[0].last_message_preview = '최신 요약';
  data.dating_chat_messages = Array.from({ length: 1205 }, (_, i) => ({ ...data.dating_chat_messages[0], id: uid(1000 + i) }));
  data.dating_chat_messages.push({ ...data.dating_chat_messages[0], id: uid(9998), is_read: true });
  data.dating_chat_messages.push({ ...data.dating_chat_messages[0], id: uid(9999), receiver_id: peer });
  const db = database(data); const { body } = await get(db, 'app/api/dating/chat/inbox/route.ts', '');
  assert.equal(body.unreadCount, 1205); assert.equal(body.items[0].last_message, '최신 요약');
  const calls = db.calls.filter(q => q.table === 'dating_chat_messages'); assert.equal(calls.length, 3);
  assert.ok(calls.every(q => q.fields === 'id,thread_id' && q.limit === 500));
});
test('history reaches beyond the default 1000-row cap without an unbounded page', async () => {
  const data = initial(); data.dating_chat_messages = Array.from({ length: 1005 }, (_, i) => ({ ...data.dating_chat_messages[0], id: uid(1000 + i) }));
  const db = database(data); let cursor = '', seen = new Set();
  do {
    const { body } = await get(db, historyRoute, `thread_id=${threadId}&paged=1${cursor ? '&before=' + cursor : ''}`);
    body.messages.forEach(row => { assert.ok(!seen.has(row.id)); seen.add(row.id); });
    cursor = body.pagination.has_more ? body.pagination.older_cursor : '';
  } while (cursor);
  assert.equal(seen.size, 1005);
});
for (const table of ['dating_chat_threads', 'dating_chat_messages', 'profiles']) test('history DB failure stays an error: ' + table, async () => {
  const db = database(initial(), q => q.table === table ? { code: 'XX000' } : null);
  const { response, body } = await get(db, historyRoute, `thread_id=${threadId}&paged=1`); assert.equal(response.status, 500); assert.equal(body.messages, undefined);
});
