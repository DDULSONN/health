/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const now = Date.parse('2026-11-27T04:00:00Z');
const uuid = n => '2f7bde57-2a5f-44f5-aa34-' + String(n).padStart(12, '0');
const me = uuid(1), them = uuid(2), other = uuid(3), myCard = uuid(4), theirCard = uuid(5), foreignCard = uuid(6);
const received = (patch = {}) => ({ id: uuid(7), source_user_id: them, candidate_user_id: me,
  source_card_id: theirCard, candidate_card_id: myCard, ...patch });
const source = { id: myCard, user_id: me, birth_year: 1994, sex: 'male', region: '서울 마포구', phone: '+821000000001',
  created_at: '2026-11-10T00:00:00Z' };
const candidate = { id: theirCard, user_id: them, birth_year: 1995, sex: 'female', region: source.region, phone: '+821000000002',
  created_at: '2026-11-25T00:00:00Z' };
const load = (name, stubs) => {
  const exp = {};
  const js = ts.transpileModule(fs.readFileSync(path.join(root, name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, { exports: exp, require(id) {
    assert.ok(id in stubs, 'Unexpected dependency: ' + id); return stubs[id];
  }, Request, Response, Date, URL });
  return exp;
};
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(options = {}) {
  const reads = [], providerReads = [], authReads = [], rateReads = [];
  const db = { auth: { admin: { getUserById: async id => {
    authReads.push(id);
    return options.peerAuthError ? { data: { user: null }, error: { code: 'fixture' } } : {
      data: { user: { id, app_metadata: { internal_test_suite: options.peerInternal || undefined },
        banned_until: options.peerBanned ? '2099-01-01T00:00:00Z' : null } }, error: null,
    };
  } } }, from(table) {
    const entry = { table, fields: '', calls: [] };
    let single = false;
    const q = { select(fields) { entry.fields = fields; return q; },
      then(resolve, reject) {
        reads.push(entry);
        const has = (method, column, expected) => entry.calls.some(([m,c,v]) => m === method && c === column && (expected === undefined || v === expected));
        let value = [], error = options.failTable === table ? { code: 'fixture' } : null;
        if (table === 'profiles') {
          assert.ok(has('eq', 'user_id', me)); value = [{ phone_verified: options.verified !== false, is_banned: options.banned === true }];
        } else if (table === 'dating_1on1_cards') {
          if (has('eq','user_id',me)) value = options.noProfile ? [] : [source];
          else if (has('eq','region',source.region)) {
            assert.ok(has('eq', 'status', 'approved')); assert.ok(has('limit', 8)); value = options.noStock ? [] : [candidate];
          } else value = options.badAge ? [source, { ...candidate, birth_year: 2015 }] : [source, candidate];
        } else if (table === 'dating_1on1_match_proposals') {
          if (has('eq','candidate_user_id',me)) {
            assert.ok(has('eq','state','source_selected')); assert.ok(has('limit',41));
            value = options.rows ?? [];
          } else value = options.priorPair ? [received()] : [];
        } else if (table === 'dating_chat_threads') {
          assert.ok(entry.calls.some(([m,v]) => m === 'or' && v.includes(me)));
          value = options.recentChat ? [{ id: uuid(9) }] : [];
        } else if (table === 'dating_card_applications') {
          assert.ok(has('eq','applicant_user_id',me));
          value = has('eq','status','accepted') ? (options.recentAcceptance ? [{ id: uuid(12) }] : [])
            : (options.unconnectedSupport ? [{ id: uuid(10) }] : []);
        } else if (table === 'dating_cards') {
          assert.ok(has('eq','owner_user_id',me));
          value = options.noOpenCard ? [] : [{ ...source, age: 33 }];
        } else if (table === 'site_settings') value = [{ value_json: { status: options.paused ? 'paused' : 'approved' } }];
        else if (table === 'dating_1on1_candidate_hides') value = options.hidden ? [{ candidate_user_id: them }] : [];
        else if (table === 'dating_1on1_candidate_impressions') value = options.seen ? [{ candidate_user_id: them }] : [];
        else if (table === 'dating_1on1_candidate_favorites') value = options.favorite ? [{ candidate_card_id: theirCard }] : [];
        else if (table === 'dating_1on1_recommendation_pages') value = options.stale ? [{ refreshed_at: '2026-11-26T00:00:00Z' }] : [];
        else throw Error('Unexpected table: ' + table);
        return Promise.resolve({ data: single ? value[0] ?? null : value, error }).then(resolve, reject);
      }
    };
    for (const name of ['eq','in','neq','or','gte','lte','order','limit','maybeSingle']) q[name] = (...args) => {
      if (name === 'maybeSingle') single = true;
      entry.calls.push([name, ...args]); return q;
    };
    return q;
  }};
  const helpers = {
    '@/lib/contact-care-targets': { getContactExchangeBlockedPeers: async (db, viewer) => {
      assert.equal(viewer, me);
      if (options.blockError) throw Error('known block lookup failure');
      return new Set(options.blocked ? [them] : []);
    } },
    '@/lib/dating-1on1': { DATING_ONE_ON_ONE_ACTIVE_STATUSES: ['submitted','reviewing','approved'], toDatingOneOnOneAge: by => 2026 - by + 1 },
    '@/lib/dating-1on1-current-cards': { getCurrentOneOnOneCardIds: async () => new Set(options.noCurrent ? [] : [theirCard]) },
    '@/lib/dating-1on1-phone-blocks': { normalizePhoneForOneOnOneBlock: x => x },
    '@/lib/dating-1on1-recommendation-data': {
      fetchRecommendationProfiles: async () => new Map([[me, { banned: false, phone: source.phone }],
        [them, { banned: false, phone: options.duplicatePhone ? source.phone : candidate.phone }]]),
      fetchRecommendationAvailabilityDetails: async () => new Map([[theirCard, { ...candidate, hasPhoto: !options.noPhoto }]])
    },
    '@/lib/dating-1on1-recommendations': { isCandidateInSourceAgeRange: () => !options.wrongAgeBand },
    '@/lib/dating-age': { MIN_DATING_AGE: 19, parseDatingBirthYear: y => y >= 1960 && y <= 2007 ? y : null },
    '@/lib/region-distance': { getRegionDistanceMeta: () => ({ distanceKm: options.unknownRegion ? null : 0 }) },
    '@/lib/dating-1on1-match-navigation': { normalizeOneOnOneMatchId: x => /^[a-f0-9-]{36}$/i.test(x ?? '') ? x : null },
  };
  const helper = load('lib/dating-open-card-one-on-one-entry.ts', helpers);
  const picker = async () => { providerReads.push('contactNotice'); return options.mutual ?? null; };
  const route = load('app/api/dating/1on1/contact-home-notice/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) }},
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user: options.guest ? null : {
      id: me, app_metadata: { internal_test_suite: options.viewerInternal || undefined },
      banned_until: options.viewerBanned ? '2099-01-01T00:00:00Z' : null,
    } }) },
    '@/lib/supabase/server': { createAdminClient: () => db },
    '@/lib/dating-1on1-contact-home-notice': { getContactHomeNoticeMatchId: picker },
    '@/lib/dating-open-card-one-on-one-entry': helper,
    '@/lib/request-rate-limit': {
      checkRouteRateLimit: async params => { rateReads.push(params); return { allowed: !options.limited, retryAfterSec: 17 }; },
      extractClientIp: () => '127.0.0.1',
    },
    'node:crypto': { randomUUID: () => 'fixture-request-id' },
  });
  return { reads, providerReads, authReads, rateReads, route, pick: () => helper.readOpenCardOneOnOneEntry(db, me, now, picker).then(clone) };
}

test('preview is private, read-only, uses session, never infers an account from query parameters', async () => {
  const url = 'https://fixture.invalid/api/dating/1on1/contact-home-notice?entry=1&userId=' + other;
  const f = fixture({ guest: true });
  const r = await f.route.GET(new Request(url));
  assert.equal(r.status, 401); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(f.reads, []);
  const verified = fixture({ noStock: true });
  const response = await verified.route.GET(new Request(url, { headers: { 'X-Jimtul-Viewer': me } }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('vary'), 'Cookie, Authorization');
  assert.deepEqual(Object.keys(await response.json()).sort(), ['hasIncoming','incomingCount','matchId','suggestion']);
  const switched = fixture({ rows: [received()] });
  const mismatch = await switched.route.GET(new Request(url, { headers: { 'X-Jimtul-Viewer': other } }));
  assert.equal(mismatch.status, 409); assert.deepEqual(switched.reads, []); assert.deepEqual(switched.rateReads, []);
  assert(!Object.keys(verified.route).some(verb => ['POST','PUT','PATCH','DELETE'].includes(verb)));
});

test('canonical received rows outrank promotions, active chats and mutual flow, with a true bounded count', async () => {
  const f = fixture({ rows: [received(), received({ id: uuid(99), source_card_id: foreignCard }), received({ candidate_user_id: other })],
    recentChat: true, mutual: uuid(8) });
  assert.deepEqual(await f.pick(), { hasIncoming: true, incomingCount: 1, matchId: null, suggestion: null });
  assert.deepEqual(f.providerReads, []);
  assert(!f.reads.some(r => r.table === 'dating_chat_threads'));
  const dense = fixture({ rows: Array.from({ length: 41 }, (_, i) => received({ id: uuid(100+i) })) });
  assert.deepEqual(await dense.pick(), { hasIncoming: true, incomingCount: null, matchId: null, suggestion: null });
});

test('unknown, blocked, ineligible, or wrong-account requests cannot show counts', async () => {
  for (const f of [fixture({ blocked: true, rows: [received()] }), fixture({ blockError: true, rows: [received()] }),
    fixture({ badAge: true, rows: [received()] }), fixture({ verified: false }), fixture({ banned: true })]) {
    const result = await f.pick();
    assert.equal(result.hasIncoming, false); assert.notEqual(result.incomingCount, 1);
  }
});

test('auth-only bans, internal test suite and incomplete peer lookups do not produce permission signals', async () => {
  for (const option of ['peerInternal', 'peerBanned', 'peerAuthError']) {
    const f = fixture({ [option]: true, rows: [received()] });
    const result = await f.pick();
    assert.equal(result.hasIncoming, false); assert.equal(result.suggestion, null);
    assert.deepEqual(f.authReads, [them, ...(option === 'peerAuthError' ? [] : [them])]);
    assert.equal((await fixture({ [option]: true }).pick()).suggestion, null);
  }
  const url = 'https://fixture.invalid/api/dating/1on1/contact-home-notice';
  const request = suffix => new Request(url+suffix, { headers: { 'X-Jimtul-Viewer': me } });
  for (const role of ['viewerInternal', 'viewerBanned']) {
    const f = fixture({ [role]: true, rows: [received()] });
    const denied = await f.route.GET(request('?entry=1'));
    assert.deepEqual(await denied.json(), { hasIncoming: false, incomingCount: null, suggestion: null, matchId: null });
    assert.deepEqual(f.reads, []); assert.deepEqual(f.rateReads, []);
  }
  const limited = fixture({ limited: true, mutual: uuid(8) });
  const res = await limited.route.GET(request('?entry=1&userId='+other));
  assert.equal(res.status, 429); assert.equal(res.headers.get('retry-after'), '17');
  assert.deepEqual(limited.reads, []); assert.equal(limited.rateReads[0].userId, me);
  assert.equal(limited.rateReads[0].userLimitPerMin, 8);
  assert.deepEqual(await (await limited.route.GET(new Request(url))).json(), { matchId: uuid(8) });
  assert.equal(limited.rateReads.length, 1, 'legacy notice does not use the new limit');
});

test('verified same-region unseen nearby stock may trigger only after existing mutual and OpenCard chat signals', async () => {
  assert.equal((await fixture().pick()).suggestion, 'nearby');
  const mutual = fixture({ mutual: uuid(8) });
  assert.equal((await mutual.pick()).matchId, uuid(8));
  assert(!mutual.reads.some(r => r.table === 'dating_chat_threads'));
  for (const option of ['hidden','seen','priorPair','favorite','stale','duplicatePhone','noPhoto','wrongAgeBand',
    'unknownRegion','noCurrent','recentChat','recentAcceptance','noStock']) {
    assert.equal((await fixture({ [option]: true }).pick()).suggestion, null, option);
  }
  assert.equal((await fixture({ failTable: 'dating_1on1_candidate_impressions' }).pick()).suggestion, null);
});

test('OpenCard-only re-use depends on actual unconnected support, write eligibility and viable stock', async () => {
  const opts = { noProfile: true, unconnectedSupport: true };
  assert.equal((await fixture(opts).pick()).suggestion, 'profile');
  for (const extra of [{ unconnectedSupport: false }, { noOpenCard: true }, { noStock: true }, { paused: true }, { recentChat: true }]) {
    assert.equal((await fixture({ ...opts, ...extra }).pick()).suggestion, null, JSON.stringify(extra));
  }
  const f = fixture({ ...opts, verified: false });
  assert.deepEqual(await f.pick(), { hasIncoming: false, incomingCount: null, matchId: null, suggestion: null });
  assert.deepEqual(f.reads.map(r => r.table), ['profiles']);
});
