/* eslint-disable @typescript-eslint/no-require-imports */
// Executed against an in-memory, read-only PostgREST seam. No auth accounts,
// payment providers, notifications, external network, or DB writes are used.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const routeFile = 'app/api/dating/1on1/contact-home-notice/route.ts';
const helperFile = 'lib/dating-1on1-contact-home-notice.ts';
const compiled = new Map();
function load(file, deps) {
  if (!compiled.has(file)) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    compiled.set(file, new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    } }).outputText));
  }
  const exp = {};
  compiled.get(file)(name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', deps);
    throw Error('unexpected dependency: ' + name);
  }, exp);
  return exp;
}

const me = '00000000-0000-4000-8000-000000000001';
const peer = '00000000-0000-4000-8000-000000000002';
const peer2 = '00000000-0000-4000-8000-000000000003';
const stranger = '00000000-0000-4000-8000-000000000004';
const first = '00000000-0000-4000-8000-000000000010';
const next = '00000000-0000-4000-8000-000000000011';
const ownCard = '00000000-0000-4000-8000-000000000020';
const theirCard = '00000000-0000-4000-8000-000000000021';
const nextCard = '00000000-0000-4000-8000-000000000022';
const nudgeId = '00000000-0000-4000-8000-000000000030';
const HOUR = 60 * 60 * 1000;
const now = Date.now();
const ago = h => new Date(now - h * HOUR).toISOString();
const proposal = (patch = {}) => ({
  id: first, source_user_id: me, candidate_user_id: peer,
  source_card_id: ownCard, candidate_card_id: theirCard,
  state: 'mutual_accepted', contact_exchange_status: 'awaiting_applicant_payment',
  source_final_responded_at: ago(3), candidate_responded_at: ago(4),
  contact_exchange_paid_at: null, contact_exchange_approved_at: null,
  contact_exchange_paid_by_user_id: null, updated_at: ago(3), created_at: ago(6),
  ...patch,
});
const card = (id, user_id, patch = {}) => ({ id, user_id, status: 'approved', birth_year: 1996, admin_tags: [], ...patch });
const secondProposal = () => proposal({ id: next, candidate_user_id: peer2, candidate_card_id: nextCard,
  source_final_responded_at: ago(6), candidate_responded_at: ago(7), created_at: ago(8) });
const order = (patch = {}) => ({
  product_ref_id: first, product_type: 'one_on_one_contact_exchange', status: 'ready',
  created_at: ago(.01), updated_at: ago(.01), user_id: me, ...patch,
});
const nudge = (patch = {}) => ({
  id: nudgeId, match_id: first, sender_user_id: me, recipient_user_id: peer,
  preset_key: 'want_to_exchange', message_text: 'fixture', created_at: ago(2), read_at: null, ...patch,
});

function splitOr(value) {
  const terms = [];
  let depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    if (value[i] === ')') depth--;
    if (value[i] === ',' && depth === 0) {
      terms.push(value.slice(start, i));
      start = i + 1;
    }
  }
  return [...terms, value.slice(start)];
}
function applyTerm(row, term) {
  if (term.startsWith('and(')) return splitOr(term.slice(4, -1)).every(t => applyTerm(row, t));
  if (term.startsWith('or(')) return splitOr(term.slice(3, -1)).some(t => applyTerm(row, t));
  const [, field, op, value] = /^([a-z_]+)\.(eq|is|gte|gt|lte|lt|in)\.(.+)$/.exec(term) ?? [];
  assert.ok(field, 'unexpected PostgREST condition: ' + term);
  if (op === 'in') return value.slice(1, -1).split(',').includes(row[field]);
  if (op === 'eq') return String(row[field]) === value;
  if (op === 'is') return value === 'null' ? row[field] == null : String(row[field]) === value;
  return row[field] != null && ({ gte: row[field] >= value, gt: row[field] > value, lte: row[field] <= value, lt: row[field] < value })[op];
}

function dbFixture(options = {}) {
  const queries = [];
  const store = {
    dating_1on1_match_proposals: options.matches ?? [proposal()],
    dating_1on1_cards: options.cards ?? [card(ownCard, me), card(theirCard, peer), card(nextCard, peer2)],
    toss_test_payment_orders: options.orders ?? [],
    dating_1on1_contact_nudges: options.nudges ?? [],
    dating_1on1_contact_nudge_replies: options.replies ?? [],
  };
  const db = {
    from(table) {
      assert.ok(Object.hasOwn(store, table), 'unexpected table: ' + table);
      const calls = [];
      const entry = { table, calls };
      queries.push(entry);
      let filters = [], sorters = [], offset = 0, pageSize = Infinity, fields = [], single = false;
      const where = (op, field, value, fn) => { calls.push([op, field, value]); filters.push(fn); return q; };
      const q = {
        select(value) {
          assert.ok(typeof value === 'string' && !value.includes('*'), 'only explicit read fields');
          entry.fields = value;
          fields = value.split(',').map(s => s.trim());
          return q;
        },
        eq(field, value) { return where('eq', field, value, row => row[field] === value); },
        in(field, values) { return where('in', field, values, row => values.includes(row[field])); },
        is(field, value) { return where('is', field, value, row => value === null ? row[field] == null : row[field] === value); },
        gte(field, value) { return where('gte', field, value, row => row[field] != null && row[field] >= value); },
        gt(field, value) { return where('gt', field, value, row => row[field] != null && row[field] > value); },
        lte(field, value) { return where('lte', field, value, row => row[field] != null && row[field] <= value); },
        lt(field, value) { return where('lt', field, value, row => row[field] != null && row[field] < value); },
        not(field, op, value) {
          assert.ok(op === 'is' || op === 'cs', op);
          return where('not.' + op, field, value, row => op === 'is' ? row[field] != null : !row[field]?.includes(value.slice(1, -1)));
        },
        or(value) { return where('or', null, value, row => splitOr(value).some(term => applyTerm(row, term))); },
        order(field, spec = {}) { calls.push(['order', field, spec]); sorters.push([field, spec]); return q; },
        limit(n) { calls.push(['limit', n]); pageSize = n; return q; },
        range(a, b) { calls.push(['range', a, b]); offset = a; pageSize = b - a + 1; return q; },
        maybeSingle() { single = true; return q; },
        abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return q; },
        then(resolve, reject) {
          assert.ok(fields.length > 0, 'read must request named fields');
          if (options.errorTable === table) {
            return Promise.resolve({ data: null, error: { code: 'XX000', message: 'sensitive synthetic failure' } }).then(resolve, reject);
          }
          const result = store[table].filter(row => filters.every(fn => fn(row))).sort((a, b) => {
            for (const [field, spec] of sorters) {
              if (a[field] == b[field]) continue;
              if (a[field] == null || b[field] == null) return (a[field] == null ? 1 : -1) * (spec.nullsFirst ? -1 : 1);
              return (a[field] < b[field] ? -1 : 1) * (spec.ascending === false ? -1 : 1);
            }
            return 0;
          }).slice(offset, offset + pageSize).map(row => Object.fromEntries(fields.map(field => [field, row[field]])));
          return Promise.resolve({ data: single ? result[0] ?? null : result, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { db, queries };
}

function fixture(options = {}) {
  const { db, queries } = dbFixture(options);
  let clients = 0;
  const stubUser = options.unauthenticated ? null : { id: options.user ?? me };
  const dependencies = {
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user: stubUser }) },
    '@/lib/supabase/server': { createAdminClient: () => { clients++; return db; } },
    '@/lib/contact-care-targets': { getContactExchangeBlockedPeers: async (client, userId, peers) => {
      assert.equal(client, db);
      assert.equal(userId, stubUser?.id ?? me);
      assert.ok(Array.isArray(peers));
      if (options.blockError) throw Error('sensitive synthetic block fault');
      return new Set(options.blocked ?? []);
    } },
    'next/server': { NextResponse: { json: (payload, init) => Response.json(payload, init) } },
  };
  const helper = load(helperFile, dependencies);
  const route = load(routeFile, { ...dependencies, '@/lib/dating-1on1-contact-home-notice': helper });
  return {
    read: () => route.GET(new Request('https://fixture.invalid/api/dating/1on1/contact-home-notice?userId=' + stranger)),
    pick: () => helper.getContactHomeNoticeMatchId(db, stubUser?.id ?? me, now),
    clients: () => clients, queries, route,
  };
}

test('GET is authenticated, private and never queries with a URL-supplied user', async () => {
  const guest = fixture({ unauthenticated: true });
  const guestRes = await guest.read();
  assert.equal(guest.clients(), 0);
  assert.deepEqual(guest.queries, []);
  assert.match(guestRes.headers.get('cache-control'), /private,\s*no-store/);
  assert.equal(guestRes.status, 401);
  assert.deepEqual(await guestRes.json(), { matchId: null });

  const member = fixture(), response = await member.read();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { matchId: first });
  for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(member.route[verb], undefined);
  const matchRead = member.queries.find(query => query.table === 'dating_1on1_match_proposals');
  assert.ok(matchRead.calls.some(([method, , value]) => method === 'or' && value.includes('source_user_id.eq.' + me) && value.includes('candidate_user_id.eq.' + me)));
  assert.ok(matchRead.calls.some(([method, count]) => method === 'limit' && count === 12));
  assert.doesNotMatch(matchRead.fields, /\b(?:message_text|phone|instagram|name|nickname)\b/);
});

test('recency uses the actual mutual acceptance time, inclusive of exactly seven days', async () => {
  const sevenDays = 7 * 24;
  for (const [patch, expected] of [
    [{ source_final_responded_at: ago(sevenDays), created_at: ago(sevenDays + 48) }, first],
    [{ source_final_responded_at: ago(sevenDays) }, first],
    [{ source_final_responded_at: ago(sevenDays + .01), created_at: ago(0) }, null],
    [{ source_final_responded_at: null, candidate_responded_at: ago(1) }, null],
    [{ source_final_responded_at: ago(-1) }, null],
  ]) assert.equal(await fixture({ matches: [proposal(patch)] }).pick(), expected, JSON.stringify(patch));
});

test('both participants and both payable states can receive a notice', async () => {
  for (const status of ['none', 'awaiting_applicant_payment']) {
    for (const reverse of [false, true]) {
      const match = proposal(reverse ? { source_user_id: peer, candidate_user_id: me, source_card_id: theirCard, candidate_card_id: ownCard } : {});
      assert.equal(await fixture({ matches: [{ ...match, contact_exchange_status: status }] }).pick(), first);
    }
  }
});

test('newer ineligible proposals neither hide older eligible ones nor leak them if none qualify', async () => {
  const scenarios = [
    { state: 'proposed' }, { state: 'source_selected' }, { state: 'candidate_accepted' }, { state: 'admin_canceled' },
    { contact_exchange_status: 'approved' }, { contact_exchange_status: 'payment_pending_admin' }, { contact_exchange_status: 'canceled' },
    { contact_exchange_paid_at: ago(1) }, { contact_exchange_approved_at: ago(1) },
    { source_final_responded_at: ago(8 * 24), candidate_responded_at: ago(9 * 24), created_at: ago(9 * 24) },
    { source_final_responded_at: null, candidate_responded_at: null, created_at: ago(8 * 24) },
    { source_user_id: stranger }, { id: 'not-a-match-id' }, { candidate_card_id: 'missing' },
  ];
  for (const patch of scenarios) {
    assert.equal(await fixture({ matches: [proposal(patch), secondProposal()] }).pick(), next, JSON.stringify(patch));
    assert.equal(await fixture({ matches: [proposal(patch)] }).pick(), null, JSON.stringify(patch));
  }
});

test('blocked peers and unavailable profiles fail quietly without hiding a valid second match', async () => {
  assert.equal(await fixture({ matches: [proposal(), secondProposal()], blocked: [peer] }).pick(), next);
  assert.equal(await fixture({ blocked: [peer] }).pick(), null);
  for (const status of ['rejected', 'hidden', 'deleted']) {
    const cards = [card(ownCard, me), card(theirCard, peer, { status }), card(nextCard, peer2)];
    assert.equal(await fixture({ matches: [proposal(), secondProposal()], cards }).pick(), next);
  }
  const replaced = [card(ownCard, me), card(theirCard, stranger), card(nextCard, peer2)];
  assert.equal(await fixture({ matches: [proposal(), secondProposal()], cards: replaced }).pick(), next);
});

test('negative replies, successful orders, and very recent ready orders are not promoted', async () => {
  const negative = { nudge_id: nudgeId, preset_key: 'not_right_now', created_at: ago(1) };
  assert.equal(await fixture({ matches: [proposal(), secondProposal()], nudges: [nudge()], replies: [negative] }).pick(), next);
  assert.equal(await fixture({ nudges: [nudge({ sender_user_id: peer, recipient_user_id: me })], replies: [negative] }).pick(), null);
  assert.equal(await fixture({ nudges: [nudge()], replies: [{ ...negative, preset_key: 'happy_to_talk' }] }).pick(), first);
  for (const orders of [[order()], [order({ status: 'paid', created_at: ago(70) })], [order({ user_id: peer })],
    [order({ created_at: ago(30), payment_key: 'fixture-payment-key' })], [order({ created_at: ago(30), approved_at: ago(1) })],
    [order({ created_at: ago(.5) })]]) {
    assert.equal(await fixture({ matches: [proposal(), secondProposal()], orders }).pick(), next);
  }
  for (const orders of [[order({ status: 'canceled' })], [order({ status: 'ready', created_at: ago(24), updated_at: ago(24) })],
    [order({ product_type: 'overlap' })], [order({ product_ref_id: next })]]) {
    assert.equal(await fixture({ orders }).pick(), first);
  }
});

test('query limit avoids unbounded selection and a capped order scan is fail-closed', async () => {
  const matches = Array.from({ length: 12 }, (_, i) => proposal({
    id: '00000000-0000-4000-8000-' + String(100 + i).padStart(12, '0'),
  }));
  assert.equal(await fixture({ matches: [...matches, secondProposal()], blocked: [peer] }).pick(), null);
  const orders = Array.from({ length: 120 }, () => order({ status: 'ready', created_at: ago(40) }));
  assert.equal(await fixture({ orders }).pick(), null);
  assert.equal(await fixture({ orders: orders.slice(1) }).pick(), first);
});

test('a failing private read cannot produce an encouragement or expose response data', async () => {
  for (const options of [
    { errorTable: 'dating_1on1_match_proposals' }, { errorTable: 'dating_1on1_cards' }, { errorTable: 'toss_test_payment_orders' },
    { errorTable: 'dating_1on1_contact_nudges' }, { errorTable: 'dating_1on1_contact_nudge_replies', nudges: [nudge()] },
    { blockError: true },
  ]) {
    const response = await fixture(options).read();
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { matchId: null });
  }
});
