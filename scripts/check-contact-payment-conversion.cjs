/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, mocks = {}, globals = {}) {
  const compiled = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), compiled)(id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('@/')) throw Error('Missing dependency: ' + id);
    return require(id);
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const price = load('lib/dating-contact-price.ts');
const nudge = load('lib/dating-1on1-contact-nudge.ts');
const nudgeUI = load('components/dating/OneOnOneContactNudge.tsx', { '@/lib/dating-1on1-contact-nudge': nudge });
const notice = load('components/PaymentCardNotice.tsx', { '@/lib/payment-card-notice': load('lib/payment-card-notice.ts') });
const Offer = load('components/dating/OneOnOneContactOffer.tsx', {
  '@/components/PaymentCardNotice': notice, '@/components/dating/OneOnOneContactNudge': nudgeUI, '@/lib/dating-contact-price': price,
}).default;
const defaults = { matchId: 'match', name: '테스트상대', included: false, processing: false, nudgeProcessing: false, onExchange() { throw Error('No automatic checkout'); }, onNudge() { throw Error('No automatic send'); } };
const received = { preset_key: 'coffee_on_me', message_text: '연락처 교환해 주시면 첫 커피는 제가 살게요 ☕', sender_display_name: '테스트상대', created_at: new Date().toISOString() };
const summary = { available: true, can_send: false, sent_by_me: null, received_from_other: received, eligible_at: null };
function offer(props = {}) { return renderToStaticMarkup(React.createElement(Offer, { ...defaults, ...props })); }

test('matching offer displays the real name and server-shared price, with payment explanation in details', () => {
  const html = offer();
  assert.ok(html.includes('테스트상대님과 서로 수락했어요'));
  assert.ok(html.includes('결제 완료 후 서로의 연락처가 공개돼요.'));
  assert.ok(html.includes('연락처 교환 · 20,000원'));
  assert.ok(html.indexOf('한 분이') > html.indexOf('<details'));
  assert.ok(!html.includes('�'));
  assert.ok(read('app/api/payments/toss/create/route.ts').includes('amount: ONE_ON_ONE_CONTACT_PRICE_KRW'));
});
test('received message appears exactly once above checkout; no received message is invented', () => {
  const html = offer({ nudge: summary });
  assert.equal(html.split(received.message_text).length - 1, 1);
  assert.ok(html.indexOf(received.message_text) < html.indexOf('<button'));
  assert.ok(html.includes('테스트상대님이 보낸 1:1 한마디'));
  assert.ok(!offer().includes(received.message_text));
  assert.ok(!offer({ nudge: { ...summary, available: false } }).includes(received.message_text));
});
test('legacy included exchanges stay free and pending checkout disables its only payment button', () => {
  const html = offer({ included: true, processing: true, nudge: summary });
  assert.ok(html.includes('교환 중...')); assert.ok(html.includes('disabled=""'));
  assert.ok(!html.includes('20,000')); assert.ok(!html.includes('현대·KB국민·우리카드'));
  assert.ok(offer({ included: true }).includes('무료로 번호교환'));
});
test('long/Korean names and preset text are escaped; outgoing nudge controls remain available separately', () => {
  const html = offer({ name: '<script>테스트</script>', nudge: { ...summary, can_send: true } });
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('한마디 보내기')); assert.ok(html.includes('24시간'));
  assert.ok(!offer({ nudge: { ...summary, sent_by_me: received } }).includes('한마디 보내기'));
});

const orderId = 'test_order_12345';
function fixture(options = {}) {
  const order = { id: 'order', user_id: 'self', product_type: 'one_on_one_contact_exchange', product_ref_id: 'match', toss_order_id: orderId, amount: 20000, status: 'ready', created_at: new Date().toISOString(), ...options.order };
  const match = { id: 'match', source_user_id: 'self', candidate_user_id: 'other', source_card_id: 'c1', candidate_card_id: 'c2', state: 'mutual_accepted', contact_exchange_status: 'awaiting_applicant_payment', contact_exchange_paid_at: null, ...options.match };
  const card = { id: 'c2', user_id: 'other', name: '상대프로필이름', age: 29, region: '경기 수원', status: 'approved', photo_signed_urls: ['/i/signed/dating-1on1-photos/test.webp'], ...options.card };
  const orders = options.history ?? [order];
  const profiles = options.profiles ?? [{ user_id: 'self', is_banned: false }, { user_id: 'other', is_banned: false }];
  const calls = [], providerCalls = [];
  const db = { from(table) {
    let filters = [], fields, single = false, limit = Infinity;
    const q = {
      select(value) { fields = value; return q; }, eq(k, v) { filters.push(row => row[k] === v); return q; },
      in(k, values) { filters.push(row => values.includes(row[k])); return q; },
      order() { return q; }, limit(n) { limit = n; return q; }, maybeSingle() { single = true; return q; },
      then(resolve, reject) {
        calls.push({ table, fields });
        if (options.dbError === table) return Promise.resolve({ data: null, error: Error('database unavailable') }).then(resolve, reject);
        let data = table === 'toss_test_payment_orders' ? (single ? [order] : orders) : table === 'dating_1on1_match_proposals' ? [match] : table === 'profiles' ? profiles : [];
        data = data.filter(row => filters.every(f => f(row))).slice(0, limit);
        return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve, reject);
      },
      insert() { throw Error('Read-only preflight must not insert'); }, update() { throw Error('Read-only preflight must not update'); },
    }; return q;
  } };
  const helper = load('lib/contact-payment-recovery.ts', {
    '@/lib/dating-1on1': { getDatingOneOnOneCardsByIds: async () => new Map(options.missingCard ? [] : [['c2', card]]) },
    '@/lib/dating-1on1-age': { isOneOnOnePairAgeEligible: async () => options.ageEligible !== false },
    '@/lib/dating-blocks': { hasDatingBlockBetween: async () => !!options.blocked },
    '@/lib/dating-contact-blocks': { hasDatingContactPhoneBlockBetween: async () => !!options.phoneBlocked },
    '@/lib/dating-contact-price': price,
    '@/lib/toss-payments': { getTossPaymentByOrderId: async id => {
      providerCalls.push(id);
      if (options.providerError) throw Error('provider unavailable');
      return { orderId: id, totalAmount: 20000, status: 'ABORTED', checkout: { url: 'https://api.tosspayments.com/checkout/test' }, ...options.payment, ...options.payments?.[id] };
    } },
  });
  return { ...helper, db, calls, providerCalls, order, match, run: (viewer = 'self') => helper.getContactPaymentRecovery(db, viewer, orderId) };
}

for (const [label, options] of Object.entries({
  stranger: { order: { user_id: 'stranger' } }, wrongProduct: { order: { product_type: 'paid_card' } },
  stale: { order: { created_at: '2025-01-01' } }, invalidDate: { order: { created_at: 'no' } },
  notParticipant: { match: { source_user_id: 'stranger' } }, rejected: { match: { state: 'candidate_rejected' } },
  notMutual: { match: { state: 'candidate_accepted' } }, canceled: { match: { contact_exchange_status: 'canceled' } },
  block: { blocked: true }, phoneBlock: { phoneBlocked: true }, underage: { ageEligible: false },
  withdrawn: { profiles: [{ user_id: 'self', is_banned: false }] }, banned: { profiles: [{ user_id: 'self', is_banned: false }, { user_id: 'other', is_banned: true }] },
  missingCard: { missingCard: true }, wrongCardOwner: { card: { user_id: 'stranger' } }, rejectedCard: { card: { status: 'rejected' } },
})) test(`recovery protects profile and never queries provider: ${label}`, async () => {
  const f = fixture(options); assert.equal(await f.run(), null); assert.equal(f.providerCalls.length, 0);
});
for (const options of [{ order: { status: 'paid' } }, { match: { contact_exchange_status: 'approved' } }, { match: { contact_exchange_paid_at: new Date().toISOString() } }]) {
  test('locally completed payment cannot offer retry or perform provider mutation', async () => {
    const f = fixture(options); assert.equal((await f.run()).view.state, 'paid'); assert.equal(f.providerCalls.length, 0);
  });
}
for (const [status, expected] of [['DONE','paid'], ['READY','retry'], ['ABORTED','retry'], ['EXPIRED','retry'], ['IN_PROGRESS','pending'], ['WAITING_FOR_DEPOSIT','pending'], ['CANCELED','unavailable'], ['PARTIAL_CANCELED','unavailable'], ['UNKNOWN','unavailable']]) {
  test(`provider ${status} → ${expected}; READY reuses the same checkout`, async () => {
    const result = await fixture({ payment: { status } }).run();
    assert.equal(result.view.state, expected);
    assert.equal(Boolean(result.checkoutUrl), status === 'READY');
    assert.ok(!JSON.stringify(result.view).includes('paymentKey'));
    assert.ok(!JSON.stringify(result.view).includes('phone'));
  });
}
test('provider mismatch, injected checkout URL, or unavailable provider never allow a new payment', async () => {
  for (const payment of [{ orderId: 'wrong' }, { totalAmount: 1 }, { status: 'READY', checkout: { url: 'https://tosspayments.com.evil.test' } }, { status: 'READY', checkout: { url: 'javascript:alert(1)' } }]) {
    const result = await fixture({ payment }).run(); assert.notEqual(result.view.state, 'retry'); assert.equal(result.checkoutUrl, null);
  }
  await assert.rejects(fixture({ providerError: true }).run());
  await assert.rejects(fixture({ dbError: 'profiles' }).run());
});
test('other participant payment and approval-pending take priority over this failed attempt', async () => {
  const f = fixture(); const other = { ...f.order, id: 'other-order', toss_order_id: 'other-order-123', user_id: 'other' };
  for (const [status, expected] of [['DONE','paid'], ['READY','pending'], ['IN_PROGRESS','pending']]) {
    const result = await fixture({ history: [other, f.order], payments: { [other.toss_order_id]: { status } } }).run();
    assert.equal(result.view.state, expected);
  }
  assert.equal((await fixture({ match: { contact_exchange_status: 'payment_pending_admin' } }).run()).view.state, 'pending');
});
test('even locally canceled historical orders are checked for an actual provider approval', async () => {
  const f = fixture(); const prior = { ...f.order, toss_order_id: 'previous-123', status: 'canceled' };
  assert.equal((await fixture({ history: [f.order, prior], payments: { 'previous-123': { status: 'DONE' } } }).run()).view.state, 'paid');
});
test('excessive histories fail closed without unbounded external requests', async () => {
  const f = fixture(); const many = Array.from({ length: 9 }, (_, i) => ({ ...f.order, toss_order_id: `order-${i}` }));
  const check = fixture({ history: many }); assert.equal((await check.run()).view.state, 'unavailable'); assert.equal(check.providerCalls.length, 0);
});

function getRoute(options = {}) {
  const f = fixture(options);
  const route = load('app/api/payments/toss/contact-recovery/route.ts', {
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user: options.anonymous ? null : { id: 'self' } }) },
    '@/lib/supabase/server': { createAdminClient: () => f.db },
    '@/lib/payment-guidance': { normalizeFailureOrderId: value => /^[A-Za-z0-9_-]{6,64}$/.test(value ?? '') ? value : null },
    '@/lib/contact-payment-recovery': f,
  }); return { ...route, ...f };
}
for (const [options, status] of [[{},200], [{ anonymous:true },401], [{ order: { user_id:'stranger' } },404], [{ providerError:true },503]]) test(`actual read-only route returns private response ${status}`, async () => {
  const route = getRoute(options); const res = await route.GET(new Request(`https://helchang.com/api/payments/toss/contact-recovery?orderId=${orderId}`));
  assert.equal(res.status, status); assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const body = await res.json(); assert.ok(!JSON.stringify(body).includes('checkoutUrl')); assert.ok(!JSON.stringify(body).includes('paymentKey'));
});

function actualCreate(globals) {
  const file = ts.createSourceFile('route.ts', read('app/api/payments/toss/create/route.ts'), ts.ScriptTarget.Latest, true);
  const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'POST');
  const compiled = ts.transpileModule(fn.getText(file).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(globals), compiled + '; return POST;')(...Object.values(globals));
}
test('actual POST rechecks recovery and never creates an order for stale/paid/foreign inputs', async () => {
  for (const state of ['paid', 'pending', 'unavailable', 'retry']) {
    let reads = 0;
    const route = actualCreate({
      ensureAllowedMutationOrigin: () => null, getRequestAuthContext: async () => ({ user: { id:'self' } }), isTossConfigured: () => true,
      parseProductType: v => v, PRODUCT_CONFIG: { one_on_one_contact_exchange: { amount: 20000 } }, createAdminClient: () => ({}),
      normalizeFailureOrderId: v => v, getContactPaymentRecovery: async () => { reads++; return { view: { matchId:'match', state, amount:20000 }, checkoutUrl: 'https://api.tosspayments.com/checkout/test' }; },
      json: (status, body) => Response.json(body, { status }),
      getActiveOneOnOnePlus: async () => null,
    });
    const res = await route(new Request('https://helchang.com/api/payments/toss/create', { method:'POST', body:JSON.stringify({ productType:'one_on_one_contact_exchange', matchId:'match', recoveryOrderId:orderId }) }));
    assert.equal(res.status, state === 'retry' ? 200 : 409); assert.equal(reads, 1);
    if (state === 'retry') assert.equal((await res.json()).reusedOrder, true);
  }
});
test('a newly granted included benefit never reopens a paid READY checkout', async () => {
  const f = fixture(); let fulfilled = 0;
  const db = { from(table) {
    assert.equal(table, 'dating_1on1_match_proposals');
    const q = { select() { return q; }, eq() { return q; }, async maybeSingle() { return { data: f.match, error: null }; } };
    return q;
  } };
  const route = actualCreate({
    ensureAllowedMutationOrigin: () => null, getRequestAuthContext: async () => ({ user: { id: 'self' } }), isTossConfigured: () => true,
    parseProductType: v => v, PRODUCT_CONFIG: { one_on_one_contact_exchange: { amount: 20000 } }, createAdminClient: () => db,
    normalizeFailureOrderId: v => v, getContactPaymentRecovery: async () => ({ view: { matchId: 'match', state: 'retry', amount: 20000 }, checkoutUrl: 'https://api.tosspayments.com/checkout/test' }),
    isOneOnOnePairAgeEligible: async () => true, getActiveOneOnOnePlus: async () => ({ contact_exchange_included: true, expires_at: '2026-10-01' }),
    grantOneOnOneContactExchange: async (_db, args) => { assert.equal(args.matchId, 'match'); fulfilled++; return { id: 'match' }; },
    json: (status, body) => Response.json(body, { status }),
  });
  const res = await route(new Request('https://helchang.com/api/payments/toss/create', { method: 'POST', body: JSON.stringify({ productType: 'one_on_one_contact_exchange', matchId: 'match', recoveryOrderId: orderId }) }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.fulfilledWithoutPayment, true); assert.equal(body.checkoutUrl, undefined); assert.equal(fulfilled, 1);
});
test('both matching surfaces use the same offer without altering approved phone rendering', () => {
  for (const file of ['app/mypage/page.tsx', 'app/community/dating/cards/page.tsx']) {
    const src = read(file); assert.ok(src.includes('<OneOnOneContactOffer')); assert.ok(src.includes('match.counterparty_phone'));
  }
});

test('terminal provider failure can create one new checkout; a newly paid DB order stops it', async () => {
  for (const becamePaid of [false, true]) {
    const f = fixture(); let inserts = 0, providerCreates = 0;
    const db = { from(table) {
      let single = false, insert = false;
      const q = {
        select() { return q; }, eq() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; },
        insert() { insert = true; inserts++; return q; },
        single() { single = true; return q; }, maybeSingle() { single = true; return q; },
        then(ok, bad) {
          const rows = table === 'dating_1on1_match_proposals' ? [f.match] : insert ? [{ id:'new-order' }] : becamePaid ? [{id:'already-paid',status:'paid'}] : [];
          return Promise.resolve({data:single ? rows[0] : rows,error:null}).then(ok,bad);
        },
      }; return q;
    } };
    const route = actualCreate({
      ensureAllowedMutationOrigin:()=>null,getRequestAuthContext:async()=>({user:{id:'self'}}),isTossConfigured:()=>true,
      parseProductType:v=>v,PRODUCT_CONFIG:{one_on_one_contact_exchange:{amount:20000,orderName:'1:1 번호 교환'}},createAdminClient:()=>db,
      normalizeFailureOrderId:v=>v,getContactPaymentRecovery:()=>f.run(),isOneOnOnePairAgeEligible:async()=>true,getActiveOneOnOnePlus:async()=>null,
      cancelReadyOrders:async(_db,ids)=>assert.deepEqual(ids,[]),cleanText:v=>String(v??'').trim(),getBaseUrl:()=> 'https://helchang.com',
      getTossCheckoutOptions:()=>({}),getTossCheckoutMode:()=> 'fixture',json:(status,body)=>Response.json(body,{status}),
      createTossPayment:async params=>{providerCreates++;assert.equal(params.amount,20000);assert.ok(new URL(params.failUrl).searchParams.get('failedOrderId'));return {checkout:{url:'https://api.tosspayments.com/checkout/new'}};},
    });
    const res = await route(new Request('https://helchang.com/api/payments/toss/create',{method:'POST',body:JSON.stringify({productType:'one_on_one_contact_exchange',matchId:'match',recoveryOrderId:orderId})}));
    assert.equal(res.status,becamePaid?409:200); assert.equal(inserts,becamePaid?0:1); assert.equal(providerCreates,becamePaid?0:1);
  }
});

for (const [file,name] of [['app/mypage/page.tsx','handleRequestOneOnOneContactExchange'], ['app/community/dating/cards/page.tsx','handleOneOnOneContactCheckout']]) {
  test(`actual ${name} prevents concurrent clicks and unlocks a failed attempt`, async () => {
    const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let initializer;
    function visit(n) { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name) initializer=n.initializer.getText(ast); ts.forEachChild(n,visit); }
    visit(ast); assert.ok(initializer);
    const compiled = ts.transpileModule('const handler = '+initializer, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    let resolveFetch, calls=0;
    const locks={current:new Set()};
    const globals={
      useCallback:fn=>fn,oneOnOneContactCheckoutLocksRef:locks,reloadOneOnOneHome:async()=>{},
      setProcessingOneOnOneContactExchangeIds:()=>{},setProcessingOneOnOneContactIds:()=>{},
      withPaymentCardNotice:v=>v,alert:()=>{},fetch:()=>{calls++;return new Promise(resolve=>{resolveFetch=resolve;});},
    };
    const handler = new Function(...Object.keys(globals),compiled+';return handler;')(...Object.values(globals));
    const first=handler('match'), second=handler('match'); assert.equal(calls,1);
    resolveFetch(Response.json({ok:false,message:'fixture failure'},{status:409}));await Promise.all([first,second]);assert.equal(locks.current.size,0);
    const third=handler('match');assert.equal(calls,2);resolveFetch(Response.json({ok:false},{status:409}));await third;assert.equal(locks.current.size,0);
  });
}
