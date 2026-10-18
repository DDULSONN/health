/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exportsFixture = {};
vm.runInNewContext(compile(read('lib/paid-application-prefill.ts')), { exports: exportsFixture });
const { paidApplicationPrefill, canOfferInstantOpenCard } = exportsFixture;
const valid = { age: 28, height_cm: 170, region: ' 서울 ', job: ' 회사원 ', training_years: 0, strengths_text: '대화가 잘 통하는 사이', ideal_type: '서로 배려하는 분', instagram_id: '@test.me', photo_preview_urls: ['/own/1', '/own/2'], owner_user_id: 'other', photo_paths: ['other/private.jpg'], consent: true };
test('prefill normalizes only editable fields; zero years is retained; no storage/owner/consent copied', () => {
  const data = paidApplicationPrefill(valid);
  assert.equal(data.age, '28'); assert.equal(data.trainingYears, '0'); assert.equal(data.region, '서울');
  assert.equal(data.instagramId, 'test.me'); assert.equal(data.introText, '대화가 잘 통하는 사이\n\n서로 배려하는 분');
  for (const key of ['owner_user_id', 'photo_paths', 'consent']) assert.ok(!(key in data));
  assert.equal(JSON.parse(JSON.stringify(data)).introText, data.introText);
});
for (const value of [null, undefined, 'x', {}, { age: 18, height_cm: 999, training_years: -1 }, { age: NaN, height_cm: Infinity }, { age: '28', height_cm: 170.5 }]) {
  test('missing or out-of-range fields stay empty: ' + JSON.stringify(value), () => {
    const data = paidApplicationPrefill(value);
    assert.equal(data.age, ''); assert.equal(data.heightCm, ''); assert.equal(data.trainingYears, ''); assert.equal(data.photoUrls.length, 2);
  });
}
test('input lengths are bounded and malformed photo array elements are not coerced', () => {
  const data = paidApplicationPrefill({ ...valid, strengths_text: '한'.repeat(1500), region: '가'.repeat(100), job: '나'.repeat(100), photo_preview_urls: [null, { url: '/bad' }, '/third'] });
  assert.equal(data.introText.length, 1000); assert.equal(data.region.length, 30); assert.equal(data.job.length, 50);
  assert.equal(JSON.stringify(data.photoUrls), '["",""]');
});
const ready = { ready: true, loading: false, error: false, card: null, presentation: null };
for (const [name, pending, state, expected] of [
  ['pending own card', true, ready, true], ['no pending card', false, ready, false],
  ['not checked', true, { ...ready, ready: false }, false], ['loading', true, { ...ready, loading: true }, false],
  ['failed', true, { ...ready, error: true }, false], ['already paid', true, { ...ready, card: { status: 'approved' }, presentation: { active: true } }, false],
  ['payment unfinished', true, { ...ready, card: { status: 'pending' } }, false], ['unknown', true, { ...ready, card: { status: 'unknown' } }, false],
  ['expired', true, { ...ready, card: { status: 'expired' }, presentation: { active: false } }, true],
  ['approved but unconfirmed expiry', true, { ...ready, card: { status: 'approved' }, presentation: { active: false, label: '상태 확인 필요' } }, false],
  ['approved without presentation', true, { ...ready, card: { status: 'approved' } }, false],
  ['approved and confirmed ended', true, { ...ready, card: { status: 'approved' }, presentation: { active: false, label: '공개 종료' } }, true],
]) test('contextual offer: ' + name, () => assert.equal(canOfferInstantOpenCard(pending, state), expected));

const page = read('app/dating/paid/[id]/apply/page.tsx');
const ast = ts.createSourceFile('apply.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name, context) {
  let source;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) source = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(source, name);
  return vm.runInNewContext(compile('const run = ' + source + '; run;'), context);
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function importer(options = {}) {
  const state = { Age: '', HeightCm: '', Region: '', Job: '', TrainingYears: '', InstagramId: '', IntroText: '', Consent: true, Photos: [null, null], ...options.state };
  const calls = [], timers = new Map();
  const context = {
    AbortController, Error, Promise, paidApplicationPrefill, MAX_FILE_SIZE: 12 * 1024 * 1024,
    importRequest: { current: null }, submitLock: { current: false }, photos: state.Photos,
    photoPreparation: { isProcessing: () => false, cancel: slot => calls.push(['clear-photo-error', slot]) },
    supabase: { auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) } },
    fetch: async (url, init) => { calls.push(['read', url, init]); return { status: options.status ?? 200, ok: !options.status, json: async () => ({ card: valid }) }; },
    importOwnOpenCardPhoto: options.importPhoto || (async (url, owner, slot) => { calls.push(['photo', url, owner, slot]); return { name: 'photo-' + slot }; }),
    setTimeout: fn => { timers.set(1, fn); return 1; }, clearTimeout: id => timers.delete(id),
  };
  for (const key of [...Object.keys(state), 'Importing', 'ImportMessage']) context['set' + key] = value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  return { state, calls, timers, context, run: handler('loadOwnOpenCard', context) };
}
test('load is explicit, copies only empty fields, preserves existing photos and resets consent', async () => {
  const f = importer({ state: { Age: '31', IntroText: '내가 직접 적음', Photos: [{ name: 'selected' }, null] } });
  assert.equal(f.calls.length, 0); await f.run();
  assert.equal(f.state.Age, '31'); assert.equal(f.state.IntroText, '내가 직접 적음'); assert.equal(f.state.Region, '서울');
  assert.equal(f.state.Photos[0].name, 'selected'); assert.equal(f.state.Photos[1].name, 'photo-1'); assert.equal(f.state.Consent, false);
  assert.equal(f.calls.filter(call => call[0] === 'photo').length, 1);
  assert.equal(f.calls.find(call => call[0] === 'photo')[2], 'owner');
  assert.equal(f.calls[0][1], '/api/dating/paid/create?source=open_card'); assert.equal(f.calls[0][2].cache, 'no-store');
  assert.equal(f.context.importRequest.current, null); assert.equal(f.state.Importing, false); assert.equal(f.timers.size, 0);
});
test('one failed photo keeps successful photo and text; manual fallback enabled', async () => {
  const f = importer({ importPhoto: async (_url, _owner, slot) => { if (slot) throw Error('broken photo'); return { name: 'first' }; } });
  await f.run(); assert.equal(f.state.Photos[0].name, 'first'); assert.equal(f.state.Photos[1], null);
  assert.match(f.state.ImportMessage, /직접 선택/); assert.equal(f.state.Importing, false);
  assert.deepEqual(f.calls.filter(call => call[0] === 'clear-photo-error'), [['clear-photo-error', 0]]);
});
test('successful reimport clears stale preparation errors only for newly loaded slots', async () => {
  const f = importer({ state: { Photos: [{ name: 'selected' }, null] } });
  await f.run();
  assert.deepEqual(f.calls.filter(call => call[0] === 'clear-photo-error'), [['clear-photo-error', 1]]);
});
for (const status of [404, 401, 500]) test('read failure ' + status + ' leaves typed input and photo intact', async () => {
  const f = importer({ status, state: { Age: '30', Photos: [{ name: 'old' }, null] } });
  await f.run(); assert.equal(f.state.Age, '30'); assert.equal(f.state.Photos[0].name, 'old'); assert.equal(f.calls.length, 1);
  assert.match(f.state.ImportMessage, /직접|다시/); assert.equal(f.state.Importing, false);
});
test('double click shares one in-flight import; canceled late results cannot replace manual input', async () => {
  const wait = deferred(), f = importer({ importPhoto: () => wait.promise });
  const first = f.run(); await flush(); await f.run(); assert.equal(f.calls.filter(call => call[0] === 'read').length, 1);
  f.context.importRequest.current.abort(); f.context.importRequest.current = null;
  f.state.Photos = [{ name: 'manual' }, null]; wait.resolve({ name: 'late' }); await first;
  assert.equal(f.state.Photos[0].name, 'manual'); assert.equal(f.state.Photos[1], null);
});
test('timeout releases controls and ignores late results', async () => {
  const wait = deferred(), f = importer({ importPhoto: () => wait.promise });
  const run = f.run(); await flush(); f.timers.get(1)();
  assert.equal(f.state.Importing, false); assert.equal(f.context.importRequest.current, null); assert.match(f.state.ImportMessage, /지연/);
  wait.resolve({ name: 'late' }); await run; assert.equal(f.state.Photos[0], null);
});
function submitter(overrides = {}) {
  const requests = [], state = {};
  const context = {
    photos: [new File(['png'], '1.png', { type: 'image/png' }), new File(['png'], '2.png', { type: 'image/png' })],
    consent: true, age: '30', heightCm: '178', region: ' 서울 ', job: ' 회사원 ', trainingYears: '0', introText: '한글 소개', instagramId: '@fixture_member', id: 'fixture-paid',
    ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/webp'], DATING_PHOTO_UPLOAD_MAX_BYTES: 3 * 1024 * 1024,
    normalizeInstagramId: value => value.replace(/^@+/, ''), validInstagramId: value => /^[A-Za-z0-9._]{1,30}$/.test(value),
    submitLock: { current: false }, importRequest: { current: null }, photoPreparation: { isProcessing: () => false },
    FormData, Number, JSON, alert: message => { state.alert = message; }, router: { push: value => { state.redirect = value; } },
    setError: value => { state.error = value; }, setProfileEditUrl: value => { state.profileEditUrl = value; }, setSubmitting: value => { state.submitting = value; },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => url.endsWith('/upload') ? { path: 'paid-card-applications/owner/new-' + requests.length + '.png' } : { ok: true } }; },
    ...overrides,
  };
  const submit = handler('handleSubmit', context);
  return { context, requests, state, run: () => submit({ preventDefault() {} }) };
}
test('application payload uses normalized text and newly uploaded photos, not original card paths', async () => {
  const f = submitter(); await f.run();
  assert.equal(f.requests.length, 3);
  const payload = JSON.parse(f.requests[2].options.body);
  assert.equal(payload.instagram_id, 'fixture_member'); assert.equal(payload.training_years, 0); assert.equal(payload.region, '서울'); assert.equal(payload.intro_text, '한글 소개');
  assert.equal(payload.photo_paths.length, 2); assert.ok(payload.photo_paths.every(path => path.startsWith('paid-card-applications/owner/')));
  assert.equal(f.state.redirect, '/mypage?section=matching&match=applied#paid-card-applied'); assert.equal(f.context.submitLock.current, false);
});
test('rapid repeated submit makes only one application request', async () => {
  const wait = deferred(), f = submitter(); const original = f.context.fetch;
  f.context.fetch = async (...args) => { await wait.promise; return original(...args); };
  const first = f.run(); await f.run(); assert.equal(f.context.submitLock.current, true);
  wait.resolve(); await first; assert.equal(f.requests.filter(request => request.url.endsWith('/apply')).length, 1);
});
for (const reason of ['upload-error', 'application-error', 'network-error']) test('submission failure unlocks the form: ' + reason, async () => {
  const f = submitter(); const original = f.context.fetch;
  f.context.fetch = async (url, init) => {
    if (reason === 'network-error') throw Error('offline');
    if (url.endsWith(reason === 'upload-error' ? '/upload' : '/apply')) return { ok: false, json: async () => ({ error: '테스트 오류' }) };
    return original(url, init);
  };
  await f.run(); assert.equal(f.context.submitLock.current, false); assert.equal(f.state.submitting, false); assert.ok(f.state.error); assert.equal(f.state.redirect, undefined);
});
test('in-flight import/preparation and unchecked consent never upload or submit', async () => {
  for (const overrides of [{ importRequest: { current: {} } }, { photoPreparation: { isProcessing: () => true } }, { consent: false }]) {
    const f = submitter(overrides); await f.run(); assert.equal(f.requests.length, 0);
  }
});

for (const body of [null, {}, [], { ok: false }, { ok: 'true' }]) test('ambiguous HTTP 200 cannot claim successful application: '+JSON.stringify(body), async()=>{
  const f=submitter(),original=f.context.fetch;
  f.context.fetch=async(url,init)=>url.endsWith('/apply')?{ok:true,json:async()=>body}:original(url,init);
  await f.run();assert.match(f.state.error,/내 지원/);assert.equal(f.state.alert,undefined);assert.equal(f.state.redirect,undefined);assert.equal(f.context.submitLock.current,false);
});

test('photo picker cancel retains selection; failed replacement clears only its slot and consent',()=>{
  const state={photos:[{name:'old-1'},{name:'old-2'}],consent:true};let callbacks;
  const change=handler('handlePhotoChange',{
    setConsent:value=>{state.consent=value;},setPhotos:update=>{state.photos=update(state.photos);},
    photoPreparation:{select:(slot,file,commit,onError)=>{callbacks={slot,file,commit,onError};}},
  });
  change(0,null);assert.equal(state.consent,true);assert.equal(callbacks,undefined);
  change(0,{name:'bad.heic'});assert.equal(state.consent,false);callbacks.onError();
  assert.equal(state.photos[0],null);assert.equal(state.photos[1].name,'old-2');
  change(0,{name:'good.jpg'});callbacks.commit({name:'converted.webp'});assert.equal(state.photos[0].name,'converted.webp');
});
test('submission uses the application upload endpoint, never the imported card storage paths', () => {
  assert.match(page, /fetch\("\/api\/dating\/paid\/upload"/);
  assert.match(page, /photo_paths: uploadedPaths/);
  assert.doesNotMatch(page, /photo_paths: (?:profile|body|card)\./);
  assert.match(read('app/api/dating/paid/apply/route.ts'), /paid-card-applications\/\$\{user\.id\}\//);
});
test('imported photos satisfy browser validation without fabricating file input values; processing blocks submit', () => {
  assert.match(page, /required=\{!photos\[slot\]\}/); assert.match(page, /submitLock\.current \|\| importRequest\.current \|\| photoPreparation\.isProcessing\(\)/);
  assert.match(page, /URL\.revokeObjectURL/); assert.match(page, /accept=\{DATING_PHOTO_ACCEPT\}/);
  assert.doesNotMatch(read('app/dating/paid/page.tsx'), /지원률이 2배/);
  const home = read('app/community/dating/cards/page.tsx');
  assert.ok(home.indexOf('지원권 차감 없음', home.indexOf('function PaidCardRow')) < home.indexOf('function CardRow'));
  assert.ok(!home.slice(home.indexOf('function CardRow')).includes('지원권 차감 없음'));
});
