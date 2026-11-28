/* eslint-disable @typescript-eslint/no-require-imports */
// Runs actual routes and payment orchestration with synthetic database/provider responses only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read, load } = require('./fixtures/contact-checkout-runtime.cjs');
const { withoutLovePassPaymentAdditions, withoutLovePassMypageAdditions } = require('./fixtures/love-pass-payment-contract.cjs');
const { createHash } = require('node:crypto');
const sku = 'dating_love_pass_30d';
const userId = '00000000-0000-4000-8000-100000000001';
const grantId = '00000000-0000-4000-8000-100000000009';
const paymentKey = 'mock-no-charge-key';
const amount = 30_000;
const origin = 'https://example.test';

function harness() {
  const calls = [], orders = new Map(), payments = new Map(), grants = new Set();
  const flags = { ready: true, eligible: true, tossConfigured: true, userId };
  const grant = order => {
    order.status = 'paid';
    grants.add(order.toss_order_id);
    return reply(grantId);
  };
  function reply(data) { return { data, error: null }; }
  function error(code = 'SYNTHETIC') { return { data: null, error: { code } }; }
  const admin = {
    async rpc(name, args) {
      calls.push({ kind: 'rpc', name, args });
      if (name === 'dating_love_pass_ready') return flags.missing ? error('PGRST202') : reply(flags.ready);
      if (name === 'reserve_dating_love_pass_order') {
        if (!flags.ready) return reply({ code: 'DISABLED' });
        if ([...orders.values()].some(o => o.user_id === args.p_user_id && grants.has(o.toss_order_id) && o.status === 'paid')) return reply({ code: 'ACTIVE' });
        const ready = [...orders.values()].find(o => o.user_id === args.p_user_id && o.status === 'ready');
        if (ready) return reply({ code: 'READY', toss_order_id: ready.toss_order_id, reused: true });
        if (!flags.eligible) return reply({ code: 'INELIGIBLE' });
        const order = { id: args.p_toss_order_id, toss_order_id: args.p_toss_order_id, user_id: args.p_user_id,
          product_type: sku, order_name: '짐툴 연애 패스', amount, status: 'ready' };
        orders.set(order.toss_order_id, order);
        return reply({ code: 'READY', toss_order_id: order.toss_order_id, reused: false });
      }
      if (name === 'activate_dating_love_pass') {
        const order = orders.get(args.p_order_id);
        if (flags.failActivation || !order || args.p_payment_key !== paymentKey || !['paid', 'ready'].includes(order.status)) return error();
        if (order.status === 'ready') {
          assert.equal(args.p_approved_at, args.p_payment?.approvedAt);
          assert.equal(args.p_payment?.status, 'DONE');
          assert.equal(args.p_payment?.orderId, order.toss_order_id);
          assert.equal(args.p_payment?.paymentKey, paymentKey);
          assert.equal(args.p_payment?.totalAmount, amount);
        }
        return grant(order);
      }
      if (name === 'close_dating_love_pass_order') {
        const order = orders.get(args.p_toss_order_id);
        assert.equal(args.p_user_id, order.user_id);
        assert.equal(args.p_payment?.status, 'EXPIRED');
        if (order.status !== 'ready') return reply(false);
        order.status = 'canceled';
        return reply(true);
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table) {
      // No generic paid update, matching, notification or phone-disclosure code.
      if (table !== 'toss_test_payment_orders') throw new Error(`Unexpected table ${table}`);
      const filters = new Map();
      const q = { select: () => q, eq: (key, value) => { filters.set(key, value); return q; },
        maybeSingle: () => {
          assert.deepEqual([...filters.keys()], ['toss_order_id', 'user_id']);
          const order = orders.get(filters.get('toss_order_id'));
          return reply(order?.user_id === filters.get('user_id') ? { ...order } : null);
        } };
      return q;
    },
  };
  function approved(orderId, props = {}) {
    return { status: 'DONE', orderId, totalAmount: amount, paymentKey, approvedAt: '2026-11-23T00:00:00.000Z', method: '간편결제', ...props };
  }
  const toss = {
    isTossConfigured: () => flags.tossConfigured, getMissingTossConfigKeys: () => [],
    getTossCheckoutMode: () => 'DEFAULT', getTossCheckoutOptions: () => ({ flowMode: 'DEFAULT' }),
    async createTossPayment(params, opts) {
      calls.push({ kind: 'provider-create', params, opts });
      assert.equal(params.method, 'CARD');
      assert.equal(params.amount, amount);
      assert.equal(params.orderName, '짐툴 연애 패스');
      assert.equal(opts.idempotencyKey, `love-pass:${params.orderId}`);
      assert.equal(new URL(params.successUrl).searchParams.get('productType'), sku);
      assert.equal(new URL(params.failUrl).searchParams.get('productType'), sku);
      assert.equal(new URL(params.failUrl).searchParams.get('failedOrderId'), params.orderId);
      if (flags.failCreate) throw Error('Synthetic provider failure');
      const row = { status: 'READY', orderId: params.orderId, totalAmount: amount, checkout: { url: `https://api.tosspayments.com/checkout/${params.orderId}` } };
      payments.set(params.orderId, row);
      return row;
    },
    async getTossPaymentByOrderId(orderId) {
      calls.push({ kind: 'provider-lookup', orderId });
      if (flags.failQuery) throw new TypeError('Synthetic network failure');
      if (!payments.has(orderId)) throw new Error('{"code":"NOT_FOUND_PAYMENT"}');
      return payments.get(orderId);
    },
    async confirmTossPayment(input) {
      calls.push({ kind: 'provider-confirm', input });
      const row = approved(input.orderId, flags.approvalOverride);
      payments.set(input.orderId, row);
      if (flags.failAfterApproval) throw new Error('Synthetic connection interruption');
      return row;
    },
    async getTossPayment(key) {
      calls.push({ kind: 'provider-lookup-key', key });
      return [...payments.values()].find(p => p.paymentKey === key) ?? null;
    },
  };
  const globals = { process: { env: {} }, console: { ...console, warn() {}, error() {} } };
  const deps = {
    '@/lib/toss-payments': toss,
    '@/lib/supabase/server': { createAdminClient: () => admin },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user: flags.userId ? { id: flags.userId } : null }) },
    '@/lib/contact-intro-offer-server': { ContactIntroError: class extends Error {} },
    '@/lib/all-pass-profile-offer-server': { AllPassOfferError: class extends Error {} },
    '@/lib/dating-private-contact-server': {}, '@/lib/dating-purchase-fulfillment': {},
    '@/lib/dating-1on1-plus': {}, '@/lib/dating-swipe': {}, '@/lib/dating-more-view': {},
    '@/lib/dating-city-view': {}, '@/lib/admin': {}, '@/lib/open-card-repost': {},
    '@/lib/contact-payment-recovery': {}, '@/lib/payment-guidance': {},
  };
  const create = load('app/api/payments/toss/create/route.ts', deps, globals).POST;
  const confirm = load('app/api/payments/toss/confirm/route.ts', deps, globals).POST;
  function request(endpoint, body, requestOrigin = origin) {
    return new Request(origin + endpoint, { method: 'POST', headers: { origin: requestOrigin, host: new URL(origin).host }, body: JSON.stringify(body) });
  }
  return { calls, flags, orders, payments, grants, approved,
    start: body => create(request('/api/payments/toss/create', { productType: sku, ...body })),
    crossOrigin: () => create(request('/api/payments/toss/create', { productType: sku }, 'https://not-example.test')),
    finish: (orderId, extras) => confirm(request('/api/payments/toss/confirm', { orderId, amount, paymentKey, ...extras })),
  };
}

test('paid is written and the pass becomes available together via only the atomic grant; replay does not charge or add grants', async () => {
  const h = harness();
  const create = await h.start({ amount: 1, durationDays: 999, matchId: 'ignore-unrelated-product-field' });
  assert.equal(create.status, 200);
  const { orderId, checkoutUrl, amount: responseAmount } = await create.json();
  assert.equal(responseAmount, amount);
  assert.equal(checkoutUrl, `https://api.tosspayments.com/checkout/${orderId}`);
  assert.equal(h.orders.get(orderId).status, 'ready');
  assert.equal(h.grants.size, 0);
  h.flags.ready = false;
  h.flags.eligible = false;
  const confirm = await h.finish(orderId);
  assert.equal(confirm.status, 200);
  assert.deepEqual(await confirm.json().then(({ requestId, ...data }) => (assert.ok(requestId), data)),
    { ok: true, orderId, orderName: '짐툴 연애 패스', productType: sku, amount, method: '간편결제', alreadyConfirmed: false });
  assert.equal(h.orders.get(orderId).status, 'paid');
  assert.equal(h.grants.size, 1);
  assert.equal(await h.finish(orderId).then(r => r.json()).then(r => r.alreadyConfirmed), true);
  assert.equal(h.calls.filter(c => c.kind === 'provider-confirm').length, 1);
  assert.equal(h.calls.filter(c => c.name === 'dating_love_pass_ready').length, 1, 'existing order fulfillment never checks the sale flag');
  assert.equal(h.grants.size, 1);
});

test('sale missing/disabled, signed out, cross-origin, or profile ineligible never opens provider checkout', async () => {
  for (const [flags, status] of [[{ ready: false }, 503], [{ missing: true }, 503], [{ eligible: false }, 403], [{ userId: null }, 401]]) {
    const h = harness(); Object.assign(h.flags, flags);
    assert.equal((await h.start()).status, status);
    assert.equal(h.calls.filter(c => c.kind.startsWith('provider')).length, 0);
    assert.equal(h.orders.size, 0);
    if (flags.ready === false || flags.missing) {
      assert.deepEqual(h.calls.map(c => c.name), ['dating_love_pass_ready'], 'no reservation or data mutation while SQL is missing or sales are disabled');
    }
  }
  const h = harness();
  assert.equal((await h.crossOrigin()).status, 403);
  assert.deepEqual(h.calls, []);
});

test('ready order resumes same checkout and does not create duplicate; quote is fixed even with a removed profile', async () => {
  const h = harness();
  const first = await h.start().then(r => r.json());
  h.flags.eligible = false;
  const resumed = await h.start({ amount: 999 }).then(r => r.json());
  assert.equal(resumed.orderId, first.orderId);
  assert.equal(resumed.reusedOrder, true);
  assert.equal(h.calls.filter(c => c.kind === 'provider-create').length, 1);
  assert.equal(h.orders.size, 1);
});

test('query uncertainty preserves ready order; absence only retries the exact same order/provider idempotency key', async () => {
  const h = harness();
  h.flags.failCreate = true;
  assert.equal((await h.start()).status, 503);
  assert.equal(h.orders.size, 1);
  h.flags.failQuery = true;
  assert.equal((await h.start()).status, 503);
  h.flags.failQuery = h.flags.failCreate = false;
  assert.equal((await h.start()).status, 200);
  const creates = h.calls.filter(c => c.kind === 'provider-create');
  assert.equal(creates.length, 2);
  assert.equal(creates[0].params.orderId, creates[1].params.orderId);
  assert.equal(creates[0].opts.idempotencyKey, creates[1].opts.idempotencyKey);
  assert.equal(h.orders.size, 1);
});

test('only matching provider terminal evidence permits a fresh order', async () => {
  const h = harness();
  const first = await h.start().then(r => r.json());
  h.payments.get(first.orderId).status = 'EXPIRED';
  h.payments.get(first.orderId).totalAmount = 1;
  assert.equal((await h.start()).status, 503);
  assert.equal(h.orders.size, 1);
  h.payments.get(first.orderId).totalAmount = amount;
  const replacement = await h.start().then(r => r.json());
  assert.notEqual(replacement.orderId, first.orderId);
  assert.equal(h.orders.get(first.orderId).status, 'canceled');
  assert.equal(h.grants.size, 0);
  assert.equal((await h.finish(first.orderId)).status, 409);
});

test('the retry URL must use provider HTTPS; malformed URLs fail closed without replacing the order', async () => {
  const h = harness();
  const { orderId } = await h.start().then(r => r.json());
  for (const url of ['http://tosspayments.com/checkout', 'https://tosspayments.com.evil.test/', 'https://api.tosspayments.com:8443/', 'https://demo:secret@tosspayments.com/']) {
    h.payments.get(orderId).checkout.url = url;
    assert.equal((await h.start()).status, 503);
  }
  assert.equal(h.orders.size, 1);
  assert.equal(h.calls.filter(c => c.kind === 'provider-create').length, 1);
});

test('unknown/other user order, wrong amount, or mismatched/non-DONE provider response never activates', async () => {
  const h = harness();
  const { orderId } = await h.start().then(r => r.json());
  assert.equal((await h.finish(orderId, { amount: 1 })).status, 400);
  h.flags.userId = 'another-user';
  assert.equal((await h.finish(orderId)).status, 404);
  assert.equal(h.calls.filter(c => c.kind === 'provider-confirm').length, 0);
  h.flags.userId = userId;
  for (const override of [{ status: 'IN_PROGRESS' }, { orderId: 'other-order' }, { totalAmount: 1 }, { paymentKey: 'other-key' }, { approvedAt: null }]) {
    h.flags.approvalOverride = override;
    assert.equal((await h.finish(orderId)).status, 503);
    assert.equal(h.grants.size, 0);
    assert.equal(h.orders.get(orderId).status, 'ready');
  }
  assert.equal(h.calls.filter(c => c.name === 'activate_dating_love_pass').length, 0);
});

test('recover approved charge after a callback loss; successful follow-up does not open another checkout', async () => {
  const h = harness();
  const { orderId } = await h.start().then(r => r.json());
  h.flags.failAfterApproval = true;
  h.flags.failActivation = true;
  assert.equal((await h.finish(orderId)).status, 503);
  assert.equal(h.orders.get(orderId).status, 'ready');
  h.flags.failActivation = false;
  assert.equal(await h.start().then(r => r.json()).then(r => r.alreadyActive), true);
  assert.equal(await h.start().then(r => r.json()).then(r => r.alreadyActive), true);
  assert.equal(h.grants.size, 1);
  assert.deepEqual(h.calls.filter(c => c.kind.startsWith('provider')).map(c => c.kind),
    ['provider-create', 'provider-confirm', 'provider-lookup-key', 'provider-lookup']);
});

test('prior payment route source, excluding only these reviewed additions, is pinned', () => {
  for (const [kind, original] of Object.entries({
    create: 'a880999f44e2ebb5c63096b123e2e2d940e00b3d6d880d9b56a599d45e918f6f',
    confirm: 'ebcca9138c7c218c476c3bbc62a44dae82cce32dd5b5ea51163334ccffcdd209',
  })) {
    const route = `app/api/payments/toss/${kind}/route.ts`;
    assert.equal(createHash('sha256').update(withoutLovePassPaymentAdditions(read(route), kind)).digest('hex'), original);
  }
});

test('reviewed MyPage order status and admin links remain pinned outside the Love Pass additions', () => {
  const source = withoutLovePassMypageAdditions(read('app/mypage/page.tsx'));
  assert.equal(createHash('sha256').update(source).digest('hex'), '866f58f5a92ab4bbc5592448a1a2ad90905a1414b623b0c76ba02e7265fa70ed');
});
