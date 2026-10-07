/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { test } = require('node:test'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', js)(name => name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name), loaded, loaded.exports);
  return loaded.exports;
}
const entry = load('lib/dating-onboarding-entry.ts');
const photos = load('lib/dating-open-card-photo-import.ts');
test('explicit target survives auth redirects; instant paid flow takes precedence', () => {
  for (const [search, expected] of [['', 'combined'], ['?target=one_on_one', 'one_on_one'], ['?target=unknown', 'combined'],
    ['?target=open', 'combined'], ['?next=instant_open_card&target=one_on_one', 'instant_open_card']]) {
    assert.equal(entry.onboardingEntry(search), expected);
    assert.equal(entry.onboardingEntry('?' + entry.onboardingEntryHref(expected).split('?')[1]), expected);
  }
});
for (const open of [false, true]) for (const oneOnOne of [false, true]) {
  const available = { open, oneOnOne };
  for (const saved of [undefined, { open: true, oneOnOne: true }, { open: true, oneOnOne: false }, { open: false, oneOnOne: true }]) {
    test('one-on-one/instant isolation including restored drafts ' + JSON.stringify({ available, saved }), () => {
      assert.deepEqual(entry.onboardingTargets('one_on_one', available, saved), { open: false, oneOnOne });
      assert.deepEqual(entry.onboardingTargets('instant_open_card', available, saved), { open, oneOnOne: false });
      const both = entry.onboardingTargets('combined', available, saved);
      assert.ok(!both.open || open); assert.ok(!both.oneOnOne || oneOnOne);
      if (!saved) assert.deepEqual(both, available);
    });
  }
}
const own = { id: 'card', owner_user_id: 'member', status: 'public', sex: 'female', height_cm: 165,
  job: '회사원', region: '서울', strengths_text: '경청해요', ideal_type: '대화가 잘 통하는 분', age: 27,
  display_nickname: '닉네임', phone: 'PRIVATE', instagram_id: 'PRIVATE', name: 'PRIVATE', birth_year: 1999, photo_visibility: 'public' };
test('only owned supported cards; prefer active, then newest API order', () => {
  assert.equal(entry.pickOwnOpenCard([{ ...own, owner_user_id: 'other' }], 'member'), null);
  for (const input of [null, {}, [null], [{ ...own, status: 'deleted' }], [{ ...own, id: '' }]]) assert.equal(entry.pickOwnOpenCard(input, 'member'), null);
  assert.equal(entry.pickOwnOpenCard([own], ''), null);
  assert.equal(entry.pickOwnOpenCard([{ ...own, id: 'old', status: 'expired' }, own], 'member').id, 'card');
  assert.equal(entry.pickOwnOpenCard([{ ...own, id: 'latest', status: 'hidden' }, { ...own, status: 'expired' }], 'member').id, 'latest');
});
test('strict prefill allowlist excludes inferred ages, names, contacts, consent and publication state', () => {
  assert.deepEqual(entry.openCardPrefill(own), { sex: 'female', heightCm: '165', job: '회사원', region: '서울', strengthsText: '경청해요', preferredPartnerText: '대화가 잘 통하는 분' });
  const invalid = { ...own, sex: 'x', height_cm: 999, job: {}, region: 'a'.repeat(81), strengths_text: '', ideal_type: 99 };
  assert.deepEqual(entry.openCardPrefill(invalid), {});
});
const base = '/i/signed/dating-card-photos/cards/member/raw/picture.jpg';
test('photo URL stays same-origin and owner-scoped; query transforms removed', () => {
  assert.equal(photos.ownOpenCardPhotoUrl(base + '?w=320&q=10', 'member', 'https://example.test'), base);
  assert.equal(photos.ownOpenCardPhotoUrl('https://example.test' + base, 'member', 'https://example.test'), base);
  for (const input of [null, '', 'https://evil.test' + base, '//evil.test' + base, 'data:image/jpeg,x',
    base.replace('/member/', '/other/'), base.replace('/raw/', '/blur/'), base.replace('dating-card-photos', 'dating-1on1-photos'),
    base + '#fragment', base.replace('picture.jpg', '%2e%2e/private'), base.replace('picture.jpg', '%252e%252e'),
    base.replace('picture.jpg', 'a%2fb.jpg'), base.replace('picture.jpg', 'a%5cb.jpg'), '/api/dating/cards/my']) {
    assert.equal(photos.ownOpenCardPhotoUrl(input, 'member', 'https://example.test'), null, String(input));
  }
});
test('photo download validates MIME/bytes and decodes before exposing a file', async () => {
  const original = { fetch: global.fetch, window: global.window, Image: global.Image };
  global.window = { location: { origin: 'https://example.test' } };
  global.Image = class { naturalWidth = 600; naturalHeight = 800; set src(value) { if (value) queueMicrotask(() => this.onload?.()); } };
  try {
    let options;
    global.fetch = async (_, opts) => { options = opts; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } }); };
    const file = await photos.importOwnOpenCardPhoto(base, 'member', 0, 10, new AbortController().signal);
    assert.equal(file.type, 'image/webp'); assert.equal(file.name, 'open-card-1.webp'); assert.equal(file.size, 3);
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    for (const response of [new Response('<html/>', { headers: { 'content-type': 'text/html' } }), new Response(null, { status: 403 }),
      new Response(new Uint8Array(11), { headers: { 'content-type': 'image/png' } }),
      new Response(new Uint8Array(1), { headers: { 'content-type': 'image/png', 'content-length': '11' } }),
      new Response(new Uint8Array(0), { headers: { 'content-type': 'image/png' } })]) {
      global.fetch = async () => response;
      await assert.rejects(photos.importOwnOpenCardPhoto(base, 'member', 0, 10, new AbortController().signal));
    }
    global.fetch = async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
    global.Image = class { set src(value) { if (value) queueMicrotask(() => this.onerror?.()); } };
    await assert.rejects(photos.importOwnOpenCardPhoto(base, 'member', 0, 10, new AbortController().signal), /읽지/);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(photos.importOwnOpenCardPhoto(base, 'member', 0, 10, abort.signal), { name: 'AbortError' });
  } finally { global.fetch = original.fetch; global.window = original.window; global.Image = original.Image; }
});
test('import is explicit, bounded and does not write to server or auto-consent', () => {
  const source = read('app/onboarding/dating/page.tsx');
  const importer = source.slice(source.indexOf('  const importOpenCard ='), source.indexOf('  const validateStep ='));
  assert.ok(importer.includes('20000') && importer.includes('authVersion.current === version'));
  assert.ok(!/method:|setConsent|setBirthYear|setName\(|setIntroText/.test(importer));
  assert.ok(importer.includes('file ?? imported[slot]'));
  assert.ok(source.includes('if (importController.current) return;'));
  assert.ok(!/fetch\(|\.insert\(|\.update\(/.test(read('lib/dating-onboarding-entry.ts')));
  assert.ok(!/localStorage|indexedDB|method:/.test(read('lib/dating-open-card-photo-import.ts')));
});
