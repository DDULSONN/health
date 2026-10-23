/* eslint-disable @typescript-eslint/no-require-imports */
// Production helpers/routes + local PostgreSQL. No credentials or live sends.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), read = p => fs.readFileSync(path.join(root, p), 'utf8');
const id = '00000000-0000-4000-8000-000000000001';
const source = '00000000-0000-4000-8000-000000000002';
const recipient = '00000000-0000-4000-8000-000000000003';
const secondId = '00000000-0000-4000-8000-000000000004';
const now = Date.parse('2026-10-26T03:00:00Z'), startedAt = '2026-10-24T00:00:00Z';
class TestDate extends Date { static now() { return now; } }
function load(file, deps = {}, Clock = TestDate) {
  const mod = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', 'Date', code)(name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', deps, Clock);
    throw Error('Unexpected test dependency: ' + name);
  }, mod, mod.exports, Clock);
  return mod.exports;
}
function match(overrides = {}) { return { id, source_user_id: source, candidate_user_id: recipient,
  state: 'source_selected', contact_exchange_status: 'none', source_selected_at: '2026-10-25T02:00:00Z',
  source_final_responded_at: '2026-10-25T02:00:00Z', ...overrides }; }
function memoryDb(tables, options = {}) {
  const calls = [], reservations = [];
  const db = { calls, reservations, from(table) {
    const call = { table, filters: [] }; calls.push(call);
    let rows = tables[table] ?? [], patch, insert, limit;
    const q = {
      select() { return q; }, order() { return q; },
      limit(n) { limit = n; return q; },
      eq(k, v) { call.filters.push([k, v]); rows = rows.filter(r => r[k] === v); return q; },
      in(k, v) { rows = rows.filter(r => v.includes(r[k])); return q; },
      gte(k, v) { rows = rows.filter(r => r[k] >= v); return q; },
      lte(k, v) { rows = rows.filter(r => r[k] <= v); return q; },
      contains(k, value) { rows = rows.filter(r => Object.entries(value).every(([key, val]) => r[k]?.[key] === val)); return q; },
      insert(value) { insert = value; call.write = true; return q; },
      update(value) { patch = value; call.write = true; return q; },
      async execute(single) {
        if (options.failedTable === table) return { data: null, error: { code: '42501' } };
        if (insert) {
          if (options.reserveError) return { data: null, error: { code: options.reserveError } };
          if (reservations.some(r => r.recipient_user_id === insert.recipient_user_id)) return { data: null, error: { code: '23505' } };
          const row = { id: 'reservation-' + reservations.length, status: 'sending', ...insert };
          reservations.push(row); tables[table] = [...(tables[table] ?? []), row];
          options.afterReserve?.(); return { data: row, error: null };
        }
        if (patch) rows.forEach(row => Object.assign(row, patch));
        const data = limit === undefined ? rows : rows.slice(0, limit);
        return { data: single ? data[0] ?? null : data, error: null };
      },
      maybeSingle() { return q.execute(true); },
      then(resolve, reject) { return q.execute(false).then(resolve, reject); },
    }; return q;
  } };
  return db;
}
function guardFixture(options = {}) {
  const row = match(options.match);
  const tables = { dating_1on1_match_proposals: [row], profiles: [source, recipient].filter(uid => uid !== options.missingProfile)
    .map(user_id => ({ user_id, is_banned: options.banned === user_id })) };
  const db = memoryDb(tables, options);
  db.auth = { admin: { getUserById: async uid => ({ data: { user: options.missingAuth === uid ? null : {
    id: uid, deleted_at: options.deleted === uid ? '2026-10-25' : null,
    banned_until: options.authBanned === uid ? '2099-01-01' : null,
  } }, error: options.authError ? { code: 'offline' } : null }) } };
  const guard = load('lib/dating-1on1-delivery-guard.ts', {
    '@/lib/dating-blocks': { hasDatingBlockBetween: async () => { if (options.blockError) throw Error('offline'); return options.blocked ?? false; } },
    '@/lib/dating-contact-blocks': { hasDatingContactPhoneBlockBetween: async () => options.contactBlocked ?? false },
    '@/lib/marketing-email': { fetchMarketingUnsubscribedUserIds: async () => {
      if (options.preferencesError) throw Error('offline'); return new Set(options.optedOut ? [recipient] : []);
    } },
  });
  return { db, check: (type = 'dating_1on1_selection_received', uid = recipient) => guard.canDeliverOneOnOneNotification(db, id, type, uid) };
}
test('live match safety accepts only a current, active, unblocked recipient', async () => {
  const f = guardFixture(); assert.equal(await f.check(), true); assert.equal(await f.check(undefined, source), false);
  assert.equal(await f.check(undefined, secondId), false); assert.equal(f.db.calls.some(c => c.write), false);
});
for (const [name, option] of Object.entries({ blocked: { blocked: true }, contact: { contactBlocked: true }, optout: { optedOut: true },
  preferences: { preferencesError: true }, blocksUnavailable: { blockError: true }, profilesUnavailable: { failedTable: 'profiles' },
  authUnavailable: { authError: true }, canceled: { match: { state: 'source_skipped' } } })) {
  test('external delivery fails closed: ' + name, async () => assert.equal(await guardFixture(option).check(), false));
}
for (const uid of [source, recipient]) for (const key of ['deleted', 'missingAuth', 'banned', 'authBanned', 'missingProfile'])
  test('both parties must be available: ' + key + uid.slice(-1), async () => assert.equal(await guardFixture({ [key]: uid }).check(), false));
test('mutual acceptance accepts either participant, but canceled contact does not', async () => {
  const f = guardFixture({ match: { state: 'mutual_accepted', contact_exchange_status: 'awaiting_applicant_payment' } });
  assert.equal(await f.check('dating_1on1_match_accepted', source), true);
  assert.equal(await f.check('dating_1on1_match_accepted', recipient), true);
  assert.equal(await guardFixture({ match: { state: 'mutual_accepted', contact_exchange_status: 'canceled' } }).check('dating_1on1_match_accepted'), false);
});

function reminderFixture(options = {}) {
  const row = match(options.match), messages = [];
  const tables = { dating_1on1_match_proposals: [row], admin_open_card_outreach_mail_logs: options.legacy ? [{ id: 'old', user_id: recipient,
    campaign_key: 'one_on_one_match_pending_24h', success: true, meta: { match_id: id } }] : [] };
  const db = memoryDb(tables, { ...options, afterReserve: () => {
    if (options.cancelOnReserve) row.state = 'source_skipped';
    if (options.payOnReserve) row.contact_exchange_status = 'approved';
  } });
  const reminders = load('lib/dating-1on1-reminders.ts', {
    '@/lib/dating-1on1-delivery-guard': { canDeliverOneOnOneNotification: async () => !options.unsafe },
    '@/lib/dating-swipe': { sendDatingEmailNotification: async (admin, uid, subject, text, guard, key) => {
      if (!await guard()) return false;
      messages.push({ uid, subject, text, key }); if (options.providerFails) throw Error('offline'); return true;
    } },
  });
  return { module: reminders, db, messages, row, send: (kind = 'selection_pending_24h', uid = recipient) =>
    reminders.sendOneOnOnePendingReminder(db, row, uid, kind, startedAt, now) };
}
test('reminder timing has exact 24h/48h boundaries and rollout cutoff', () => {
  const { module } = reminderFixture();
  for (const [age, ok] of [[23.999, false], [24, true], [47.999, true], [48, false], [70, false], [-1, false]]) {
    const row = match({ source_selected_at: new Date(now - age * 3600000).toISOString() });
    assert.equal(Boolean(module.getOneOnOneReminderKind(row, now, startedAt)), ok, String(age));
  }
  assert.equal(module.getOneOnOneReminderKind(match(), now, '2026-10-25T03:00:00Z'), null);
  assert.equal(module.getOneOnOneReminderKind(match({ source_selected_at: 'bad' }), now, startedAt), null);
  assert.equal(module.getOneOnOneReminderKind(match(), now, 'bad'), null);
  for (const [hour, eligible] of [[8, false], [9, true], [19, true], [20, false], [23, false], [0, false]])
    assert.equal(module.isOneOnOneReminderHour(Date.parse(`2026-10-26T${String(hour).padStart(2, '0')}:00:00+09:00`)), eligible);
});
test('a pending request sends exactly once with readable Korean, exact match link and a stable provider key', async () => {
  const f = reminderFixture(); assert.equal(await f.send(), 'sent'); assert.equal(await f.send(), 'skipped');
  assert.equal(f.messages.length, 1); const m = f.messages[0];
  assert.match(m.text, new RegExp('matchId=' + id)); assert.match(m.subject, /아직 응답하지 않은/);
  assert.equal(Buffer.from(m.text).toString('utf8'), m.text); assert.doesNotMatch(m.text, /�|18,000|할인|지금 결제/);
  assert.equal(m.key, `one-on-one-reminder/${id}/${recipient}/selection_pending_24h`);
  assert.equal(f.db.reservations[0].status, 'sent');
});
test('concurrent cron delivery claims permit only one external message', async () => {
  const f = reminderFixture(); const results = await Promise.all([f.send(), f.send(), f.send()]);
  assert.equal(results.filter(v => v === 'sent').length, 1); assert.equal(f.messages.length, 1);
});
test('request reminders never go to the sender or an unrelated member', async () => {
  const f = reminderFixture(); for (const uid of [source, secondId]) assert.equal(await f.send(undefined, uid), 'skipped');
  assert.equal(f.messages.length, 0); assert.equal(f.db.reservations.length, 0);
});
for (const [name, options] of Object.entries({ canceled: { cancelOnReserve: true }, unsafe: { unsafe: true }, missingSchema: { reserveError: '42P01' },
  permission: { reserveError: '42501' }, provider: { providerFails: true } })) test('reminder safely handles ' + name, async () => {
  const f = reminderFixture(options); assert.notEqual(await f.send(), 'sent');
  assert.equal(f.messages.length, options.providerFails ? 1 : 0);
  if (options.providerFails) { assert.equal(await f.send(), 'skipped'); assert.equal(f.db.reservations[0].status, 'failed'); }
});
test('mutual reminder skips completed payment and respects previous delivery records', async () => {
  const state = { state: 'mutual_accepted', contact_exchange_status: 'awaiting_applicant_payment' };
  const active = reminderFixture({ match: state }); assert.equal(await active.send('mutual_pending_24h'), 'sent');
  for (const options of [{ legacy: true }, { payOnReserve: true }, { failedTable: 'admin_open_card_outreach_mail_logs' }]) {
    const f = reminderFixture({ ...options, match: state }); assert.notEqual(await f.send('mutual_pending_24h'), 'sent'); assert.equal(f.messages.length, 0);
  }
  for (const status of ['approved', 'canceled', 'paid']) {
    const f = reminderFixture({ match: { ...state, contact_exchange_status: status } }); assert.equal(await f.send('mutual_pending_24h'), 'skipped');
  }
});

test('actual cron requires authorization, daytime, activation and fresh bounded candidates', async () => {
  for (const condition of ['unauthorized', 'night', 'disabled', 'schemaMissing', 'queryFailure', 'active']) {
    const sends = [], tables = { site_settings: [{ key: 'dating_1on1_reminder_delivery', value_json: { enabled: condition !== 'disabled', started_at: startedAt } }],
      dating_1on1_match_proposals: [match(), match({ id: secondId, state: 'mutual_accepted', contact_exchange_status: 'awaiting_applicant_payment' }),
        match({ id: 'paid', state: 'mutual_accepted', contact_exchange_status: 'approved' }), match({ id: 'old', source_selected_at: '2026-10-01' })] };
    const db = memoryDb(tables, { failedTable: condition === 'schemaMissing' ? 'site_settings' : condition === 'queryFailure' ? 'dating_1on1_match_proposals' : null });
    const { module } = reminderFixture();
    class Clock extends Date { static now() { return condition === 'night' ? Date.parse('2026-10-26T14:00:00Z') : now; } }
    const route = load('app/api/cron/dating-1on1-match-reminders/route.ts', {
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/cron-auth': { ensureCronAuthorized: () => condition === 'unauthorized' ? new Response('', { status: 401 }) : null },
      '@/lib/supabase/server': { createAdminClient: () => db },
      '@/lib/dating-1on1-reminders': { ...module, sendOneOnOnePendingReminder: async (_, row, uid, kind) => { sends.push({ id: row.id, uid, kind }); return 'sent'; } },
    }, Clock);
    const res = await route.GET(new Request('https://example.invalid/cron'));
    assert.equal(res.status, condition === 'unauthorized' ? 401 : condition === 'queryFailure' ? 500 : 200, condition);
    assert.equal(sends.length, condition === 'active' ? 3 : 0, condition);
    if (condition === 'active') assert.deepEqual(sends.map(x => x.uid), [recipient, source, recipient]);
    if (['unauthorized', 'night'].includes(condition)) assert.equal(db.calls.length, 0);
  }
});

// Isolate the actual wrapper rather than replacing it with a permissive fake.
test('email wrapper fails closed for opt-out lookup failures/deletion and forwards idempotency', async () => {
  const ast = ts.createSourceFile('mail.ts', read('lib/dating-swipe.ts'), ts.ScriptTarget.Latest, true);
  const src = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'sendDatingEmailNotification').getText(ast);
  const code = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const mode of ['ok', 'deleted', 'authFail', 'banned', 'optedOut', 'preferenceFail']) {
    const mod = { exports: {} }, payloads = [];
    new Function('exports', 'fetchMarketingUnsubscribedUserIds', 'appendEmailUnsubscribeFooter', 'sendDatingEmailToAddressDetailed', code)(mod.exports,
      async () => { if (mode === 'preferenceFail') throw Error('synthetic unavailable'); return new Set(mode === 'optedOut' ? [recipient] : []); },
      ({ body }) => body, async (...args) => { payloads.push(args); return { ok: true }; });
    const db = { auth: { admin: { getUserById: async () => ({ data: { user: { email: 'test@example.invalid',
      deleted_at: mode === 'deleted' ? '2026-10-01' : null, banned_until: mode === 'banned' ? '2099-01-01' : null } }, error: mode === 'authFail' ? {} : null }) } } };
    const result = await mod.exports.sendDatingEmailNotification(db, recipient, '요청 안내', '한글 본문', async () => true, 'stable-test-key');
    assert.equal(result, mode === 'ok'); assert.equal(payloads.length, mode === 'ok' ? 1 : 0);
    if (mode === 'ok') assert.equal(payloads[0][3].idempotencyKey, 'stable-test-key');
  }
});

test('PostgreSQL migration is additive, rerunnable, access-restricted and enforces event/day dedupe', async () => {
  const { PGlite } = require('@electric-sql/pglite'); const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table dating_1on1_match_proposals(id uuid primary key, state text, source_selected_at timestamptz);
      create table dating_1on1_sms_deliveries(id uuid primary key default gen_random_uuid(), event_kind text check(event_kind in ('selection_received')));
      create table site_settings(key text primary key, value_json jsonb);
      insert into auth.users values('${source}'),('${recipient}');
      insert into dating_1on1_match_proposals values('${id}','source_selected',now()),('${secondId}','mutual_accepted',now());
      insert into dating_1on1_sms_deliveries(event_kind) values('selection_received');`);
    const sql = read('supabase/sql/dating_1on1_notification_delivery_upgrade.sql');
    await db.exec(sql); const start = (await db.query('select value_json from site_settings')).rows[0].value_json.started_at;
    await db.exec(sql); assert.equal((await db.query('select value_json from site_settings')).rows[0].value_json.started_at, start);
    await db.exec("insert into dating_1on1_sms_deliveries(event_kind) values('match_accepted')");
    assert.equal((await db.query('select count(*)::int n from dating_1on1_match_proposals')).rows[0].n, 2);
    await db.exec(`insert into dating_1on1_reminder_deliveries(match_id,recipient_user_id,event_kind) values('${id}','${recipient}','selection_pending_24h')`);
    await assert.rejects(db.exec(`insert into dating_1on1_reminder_deliveries(match_id,recipient_user_id,event_kind) values('${secondId}','${recipient}','mutual_pending_24h')`), /dating_1on1_reminder_daily_unique/);
    await assert.rejects(db.exec(`insert into dating_1on1_reminder_deliveries(match_id,recipient_user_id,event_kind,notification_day) values('${id}','${recipient}','selection_pending_24h',current_date + 1)`), /dating_1on1_reminder_event_unique/);
    await assert.rejects(db.exec(`insert into dating_1on1_reminder_deliveries(match_id,recipient_user_id,event_kind) values('${secondId}','${source}','bad')`), /event_kind_check/);
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role); await assert.rejects(db.query('select * from dating_1on1_reminder_deliveries'), /permission denied/); await db.exec('reset role');
    }
    const rls = await db.query("select relrowsecurity from pg_class where relname='dating_1on1_reminder_deliveries'"); assert.equal(rls.rows[0].relrowsecurity, true);
    await db.exec(`delete from auth.users where id='${recipient}'`);
    assert.equal((await db.query('select count(*)::int n from dating_1on1_reminder_deliveries')).rows[0].n, 0);
  } finally { await db.close(); }
});

for (const action of ['candidate_accept', 'source_accept']) test('real acceptance route preserves state/payment flow and queues SMS only for the other person: ' + action, async () => {
  const actor = action === 'candidate_accept' ? recipient : source;
  const peer = actor === source ? recipient : source;
  const row = match({ state: action === 'candidate_accept' ? 'source_selected' : 'candidate_accepted', source_card_id: source,
    candidate_card_id: recipient, created_at: '2026-10-25T02:00:00Z' });
  const db = memoryDb({ dating_1on1_match_proposals: [row] });
  const background = [], sms = [], emails = [], notices = [];
  const route = load('app/api/dating/1on1/matches/[id]/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) }, after: fn => background.push(fn) },
    '@/lib/dating-1on1': { getDatingOneOnOneCardsByIds: async () => new Map([[source, { name: '보낸 회원' }], [recipient, { name: '받은 회원' }]]), isDatingOneOnOneLegacyPhoneShareMatch: () => false },
    '@/lib/dating-1on1-metrics': { recordOneOnOneMetricEvent: async () => {} },
    '@/lib/dating-blocks': { hasDatingBlockBetween: async () => false },
    '@/lib/dating-contact-blocks': { hasDatingContactPhoneBlockBetween: async () => false },
    '@/lib/dating-notifications': { notifyDatingUser: async (_, data) => notices.push(data) },
    '@/lib/request-origin': { ensureAllowedMutationOrigin: () => null },
    '@/lib/dating-swipe': { sendDatingEmailNotification: async (_, uid, subject, text, guard, key) => { assert.equal(await guard(), true); emails.push({ uid, key }); return true; } },
    '@/lib/dating-1on1-sms': { sendOneOnOneAcceptedSms: async (_, input) => sms.push(input), sendOneOnOneSelectionSms: async () => assert.fail('no selection SMS on acceptance') },
    '@/lib/dating-1on1-delivery-guard': { canDeliverOneOnOneNotification: async () => true },
    '@/lib/supabase/server': { createAdminClient: () => db },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user: { id: actor } }) },
    '@/lib/dating-1on1-age': { isOneOnOnePairAgeEligible: async () => true },
    '@/lib/dating-age': { DATING_AGE_INELIGIBLE_MESSAGE: '나이 확인' },
  });
  const request = () => new Request('https://example.invalid/api/match', { method: 'POST', body: JSON.stringify({ action }) });
  const response = await route.POST(request(), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
  assert.equal(row.state, 'mutual_accepted'); assert.equal(row.contact_exchange_status, 'awaiting_applicant_payment');
  assert.equal(row.contact_exchange_paid_at, null); assert.equal(row.contact_exchange_approved_at, null);
  assert.equal(row.source_phone_share_consented_at, null); assert.equal(row.candidate_phone_share_consented_at, null);
  assert.equal(sms.length, 0, 'provider must not delay the acceptance response'); assert.equal(background.length, 1);
  await background[0](); assert.deepEqual(sms[0], { matchId: id, sourceUserId: actor, recipientUserId: peer });
  assert.equal(emails.length, 1); assert.equal(emails[0].uid, peer); assert.match(emails[0].key, /dating_1on1_match_accepted/);
  assert.equal((await route.POST(request(), { params: Promise.resolve({ id }) })).status, 409);
  assert.equal(background.length, 1); assert.equal(emails.length, 1);
  assert.ok(notices.some(item => item.userId === peer));
  assert.ok(db.calls.filter(call => call.write).every(call => call.table === 'dating_1on1_match_proposals'));
});
