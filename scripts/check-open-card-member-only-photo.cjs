/* eslint-disable @typescript-eslint/no-require-imports */
// Execute the actual GET/HEAD route with a synthetic database/auth/storage.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const owner = '00000000-0000-4000-8000-000000000001';
const member = '00000000-0000-4000-8000-000000000002';
const [raw, blur, lite, thumb] = ['raw/photo.jpg', 'blur/photo.webp', 'lite/photo.webp', 'thumb/photo.webp']
  .map(tail => `cards/${owner}/${tail}`);
const flagRow = { id: 'test-card', owner_user_id: owner, members_only: true, photo_visibility: 'public',
  instagram_id: 'test-profile', status: 'public', expires_at: '2099-01-01', photo_paths: [raw], blur_paths: [blur], blur_thumb_path: thumb };

function fixture({ userId = null, userDeleted = false, flag = true, blocked = false, contactBlocked = false,
  failed = false, restrictedPhoto = flagRow, onUpstream } = {}) {
  const calls = [], row = { ...restrictedPhoto, members_only: flag };
  const admin = {
    from(table) {
      const filters = new Map();
      const query = {
        select: () => query,
        eq: (key, value) => { filters.set(key, value); return query; },
        limit: async () => {
          if (table !== 'dating_cards') return { data: [], error: null };
          if (filters.get('members_only') && failed) return { data: null, error: { code: 'PGRST204' } };
          const matches = [...filters].every(([key, value]) => row[key] === value);
          return { data: matches ? [row] : [], error: null };
        },
      };
      return query;
    },
    storage: { from: bucket => ({
      getPublicUrl: object => {
        calls.push(['public', bucket, object]);
        return { data: { publicUrl: `https://fixture.invalid/public/${bucket}/${object}` } };
      },
    }) },
  };
  const modules = {
    '@/lib/dating-blocks': { hasDatingBlockBetween: async () => blocked },
    '@/lib/dating-contact-blocks': { hasDatingContactBlockBetween: async (_admin, _viewer, _owner, options) => {
      assert.deepEqual(options, { userBInstagramIds: ['test-profile'] });
      return contactBlocked;
    } },
    '@/lib/dating-city-view': { hasCityViewCardAccess: async () => false },
    '@/lib/dating-more-view': { hasMoreViewAccess: async () => false, normalizeCardSex: value => value },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({
      user: userId ? { id: userId, deleted_at: userDeleted ? '2026-01-01' : null } : null,
    }) },
    '@/lib/supabase/server': { createAdminClient: () => admin },
    '@/lib/admin': { isAllowedAdminUser: () => false },
    '@/lib/signed-url-cache': { getCachedSignedUrlWithBucket: async ({ bucket, path: object }) => {
      calls.push(['private', bucket, object]); return { url: `https://fixture.invalid/private/${bucket}/${object}` };
    } },
    sharp: () => assert.fail('Unexpected image optimizer call'),
  };
  function upstream(url, { method }) {
    assert.match(url, /^https:\/\/fixture\.invalid\//);
    onUpstream?.(url);
    return Promise.resolve(new Response(method === 'HEAD' ? null : 'image', { headers: { 'Content-Type': 'image/webp' } }));
  }
  function load(file) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    const { outputText } = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
    const out = {};
    new Function('exports', 'require', 'fetch', outputText)(out, name => {
      if (Object.hasOwn(modules, name)) return modules[name];
      if (name === '@/lib/images' || name === '@/lib/dating-card-photo-visibility') return load(name.slice(2) + '.ts');
      assert.fail('Unexpected import: ' + name);
    }, upstream);
    return out;
  }
  const route = load('app/i/[...slug]/route.ts');
  return {
    calls,
    photo(object, { mode = 'signed', bucket = 'dating-card-photos', method = 'GET', query = '' } = {}) {
      return route[method](new Request('https://fixture.invalid/i/' + query, { method }), {
        params: Promise.resolve({ slug: [mode, bucket, ...object.split('/')] }),
      });
    },
  };
}

test('guest cannot retrieve restricted raw, blur, lite and thumb aliases by GET or HEAD', async () => {
  const f = fixture();
  for (const object of [raw, blur, lite, thumb]) for (const method of ['GET', 'HEAD']) {
    for (const mode of ['signed', 'public-lite']) {
      const bucket = mode === 'public-lite' ? 'dating-card-lite' : 'dating-card-photos';
      const res = await f.photo(object, { mode, bucket, method, query: '?preview=1&full=1&w=640' });
      assert.equal(res.status, 404);
      assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
      assert.match(res.headers.get('Vary'), /Cookie/);
    }
  }
  assert.equal((await f.photo(blur, { bucket: 'dating-card-lite' })).status, 404);
  assert.deepEqual(f.calls, [], 'no public or signed upstream URL produced for a guest');
});

test('signed-in viewer gets lite bytes through private storage; owner/modifier operations are unnecessary', async () => {
  const f = fixture({ userId: member });
  for (const method of ['GET', 'HEAD']) {
    const res = await f.photo(blur, { mode: 'public-lite', bucket: 'dating-card-lite', method });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(await res.text(), method === 'HEAD' ? '' : 'image');
  }
  assert.deepEqual(f.calls, [['private', 'dating-card-photos', blur], ['private', 'dating-card-photos', blur]]);
});

test('restricted photos respect existing member/contact blocks, deleted sessions, and unavailable access data', async () => {
  for (const opts of [{ userId: member, blocked: true }, { userId: member, contactBlocked: true },
    { userId: member, userDeleted: true }, { userId: member, failed: true }]) {
    const f = fixture(opts);
    assert.equal((await f.photo(blur, { mode: 'public-lite', bucket: 'dating-card-lite' })).status, 404);
    assert.equal((await f.photo(raw)).status, 404);
    assert.deepEqual(f.calls, []);
  }
});

test('ordinary card and unrelated same-owner lite keys keep working without reusable cache entries', async () => {
  const ordinary = fixture({ flag: false });
  const response = await ordinary.photo(blur, { mode: 'public-lite', bucket: 'dating-card-lite' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(ordinary.calls, [['public', 'dating-card-lite', blur]]);
  const unrelated = fixture();
  const other = blur.replace('photo.webp', 'another-photo.webp');
  assert.equal((await unrelated.photo(other, { mode: 'public-lite', bucket: 'dating-card-lite' })).status, 200);
  assert.deepEqual(unrelated.calls, [['public', 'dating-card-lite', other]]);
});

test('ambiguous paths and photos whose stored values are legacy URLs cannot bypass the restricted check', async () => {
  const restrictedPhoto = { ...flagRow, photo_paths: [], blur_paths: [`https://fixture.invalid/storage/v1/object/public/dating-card-lite/${blur}?v=old`], blur_thumb_path: null };
  const f = fixture({ restrictedPhoto });
  for (const object of [blur, blur.replace('/blur/', '/raw/../blur/'), blur.replace('/blur/', '/%252e%252e/blur/')]) {
    assert.equal((await f.photo(object, { mode: 'public-lite', bucket: 'dating-card-lite' })).status, 404);
  }
  assert.deepEqual(f.calls, []);
});
