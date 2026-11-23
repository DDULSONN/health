/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, deps = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  new Function('exports', 'require', outputText)(exports, id => {
    if (!(id in deps)) throw new Error(`Unexpected dependency: ${id}`);
    return deps[id];
  });
  return exports;
}

test('pending card photos are scoped to actual owner and photo visibility, never fallback from blur to raw', () => {
  const { getLovePassPhotoPaths } = load('lib/dating-love-pass-photos.ts', { '@/lib/images': load('lib/images.ts') });
  const raw = ['cards/owner/raw/one.jpg', 'cards/other/raw/two.jpg', 'cards/owner/raw/three.webp'];
  const blur = ['cards/owner/blur/one.webp', 'cards/owner/raw/one.jpg', 'cards/owner/blur/..', 'cards/owner/blur/one.webp', 'cards/other/blur/no.png'];
  const row = { owner_user_id: 'owner', photo_paths: raw, blur_paths: blur, blur_thumb_path: 'cards/owner/blur/two.webp' };
  assert.deepEqual(getLovePassPhotoPaths({ ...row, photo_visibility: 'blur' }), ['cards/owner/blur/one.webp', 'cards/owner/blur/two.webp']);
  assert.deepEqual(getLovePassPhotoPaths({ ...row, photo_visibility: 'public' }).slice(0, 2), [raw[0], raw[2]]);
  assert.deepEqual(getLovePassPhotoPaths({ owner_user_id: 'owner', photo_paths: raw }), []);
});

test('nearby membership boundaries require current verified viewer, target status and matching region', async () => {
  const now = Date.now();
  const pass = { id: 'pass', startsAt: new Date(now - 5000).toISOString(), expiresAt: new Date(now + 3600000).toISOString(), areas: ['서울'], publicationsRemaining: 4, nextPublicationAt: null, creditsRemaining: 40 };
  const card = { id: 'card', owner_user_id: 'target', status: 'pending', expires_at: null, age: 22, sex: 'female', region: '서울 마포구', instagram_id: 'for-internal-block-check-only' };
  let passData = pass, cardData = card, blocked = false, contactBlocked = false, reviewed = true, targetBanned = false;
  const deps = {
    '@/lib/region-city': load('lib/region-city.ts'),
    '@/lib/dating-city-view': { normalizeDatingCityViewSex: val => val, getOppositeDatingSex: () => 'female' },
    '@/lib/dating-blocks': { hasDatingBlockBetween: async () => blocked },
    '@/lib/dating-contact-blocks': { hasDatingContactBlockBetween: async () => contactBlocked },
    '@/lib/dating-city-view-candidates': {},
  };
  const { hasLovePassNearbyCardAccess, isLovePassAreaList, readLovePassStatus } = load('lib/dating-love-pass-access.ts', deps);
  const admin = {
    async rpc(name) { return { data: name === 'dating_love_pass_status' ? passData : reviewed, error: null }; },
    from(table) {
      let lastEq = [];
      const query = { select: () => query, in: () => query, order: () => query, limit: () => query,
        eq: (...args) => { lastEq = args; return query; }, async maybeSingle() {
          if (table === 'profiles') return { data: lastEq[1] === 'target' ? { is_banned: targetBanned } : { phone_verified: true, is_banned: false } };
          return { data: lastEq[0] === 'owner_user_id' ? { id: 'own', status: 'pending', age: 25, sex: 'male', expires_at: null } : cardData };
        } };
      return query;
    },
  };
  const check = () => hasLovePassNearbyCardAccess(admin, 'viewer', 'card');
  assert.equal(await check(), true);
  blocked = true; assert.equal(await check(), false); blocked = false;
  contactBlocked = true; assert.equal(await check(), false); contactBlocked = false;
  targetBanned = true; assert.equal(await check(), false); targetBanned = false;
  reviewed = false; assert.equal(await check(), false); reviewed = true;
  for (const patch of [{ status: 'hidden' }, { age: 18 }, { region: '경기 수원' }, { expires_at: new Date(now - 1).toISOString() }, { owner_user_id: 'viewer' }, { sex: 'male' }]) {
    cardData = { ...card, ...patch }; assert.equal(await check(), false);
  }
  cardData = card;
  passData = { ...pass, expiresAt: new Date(now - 1).toISOString() }; assert.equal(await check(), false);
  passData = null; assert.equal(await check(), false);
  assert.equal(isLovePassAreaList(['서울', '경기도']), false);
  assert.equal(isLovePassAreaList(['서울', '서울']), false);
  assert.equal(readLovePassStatus({ ...pass, creditsRemaining: 41 }, now), null);
});
