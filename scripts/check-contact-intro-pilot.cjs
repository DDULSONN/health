/* eslint-disable @typescript-eslint/no-require-imports */
// Offline only: real PostgreSQL functions, actual server helpers, mocked provider.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { test } = require('node:test'), { createHash } = require('node:crypto');
const ts = require('typescript'), { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
function load(file, mocks = {}) {
  const mod = { exports: {} }, js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', js)(n => Object.hasOwn(mocks, n) ? mocks[n] : n.startsWith('@/') ? load(n.slice(2) + '.ts', mocks) : require(n), mod, mod.exports);
  return mod.exports;
}
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const offer = overrides => ({ offerId: id(1), matchId: id(2), amount: 15000, originalAmount: 20000,
  expiresAt: new Date(Date.now() + 86400000).toISOString(), serverNow: new Date().toISOString(), active: true, hasOrder: false, ...overrides });
const model = load('lib/contact-intro-offer.ts');
test('strict quote: correct identifiers and exactly 15000 / 25%, no client-controlled price', () => {
  assert(model.isContactIntroOffer(offer()));
  assert.equal((20000 - model.CONTACT_INTRO_PRICE) / 20000, .25);
  for (const value of [null, {}, offer({ amount: 1 }), offer({ originalAmount: 30000 }), offer({ matchId: 'x' }), offer({ offerId: '-'.repeat(36) }), offer({ expiresAt: 'never' })]) assert(!model.isContactIntroOffer(value));
});

async function database(options = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
    create table profiles(user_id uuid primary key references auth.users(id) on delete cascade,role text default 'user',
      phone_verified boolean default true,phone_e164 text default '+821011112222',is_banned boolean default false,last_meaningful_activity_at timestamptz default now()-interval '1 hour');
    create table dating_1on1_cards(id uuid primary key,user_id uuid,birth_year int default 1995,status text default 'approved');
    create table dating_1on1_match_proposals(id uuid primary key,source_user_id uuid,candidate_user_id uuid,source_card_id uuid,candidate_card_id uuid,
      state text default 'mutual_accepted',contact_exchange_status text default 'awaiting_applicant_payment',
      source_final_responded_at timestamptz default now()-interval '30 hours',contact_exchange_paid_at timestamptz,contact_exchange_approved_at timestamptz);
    create table dating_1on1_plus_subscriptions(user_id uuid,expires_at timestamptz,contact_exchange_included boolean);
    create table dating_user_blocks(blocker_user_id uuid,blocked_user_id uuid);
    create table dating_1on1_admin_user_blocks(user_a_id uuid,user_b_id uuid);
    create table dating_contact_blocks(user_id uuid);
    create table dating_1on1_phone_blocks(user_id uuid);
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  `);
  const def = read('supabase/sql/toss_test_payment_orders.sql').match(/create table if not exists public\.toss_test_payment_orders \([\s\S]*?\n\);/)[0];
  await db.exec(def); await db.exec('alter table toss_test_payment_orders drop constraint toss_test_payment_orders_product_type_check');
  if (options.withoutUserBlocks) await db.exec('drop table dating_user_blocks');
  await db.exec(read('supabase/sql/contact_intro_pilot.sql'));
  const q = (sql, args = []) => db.query(sql, args);
  const rpc = async (name, ...args) => (await q(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) v`, args)).rows[0].v;
  const pair = async n => {
    const a = id(n * 10 + 1), b = id(n * 10 + 2), match = id(n * 10 + 3);
    await q('insert into auth.users(id) values($1),($2)', [a, b]);
    await q('insert into profiles(user_id) values($1),($2)', [a, b]);
    await q('insert into dating_1on1_cards(id,user_id) values($1,$1),($2,$2)', [a, b]);
    await q('insert into dating_1on1_match_proposals(id,source_user_id,candidate_user_id,source_card_id,candidate_card_id) values($1,$2,$3,$2,$3)', [match, a, b]);
    return { a, b, match };
  };
  return { db, q, rpc, pair };
}

test('SQL installs with production optional user-block table absent; future blocks apply and unexpected schema errors fail closed', async () => {
  const { db, q, rpc, pair } = await database({ withoutUserBlocks: true });
  try {
    const p = await pair(1);
    assert.equal(await rpc('contact_intro_eligible', p.match, true), true);
    assert.equal((await q('select count(*)::int n from contact_intro_campaign')).rows[0].n, 0);
    await db.exec('create table dating_user_blocks(blocker_user_id uuid,blocked_user_id uuid)');
    await q('insert into dating_user_blocks values($1,$2)', [p.a, p.b]);
    assert.equal(await rpc('contact_intro_eligible', p.match, true), false);
    await db.exec('alter table dating_user_blocks rename column blocker_user_id to invalid_column');
    await assert.rejects(rpc('contact_intro_eligible', p.match, true), /column/);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec('set role ' + role);
      await assert.rejects(rpc('contact_intro_has_user_blocks', [p.a,p.b]), /permission denied/);
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});

test('PostgreSQL eligibility matrix: timing, prior attempts, blocked/deleted/banned/age, first exchange on BOTH sides', async () => {
  const f = await database(); const { db, q, rpc, pair } = f;
  try {
    assert.equal((await q('select count(*)::int n from contact_intro_campaign')).rows[0].n, 0, 'migration never activates');
    let n = 0;
    for (const sql of [
      "update dating_1on1_match_proposals set source_final_responded_at=now()-interval '23 hours' where id=$1",
      "update dating_1on1_match_proposals set source_final_responded_at=now()-interval '73 hours' where id=$1",
      "update dating_1on1_match_proposals set source_final_responded_at=null where id=$1",
      "update dating_1on1_match_proposals set state='candidate_accepted' where id=$1",
      "update dating_1on1_match_proposals set contact_exchange_status='payment_pending_admin' where id=$1",
      "update dating_1on1_match_proposals set contact_exchange_status='canceled' where id=$1",
    ]) { const p = await pair(++n); await q(sql, [p.match]); assert.equal(await rpc('contact_intro_eligible', p.match, true), false, sql); }
    for (const sql of [
      "update profiles set is_banned=true where user_id=$1", "update profiles set phone_verified=false where user_id=$1",
      "update profiles set phone_e164=null where user_id=$1", "update profiles set phone_e164='821****2222' where user_id=$1",
      "update profiles set role='admin' where user_id=$1", "update auth.users set deleted_at=now() where id=$1",
      "update auth.users set banned_until=now()+interval '1 day' where id=$1",
      "update dating_1on1_cards set status='rejected' where user_id=$1", "update dating_1on1_cards set birth_year=2020 where user_id=$1",
      "insert into dating_contact_blocks values($1)", "insert into dating_1on1_phone_blocks values($1)",
      "insert into dating_user_blocks values($1,'00000000-0000-4000-8000-000000000099')",
      "insert into dating_1on1_admin_user_blocks values($1,'00000000-0000-4000-8000-000000000099')",
      "insert into dating_1on1_plus_subscriptions values($1,now()+interval '1 day',true)",
    ]) for (const side of ['a', 'b']) { const p = await pair(++n); await q(sql, [p[side]]); assert.equal(await rpc('contact_intro_eligible', p.match, true), false, sql + side); }
    for (const state of ['ready', 'paid', 'canceled', 'failed']) for (const side of ['a', 'b']) {
      const p = await pair(++n);
      await q("insert into toss_test_payment_orders(user_id,product_type,toss_order_id,order_name,amount,status) values($1,'one_on_one_contact_exchange',$2,'old',20000,$3)", [p[side], String(n), state]);
      assert.equal(await rpc('contact_intro_eligible', p.match, true), false, state + side);
    }
    const inactive = await pair(++n); await q("update profiles set last_meaningful_activity_at=now()-interval '4 days' where user_id in($1,$2)", [inactive.a, inactive.b]);
    assert.equal(await rpc('contact_intro_eligible', inactive.match, true), false);
    const valid = await pair(++n); assert.equal(await rpc('contact_intro_eligible', valid.match, true), true);
    const native = await pair(++n); await db.exec('create table app_purchase_events(user_id uuid)');
    await q('insert into app_purchase_events values($1)',[native.b]);
    assert.equal(await rpc('contact_intro_eligible', native.match, true), false, 'native verification history excluded');
    assert.equal((await rpc('activate_contact_intro_pilot')).assignedPairs, 1);
    const quote = await rpc('read_contact_intro_offer', valid.a, valid.match, false);
    assert(model.isContactIntroOffer(quote)); assert.equal(quote.amount, 15000);
    const otherQuote = await rpc('read_contact_intro_offer', valid.b, valid.match, false);
    assert.deepEqual({ ...otherQuote, serverNow: quote.serverNow }, quote);
    assert.equal(await rpc('read_contact_intro_offer', inactive.a, valid.match, true), null);
    assert.equal((await q('select count(*)::int n from toss_test_payment_orders where amount=15000')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('PostgreSQL strict 10-pair cap, stable one-time campaign, shared-member dedupe, serialized order, retries, deadline, private privileges', async () => {
  const { db, q, rpc, pair } = await database();
  try {
    for (let n = 1; n <= 14; n++) await pair(n);
    // Reverse duplicate pair / recreated match cannot consume another slot.
    await q('insert into dating_1on1_match_proposals(id,source_user_id,candidate_user_id,source_card_id,candidate_card_id) values($1,$2,$3,$2,$3)', [id(900), id(12), id(11)]);
    const starts = await Promise.all(Array.from({ length: 6 }, () => rpc('activate_contact_intro_pilot')));
    assert(starts.every(c => c.assignedPairs === 10)); assert.equal(new Set(starts.map(c => c.startsAt)).size, 1);
    assert.equal(Date.parse(starts[0].expiresAt) - Date.parse(starts[0].startsAt), 48 * 3600000);
    assert.equal((await q('select count(*)::int n from contact_intro_members')).rows[0].n, 20);
    const row = (await q('select f.*,m.source_user_id a,m.candidate_user_id b from contact_intro_offers f join dating_1on1_match_proposals m on m.id=f.match_id order by slot')).rows[0];
    const args = [row.a, row.match_id, row.offer_id];
    await assert.rejects(rpc('reserve_contact_intro_order', id(9999), row.match_id, row.offer_id, null), /UNAVAILABLE/);
    const reservations = await Promise.all(Array.from({ length: 8 }, (_, i) => rpc('reserve_contact_intro_order', i % 2 ? row.b : row.a, row.match_id, row.offer_id, null)));
    assert.equal(new Set(reservations.map(o => o.id)).size, 1); assert.equal(reservations.filter(o => !o.reused).length, 1);
    const first = reservations[0]; assert.equal(first.amount, 15000);
    assert(reservations.some(o => !o.owned)); assert.equal((await q('select count(*)::int n from toss_test_payment_orders')).rows[0].n, 1);
    await assert.rejects(rpc('reserve_contact_intro_order', ...args, id(999)), /CHANGED/);
    // Entire retry rolls back, including cancellation of the preceding order.
    await db.exec('alter table toss_test_payment_orders add constraint test_reject check(amount<>15000) not valid');
    await assert.rejects(rpc('reserve_contact_intro_order', ...args, first.id), /constraint/);
    assert.equal((await q('select status from toss_test_payment_orders where id=$1', [first.id])).rows[0].status, 'ready');
    await db.exec('alter table toss_test_payment_orders drop constraint test_reject');
    const second = await rpc('reserve_contact_intro_order', ...args, first.id); assert.notEqual(second.id, first.id);
    assert.equal((await q('select status from toss_test_payment_orders where id=$1', [first.id])).rows[0].status, 'canceled');
    assert.equal((await rpc('read_contact_intro_offer', row.a, row.match_id, false)).amount, 15000);
    // Another checkout/product cannot be silently canceled or repriced.
    await assert.rejects(q("insert into toss_test_payment_orders(user_id,product_type,product_ref_id,toss_order_id,order_name,amount) values($1,'one_on_one_contact_exchange',$2,'blocked-regular','regular',20000)", [row.a, row.match_id]), /CHECK_REQUIRED/);
    await q("insert into toss_test_payment_orders(id,user_id,product_type,toss_order_id,order_name,amount) values($1,$2,'one_on_one_contact_exchange','regular','regular',20000)", [id(998), row.a]);
    assert.equal(await rpc('read_contact_intro_offer', row.a, row.match_id, false), null);
    await assert.rejects(rpc('reserve_contact_intro_order', ...args, null), /UNAVAILABLE/);
    assert.equal((await q('select amount,status from toss_test_payment_orders where id=$1', [id(998)])).rows[0].amount, 20000);
    await q('delete from toss_test_payment_orders where id=$1', [id(998)]);
    await db.exec("update contact_intro_campaign set starts_at=now()-interval '48 hours',expires_at=now()");
    assert.equal((await rpc('read_contact_intro_offer', row.a, row.match_id, false)).active, false);
    const expired = await rpc('read_contact_intro_offer', row.a, row.match_id, true); assert.equal(expired.active, false); assert.equal(expired.hasOrder, true);
    assert.equal((await rpc('reserve_contact_intro_order', ...args, null)).id, second.id, 'existing order may recover unchanged');
    const recovered=await rpc('reserve_contact_intro_order', ...args, second.id);
    assert.equal(recovered.amount,15000,'existing promised price remains recoverable after deadline');
    assert.notEqual(recovered.id,second.id);
    const untouched=(await q('select f.*,m.source_user_id from contact_intro_offers f join dating_1on1_match_proposals m on m.id=f.match_id where f.order_id is null limit 1')).rows[0];
    await assert.rejects(rpc('reserve_contact_intro_order',untouched.source_user_id,untouched.match_id,untouched.offer_id,null),/UNAVAILABLE/);
    await db.exec(read('supabase/sql/contact_intro_pilot.sql'));
    assert.equal((await rpc('activate_contact_intro_pilot')).alreadyStarted, true);
    await q('delete from dating_1on1_match_proposals where id=$1', [row.match_id]);
    assert.equal((await q('select count(*)::int n from contact_intro_offers')).rows[0].n, 10, 'deletion never frees quota');
    assert.equal(await rpc('read_contact_intro_offer', row.a, row.match_id, true), null);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec('set role ' + role);
      await assert.rejects(q('select * from contact_intro_offers'), /permission denied/);
      await assert.rejects(rpc('activate_contact_intro_pilot'), /permission denied/);
      if (role !== 'service_role') await assert.rejects(rpc('read_contact_intro_offer', ...args.slice(0, 2), false), /permission denied/);
      else assert.equal(await rpc('read_contact_intro_offer', ...args.slice(0, 2), false), null);
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});

test('assigned pair losing first-exchange eligibility before reservation can still use normal checkout', async () => {
  const { db, q, rpc, pair } = await database();
  try {
    const p = await pair(1);
    await rpc('activate_contact_intro_pilot');
    const quote = await rpc('read_contact_intro_offer',p.a,p.match,false);
    assert(quote?.active);
    await q("insert into toss_test_payment_orders(user_id,product_type,toss_order_id,order_name,amount,status) values($1,'one_on_one_contact_exchange','other-exchange','other',20000,'paid')", [p.a]);
    assert.equal(await rpc('read_contact_intro_offer',p.a,p.match,false),null);
    await assert.rejects(rpc('reserve_contact_intro_order',p.a,p.match,quote.offerId,null),/UNAVAILABLE/);
    await q("insert into toss_test_payment_orders(user_id,product_type,product_ref_id,toss_order_id,order_name,amount) values($1,'one_on_one_contact_exchange',$2,'normal-after-ineligible','normal',20000)", [p.a,p.match]);
    assert.equal((await q('select order_id from contact_intro_offers')).rows[0].order_id,null);
  } finally { await db.close(); }
});

function helperFixture(options = {}) {
  const calls = [], current = { id: id(20), orderId: 'a'.repeat(32), amount: 15000, orderName: '1:1 첫 연락처 교환 · 25% 할인', expiresAt: offer().expiresAt, reused: false, owned: true, ...options.order };
  const db = { rpc(name, args) { calls.push({ name, args }); return { abortSignal: async () => ({ data: name === 'read_contact_intro_offer' ? options.quote === undefined ? offer() : options.quote : args.p_replace_order_id ? { ...current, id: id(21), orderId: 'b'.repeat(32), reused: false, owned: true } : current, error: options.rpcError ?? null }) }; } };
  const helper = load('lib/contact-intro-offer-server.ts', { '@/lib/toss-payments': {
    getTossCheckoutOptions: () => ({}),
    getTossPaymentByOrderId: async () => { calls.push({ readProvider: true }); if (options.providerError) throw Error(options.providerError); return { orderId: current.orderId, totalAmount: 15000, status: 'READY', paymentKey: 'fake', checkout: { url: 'https://api.tosspayments.com/checkout/fake' }, ...options.payment }; },
    createTossPayment: async (params, config) => { calls.push({ create: params, config }); return { checkout: { url: 'https://api.tosspayments.com/checkout/fake' } }; },
  } });
  return { helper, db, calls, create: () => helper.createContactIntroCheckout(db, { id: id(1) }, offer(), 'https://helchang.com') };
}
test('fresh checkout uses stored amount and stable idempotency; client amount never read', async () => {
  const f = helperFixture(); assert.equal((await f.create()).amount, 15000);
  assert.equal(f.calls.find(c => c.create).create.amount, 15000);
  assert.equal(f.calls.find(c => c.create).config.idempotencyKey, 'contact-intro:' + 'a'.repeat(32));
});
for (const state of ['READY', 'DONE', 'ABORTED', 'EXPIRED', 'IN_PROGRESS', 'WAITING_FOR_DEPOSIT', 'CANCELED', 'UNKNOWN']) test('provider state ' + state + ': no blind second charge', async () => {
  const f = helperFixture({ order: { reused: true }, payment: { status: state } });
  if (['IN_PROGRESS', 'WAITING_FOR_DEPOSIT', 'CANCELED', 'UNKNOWN'].includes(state)) { await assert.rejects(f.create()); assert(!f.calls.some(c => c.create)); }
  else { await f.create(); assert.equal(f.calls.filter(c => c.create).length, ['ABORTED', 'EXPIRED'].includes(state) ? 1 : 0); }
});
for (const options of [
  { order: { owned: false } }, { payment: { totalAmount: 1 } }, { payment: { orderId: 'other' } },
  { payment: { checkout: { url: 'https://evil.invalid' } } }, { providerError: 'outage' },
]) test('unknown, wrong price, other payer, unsafe URL fail closed ' + JSON.stringify(options), async () => {
  const f = helperFixture({ ...options, order: { reused: true, ...options.order } });
  await assert.rejects(f.create()); assert(!f.calls.some(c => c.create));
});
test('explicit provider NOT_FOUND reuses SAME order; offer read errors never promise discount', async () => {
  const f = helperFixture({ order: { reused: true }, providerError: JSON.stringify({ code: 'NOT_FOUND_PAYMENT' }) });
  await f.create(); assert.equal(f.calls.find(c => c.create).create.orderId, 'a'.repeat(32));
  for (const code of ['PGRST202', '42883']) { const x = helperFixture({ rpcError: { code } }); assert.equal(await x.helper.readContactIntroOffer(x.db, id(1), id(2)), null); }
  for (const options of [{ rpcError: { code: '57014' } }, { quote: offer({ amount: 1 }) }, { quote: offer({ matchId: id(99) }) }]) { const x = helperFixture(options); await assert.rejects(x.helper.readContactIntroOffer(x.db, id(1), id(2))); }
});
test('read-only API authenticates session, validates IDs and disables shared cache', async () => {
  let user = { id: id(1) }, calls = [];
  const route = load('app/api/dating/1on1/contact-intro-offer/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user }) },
    '@/lib/supabase/server': { createAdminClient: () => ({}) },
    '@/lib/contact-intro-offer-server': { readContactIntroOffer: async (_db, uid, mid) => { calls.push([uid, mid]); return offer(); } },
  });
  const req = value => new Request('https://helchang.com/api/dating/1on1/contact-intro-offer?matchId=' + value + '&userId=other');
  assert.equal((await route.GET(req('invalid'))).status, 400);
  const res = await route.GET(req(id(2))); assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(calls, [[id(1), id(2)]]); user = null; assert.equal((await route.GET(req(id(2)))).status, 401); assert.equal(calls.length, 1);
});

function createRoute(bindings) {
  const src = read('app/api/payments/toss/create/route.ts'), ast = ts.createSourceFile('route.ts', src, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'POST');
  const js = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^export /gm, '');
  const globals = { ...model, ensureAllowedMutationOrigin: () => null,
    getRequestAuthContext: async () => ({ user: { id: id(1) } }), isTossConfigured: () => true,
    json: (status, body) => Response.json(body, { status }), parseProductType: v => v,
    PRODUCT_CONFIG: { one_on_one_contact_exchange: { amount: 20000, orderName: '1:1 번호 교환' } },
    getActiveOneOnOnePlus: async () => null, getBaseUrl: () => 'https://helchang.com', ...bindings };
  return new Function(...Object.keys(globals), js + ';return POST;')(...Object.values(globals));
}
const req = body => new Request('https://helchang.com/api/payments/toss/create', { method: 'POST', body: JSON.stringify({ productType: 'one_on_one_contact_exchange', matchId: id(2), ...body }) });
for (const explicit of [true, false]) test('actual create route, optional ID=' + explicit + ': server 15000 and no generic order cleanup/recovery', async () => {
  const f = helperFixture();
  const handler = createRoute({ ...f.helper, createAdminClient: () => f.db,
    getContactPaymentRecovery: () => { throw Error('MUST_NOT_CANCEL_OR_REPLACE_PILOT'); } });
  const result = await handler(req({ amount: 1, recoveryOrderId: 'irrelevant', ...explicit ? { contactIntroOfferId: id(1) } : {} }));
  assert.equal(result.status, 200); assert.equal((await result.json()).amount, 15000);
  assert.equal(f.calls.filter(c => c.create).length, 1);
});
for (const options of [{ quote: null }, { quote: offer({ active: false }) }, { quote: offer({ offerId: id(99) }) }]) test('actual create route: missing/expired/foreign offer never falls through to full-price charge ' + JSON.stringify(options), async () => {
  const f = helperFixture(options); const handler = createRoute({ ...f.helper, createAdminClient: () => f.db });
  const res = await handler(req({ contactIntroOfferId: id(1) })); assert.equal(res.status, 409); assert(!f.calls.some(c => c.create));
});
test('actual create route: nonparticipants / SQL rejection never reach provider; newly included Plus remains free', async () => {
  const f = helperFixture();
  const deniedDb = { rpc: name => ({ abortSignal: async () => name === 'read_contact_intro_offer' ? { data: offer(), error: null } : { data: null, error: { message: 'CONTACT_INTRO_UNAVAILABLE' } } }) };
  const denied = createRoute({ ...f.helper, createAdminClient: () => deniedDb });
  assert.equal((await denied(req({}))).status, 409); assert(!f.calls.some(c => c.create));
  const db = { ...f.db, from(table) { assert.equal(table, 'dating_1on1_match_proposals');
    const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => ({ error: null, data: { id: id(2), state: 'mutual_accepted', source_user_id: id(1), candidate_user_id: id(3), contact_exchange_status: 'awaiting_applicant_payment' } }) }; return q; } };
  const free = createRoute({ ...f.helper, createAdminClient: () => db, isOneOnOnePairAgeEligible: async () => true,
    getActiveOneOnOnePlus: async () => ({ contact_exchange_included: true }), grantOneOnOneContactExchange: async () => ({}) });
  const res = await free(req({ contactIntroOfferId: id(1) })); assert.equal(res.status, 200);
  assert.equal((await res.json()).fulfilledWithoutPayment, true); assert(!f.calls.some(c => c.create));
});

test('SQL timing boundaries are inclusive at 24/72 hours; activation with zero targets never starts a clock', async () => {
  const { db, q, pair, rpc } = await database();
  try {
    assert.equal((await rpc('activate_contact_intro_pilot')).assignedPairs, 0);
    assert.equal((await q('select count(*)::int n from contact_intro_campaign')).rows[0].n, 0);
    const p = await pair(1); await db.exec('begin');
    for (const [hours, expect] of [[23.999, false], [24, true], [72, true], [72.001, false]]) {
      await q("update dating_1on1_match_proposals set source_final_responded_at=now()-$1*interval '1 hour' where id=$2", [hours, p.match]);
      assert.equal(await rpc('contact_intro_eligible', p.match, true), expect, String(hours));
    }
    await db.exec('rollback');
  } finally { await db.close(); }
});

test('critical fulfillment and phone consent/reveal files remain byte-for-byte unchanged', () => {
  // Filled from the deployed pre-pilot baseline; do not update just to bypass a failure.
  const baseline = JSON.parse(read('scripts/fixtures/contact-intro-baseline.json'));
  for (const [file, hash] of Object.entries(baseline)) assert.equal(createHash('sha256').update(read(file)).digest('hex'), hash, file);
});
