/* eslint-disable @typescript-eslint/no-require-imports */
// Run the actual list and swipe readers against a DB-like paged synthetic store.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const viewer = id(900);
const date = n => new Date(Date.UTC(2026, 10, 24, 10, 0, n)).toISOString();
const row = (n, membersOnly = false) => {
  const owner = id(1000 + n);
  return {
    id: id(n), owner_user_id: owner, sex: 'male', display_nickname: `가상 후보 ${n}`, age: 31, region: '서울',
    status: 'public', expires_at: '2099-01-01T00:00:00.000Z', created_at: date(n), published_at: date(n),
    members_only: membersOnly, photo_visibility: 'blur', blur_paths: [`cards/${owner}/blur/mock.webp`],
    blur_thumb_path: `cards/${owner}/blur/thumb.webp`, photo_paths: [`cards/${owner}/raw/mock.jpg`], instagram_id: `fixture${n}`,
  };
};
const hidden = row(4, true);
const publicRows = [row(3), row(2), row(1)];
const pageData = [hidden, ...publicRows];
const expectedSignedPath = (path, suffix = '') => '/i/signed/dating-card-photos/' + path + suffix;
const cdn = 'https://fixture.supabase.invalid';

function fixture({ signedIn = false, legacy = false, missingFlag = false, blocked = false, contactBlocked = false,
  cards = pageData } = {}) {
  const queries = [], publicPhotoReads = [], writeAttempts = [];
  const user = signedIn ? { id: viewer, email: 'viewer@example.invalid' } : null;
  const tables = {
    dating_cards: cards,
    profiles: cards.map(card => ({ user_id: card.owner_user_id, phone_verified: true, is_banned: false, swipe_profile_visible: true })),
  };
  const admin = {
    from(table) {
      const predicates = [], filters = [], orders = [];
      let fields = '', limit = Infinity, from = 0;
      const query = {
        select(cols) { fields = cols; return query; },
        eq(key, value) { filters.push([key, value]); predicates.push(row => row[key] === value); return query; },
        in(key, values) { predicates.push(row => values.includes(row[key])); return query; },
        gt(key, value) { predicates.push(row => row[key] > value); return query; },
        gte(key, value) { predicates.push(row => row[key] >= value); return query; },
        lte(key, value) { predicates.push(row => row[key] <= value); return query; },
        lt(key, value) { predicates.push(row => row[key] < value); return query; },
        is(key, value) { predicates.push(row => row[key] === value); return query; },
        or(expression) {
          if (table === 'dating_card_swipe_matches') {
            assert.equal(expression, `user_a_id.eq.${viewer},user_b_id.eq.${viewer}`);
            predicates.push(row => row.user_a_id === viewer || row.user_b_id === viewer);
            return query;
          }
          const match = /^published_at\.lt\.([^,]+),published_at\.is\.null,and\(published_at\.eq\.([^,]+),id\.lt\.([^)]+)\)$/.exec(expression);
          assert.ok(match, expression);
          assert.equal(match[1], match[2]);
          predicates.push(row => row.published_at === null || row.published_at < match[1] || (row.published_at === match[1] && row.id < match[3]));
          return query;
        },
        order(key, { ascending = true } = {}) { orders.push([key, ascending]); return query; },
        limit(n) { limit = n; return query; },
        range(start, end) { from = start; limit = end - start + 1; return query; },
        then(resolve, reject) {
          const beforeLimit = (tables[table] ?? []).filter(row => predicates.every(filter => filter(row)));
          const ordered = beforeLimit.sort((a, b) => {
            for (const [key, ascending] of orders) {
              if (a[key] === b[key]) continue;
              if (a[key] == null) return 1;
              if (b[key] == null) return -1;
              return (a[key] < b[key] ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          });
          const returned = ordered.slice(from, from + limit);
          queries.push({ table, fields, filters, limit, returnedIds: returned.map(row => row.id) });
          const missing = table === 'dating_cards' &&
            (missingFlag && (fields.includes('members_only') || filters.some(([key]) => key === 'members_only'))
              || legacy && fields.includes('strengths_text'));
          const result = missing ? { data: null, error: { code: '42703' } }
            : { data: returned.map(row => Object.fromEntries(fields.split(',').map(key => [key.trim(), row[key.trim()]]))), error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name) {
      assert.equal(name, 'get_dating_love_pass_swipe_users');
      return { data: [], error: null };
    },
    storage: { from: bucket => ({
      getPublicUrl: object => {
        publicPhotoReads.push([bucket, object]);
        return { data: { publicUrl: `${cdn}/storage/v1/object/public/${bucket}/${object}` } };
      },
    }) },
  };
  const deps = {
    'next/server': { NextResponse: Response },
    'next/image': { default: () => null },
    'next/link': { default: () => null },
    'react/jsx-runtime': {},
    './LandingSeenMarker': {},
    './LandingPage.module.css': {},
    '@/components/LandingStories': {},
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user }) },
    '@/lib/supabase/server': { createAdminClient: () => admin },
    '@/lib/dating-cards-queue': { syncOpenCardQueue: async () => writeAttempts.push('queue sync') },
    '@/lib/throttled-task': { shouldRunAtMostEvery: async () => false },
    '@/lib/request-rate-limit': { extractClientIp: () => null, checkRouteRateLimit: async () => ({ allowed: true }) },
    '@/lib/dating-blocks': { getDatingBlockedUserIds: async () => new Set(blocked ? [hidden.owner_user_id] : []) },
    '@/lib/dating-contact-blocks': {
      filterDatingCardsByContactBlocks: async (_admin, _user, rows) => contactBlocked ? rows.filter(row => row.owner_user_id !== hidden.owner_user_id) : rows,
    },
    '@/lib/edge-kv': { kvGetString: async key => key.startsWith('litepublic:missing:') ? null : 'present', kvSetString: async () => writeAttempts.push('cache set') },
    '@/lib/dating-viewer-sex': { resolveDatingViewerSex: async () => ({ status: 'resolved', viewerSex: 'female', targetSex: 'male', source: 'open_card' }) },
    '@/lib/admin': { isAllowedAdminUser: () => false },
    '@/lib/dating-open': { getKstDayRangeUtc: () => ({ dayKey: '2026-11-24' }) },
    '@/lib/marketing-email': {},
    '@/lib/dating-open-quick-pass': { OPEN_QUICK_PASS: { dailyLikes: 50 } },
  };
  const cache = new Map();
  function load(file, suffix = '') {
    const key = file + suffix;
    if (cache.has(key)) return cache.get(key);
    const source = fs.readFileSync(path.join(root, file), 'utf8') + suffix;
    const { outputText } = ts.transpileModule(source, { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } });
    const out = {};
    cache.set(key, out);
    new Function('exports', 'require', 'process', 'fetch', 'console', outputText)(out, name => {
      if (Object.hasOwn(deps, name)) return deps[name];
      if (name === '@/lib/images' || name === '@/lib/dating-card-photo-visibility') return load(name.slice(2) + '.ts');
      assert.fail(`Unexpected dependency: ${name}`);
    }, { env: { NEXT_PUBLIC_SUPABASE_URL: cdn } }, () => assert.fail('Unexpected upstream fetch'), { log() {}, warn() {}, error() {} });
    return out;
  }
  return {
    admin, queries, publicPhotoReads, writeAttempts,
    list: params => load('app/api/dating/cards/public/route.ts').GET(new Request('https://fixture.invalid/api/dating/cards/list?' + params)),
    swipe: () => load('lib/dating-swipe.ts'),
    landing: () => load('app/landing/page.tsx', '\nexport { loadLandingCards };').loadLandingCards(),
  };
}

for (const legacy of [false, true]) test(`guest exclusion precedes page/cursor cutoff (legacy=${legacy})`, async () => {
  const f = fixture({ legacy });
  const list = await f.list('sex=male&limit=2');
  assert.match(list.headers.get('Cache-Control'), /no-store/);
  assert.equal(list.headers.get('CDN-Cache-Control'), 'no-store');
  const first = await list.json();
  assert.equal(first.previewOnly, true);
  assert.deepEqual(first.items.map(item => item.id), publicRows.slice(0, 2).map(row => row.id));
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursorId, publicRows[1].id);
  assert.equal(first.nextCursorCreatedAt, publicRows[1].published_at);
  const cursor = new URLSearchParams({ sex: 'male', limit: '2', cursorId: first.nextCursorId, cursorCreatedAt: first.nextCursorCreatedAt });
  const second = await (await f.list(cursor)).json();
  assert.deepEqual(second.items.map(item => item.id), [publicRows[2].id]);
  assert.equal(second.hasMore, false);
  const reads = f.queries.filter(q => q.table === 'dating_cards');
  assert.equal(reads.length, legacy ? 4 : 2);
  for (const query of reads) {
    assert.deepEqual(query.filters.find(([field]) => field === 'members_only'), ['members_only', false]);
    assert.equal(query.limit, 3);
    assert.ok(!query.returnedIds.includes(hidden.id));
  }
  assert.ok(!f.publicPhotoReads.some(([, object]) => object.includes(hidden.owner_user_id)));
  assert.deepEqual(f.writeAttempts, []);
});

for (const legacy of [false, true]) test(`eligible members retain the card and never receive its raw mirror URL (legacy=${legacy})`, async () => {
  const f = fixture({ signedIn: true, legacy });
  const res = await f.list('sex=male&limit=4');
  assert.equal(res.status, 200);
  const data = await res.json();
  const subject = data.items.find(card => card.id === hidden.id);
  assert.ok(subject);
  assert.ok(subject.image_urls.length >= 1);
  for (const photo of subject.image_urls) assert.ok(photo.startsWith(expectedSignedPath(`cards/${hidden.owner_user_id}/blur/`)));
  assert.ok(data.items.filter(card => card.id !== hidden.id).some(card => card.image_urls.some(photo => photo.startsWith(cdn))));
  assert.ok(f.queries.filter(q => q.table === 'dating_cards').every(q => !q.filters.some(([field]) => field === 'members_only')));
  assert.ok(!f.publicPhotoReads.some(([, object]) => object.includes(hidden.owner_user_id)));
  assert.equal(Object.hasOwn(subject, 'members_only'), false, 'internal setting is not exposed in the API');
  assert.deepEqual(f.writeAttempts, []);
});

test('existing member/contact block takes priority over the member-only card; missing flag metadata never leaks it', async () => {
  for (const options of [{ blocked: true }, { contactBlocked: true }]) {
    const f = fixture({ signedIn: true, ...options });
    const body = await (await f.list('sex=male&limit=4')).json();
    assert.ok(!body.items.some(card => card.id === hidden.id));
    assert.ok(!f.publicPhotoReads.some(([, object]) => object.includes(hidden.owner_user_id)));
  }
  const f = fixture({ missingFlag: true });
  const res = await f.list('sex=male&limit=4');
  assert.equal(res.ok, false);
  assert.ok(!(await res.text()).includes(hidden.id));
  assert.deepEqual(f.publicPhotoReads, []);
});

test('guest Quick Match filters before its 120-candidate limit; member photo choice uses private paths', async () => {
  const excluded = Array.from({ length: 121 }, (_, index) => row(10 + index, true));
  const ordinary = row(1);
  const f = fixture({ cards: [...excluded, ordinary] });
  const swipe = f.swipe();
  const preview = await swipe.getGuestSwipePreviewCandidate(f.admin, 'male');
  assert.equal(preview?.card_id, ordinary.id);
  const read = f.queries.find(q => q.table === 'dating_cards');
  assert.deepEqual(read.filters.find(([field]) => field === 'members_only'), ['members_only', false]);
  assert.equal(read.limit, 120);
  assert.deepEqual(read.returnedIds, [ordinary.id]);
  assert.ok(swipe.pickPreviewImage(hidden).startsWith(expectedSignedPath(hidden.blur_paths[0])));
  assert.ok(swipe.pickPreviewImage({ ...hidden, blur_paths: null }).startsWith(expectedSignedPath(hidden.blur_thumb_path)));
  assert.ok(swipe.pickPreviewImage({ ...hidden, photo_visibility: 'public' }).startsWith(expectedSignedPath(hidden.photo_paths[0])));
  assert.ok(swipe.pickPreviewImage(ordinary).startsWith(cdn));
});

test('signed-in Quick Match still selects the marked card, but no block or private-path safeguard is bypassed', async () => {
  const f = fixture({ signedIn: true, cards: [hidden] });
  const subject = await f.swipe().getSwipeCandidate(f.admin, viewer, 'male');
  assert.equal(subject?.card_id, hidden.id);
  assert.ok(subject.image_url.startsWith(expectedSignedPath(hidden.blur_paths[0])));
  const read = f.queries.find(query => query.table === 'dating_cards');
  assert.ok(read.fields.includes('members_only'));
  assert.ok(!read.filters.some(([field]) => field === 'members_only'));
  for (const options of [{ blocked: true }, { contactBlocked: true }]) {
    const f = fixture({ signedIn: true, cards: [hidden], ...options });
    assert.equal(await f.swipe().getSwipeCandidate(f.admin, viewer, 'male'), null);
  }
});

test('public landing preview omits restricted IDs and photos before limiting sample cards', async () => {
  const f = fixture({ cards: [row(6, true), row(5, true), hidden, ...publicRows] });
  const cards = await f.landing();
  assert.deepEqual(cards.map(card => card.id), publicRows.map(row => row.id));
  assert.ok(cards.every(card => !card.imageUrl.includes(hidden.owner_user_id)));
  assert.ok(f.queries.filter(q => q.table === 'dating_cards').every(q =>
    q.limit === 3 && q.filters.some(([field, value]) => field === 'members_only' && value === false)));
});
