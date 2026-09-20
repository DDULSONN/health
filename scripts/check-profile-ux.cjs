/* eslint-disable @typescript-eslint/no-require-imports */
// Offline fixtures only. Never calls real matching, payment or member APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
function evaluate(source, bindings = {}) {
  const mod = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const localRequire = p => p.startsWith('@/') ? evaluate(read(p.slice(2) + '.ts')) : require(p);
  new Function('require', 'module', 'exports', ...Object.keys(bindings), output)(localRequire, mod, mod.exports, ...Object.values(bindings));
  return mod.exports;
}
const { createLatestRequest } = evaluate(read('lib/latest-request.ts'));
const draft = evaluate(read('lib/dating-onboarding-draft.ts'));
const validation = evaluate(read('lib/dating-onboarding-validation.ts'));
const agePolicy = evaluate(read('lib/dating-age.ts'));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('GET coalescing shares exactly one request; nothing is cached after it settles', async () => {
  const gate = createLatestRequest(), d = deferred(); let loads = 0; const values = [];
  const options = { load: () => { loads++; return d.promise; }, commit: v => values.push(v) };
  const first = gate.run(options), second = gate.run(options);
  assert.equal(first, second); await tick(); assert.equal(loads, 1);
  d.resolve('one'); await first; await gate.run({ ...options, load: async () => 'two' });
  assert.deepEqual(values, ['one', 'two']);
});
for (const outcome of ['resolve', 'reject']) test(`superseded ${outcome} never replaces data/error/loading even if abort is ignored`, async () => {
  const gate = createLatestRequest(), old = deferred(), newer = deferred(); const events = []; let signal;
  const first = gate.run({ load: s => { signal = s; return old.promise; }, commit: v => events.push(v), finish: () => events.push('old-finish'), fail: () => events.push('old-error') });
  await tick();
  const next = gate.run({ replace: true, load: () => newer.promise, commit: v => events.push(v), finish: () => events.push('new-finish') });
  assert.equal(signal.aborted, true); newer.resolve('new'); await next;
  old[outcome](outcome === 'resolve' ? 'old' : new Error('old')); await first;
  assert.deepEqual(events, ['new', 'new-finish']);
});
test('unmount/account cancellation invalidates pending reads', async () => {
  const gate = createLatestRequest(), d = deferred(); let committed = false;
  const p = gate.run({ load: () => d.promise, commit: () => { committed = true; } });
  await tick(); gate.cancel(); d.resolve('private'); await p; assert.equal(committed, false);
});
test('current errors still propagate and a later read can recover', async () => {
  const gate = createLatestRequest();
  await assert.rejects(gate.run({ load: async () => { throw Error('offline'); }, commit() {} }), /offline/);
  let value; await gate.run({ load: async () => 7, commit: v => { value = v; } }); assert.equal(value, 7);
});

function memoryStorage() {
  const map = new Map();
  return { get length() { return map.size; }, key: i => [...map.keys()][i], getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k), map };
}
const fields = { nickname: '테스트', sex: 'female', name: '테스트회원', birthYear: '1996', heightCm: '170', job: '회사원', region: '서울', introText: '안녕하세요 반가워요!', strengthsText: '배려해요', preferredPartnerText: '대화가 편한 사람', smoking: 'non_smoker', workoutFrequency: '', trainingYears: '', instagramId: 'test.user', total3Lift: '', photoVisibility: 'blur' };
const makeDraft = extra => ({ version: 1, userId: 'member-a', savedAt: Date.now(), step: 4, targets: { open: true, oneOnOne: true }, fields: { ...fields }, ...extra });
test('Korean draft round-trips; consent, paths, files and completed state cannot enter storage', () => {
  const storage = memoryStorage();
  assert.equal(draft.writeDatingDraft(makeDraft({ completed: { open: true }, consents: true, photos: ['blob:fake'], fields: { ...fields, phone: 'secret', photo_paths: ['private'] } }), storage), true);
  const saved = draft.readDatingDraft('member-a', storage);
  assert.deepEqual(saved.fields, fields); assert.equal(saved.step, 3);
  assert.ok(!/private|secret|completed|consents|blob:/.test([...storage.map.values()][0]));
});
test('TTL, invalid timestamps, oversized and malformed storage are discarded', () => {
  for (const raw of [makeDraft({ savedAt: Date.now() - draft.DRAFT_TTL_MS }), makeDraft({ savedAt: Date.now() + 120000 }), makeDraft({ savedAt: 'yesterday' }), makeDraft({ version: 99 }), '{bad json', 'x'.repeat(40001)]) {
    const storage = memoryStorage(); storage.setItem('gymtools:dating-onboarding-draft:v1:member-a', typeof raw === 'string' ? raw : JSON.stringify(raw));
    assert.equal(draft.readDatingDraft('member-a', storage), null); assert.equal(storage.length, 0);
  }
});
test('account switch purges previous account and does not import its draft', () => {
  const storage = memoryStorage(); draft.writeDatingDraft(makeDraft(), storage);
  assert.equal(draft.readDatingDraft('member-b', storage), null); assert.equal(storage.length, 0);
});
test('logout clears only onboarding drafts, leaving unrelated storage intact', () => {
  const storage = memoryStorage(); storage.setItem('other-app', 'keep'); draft.writeDatingDraft(makeDraft(), storage);
  draft.clearDatingDraft(undefined, storage); assert.equal(storage.length, 1); assert.equal(storage.getItem('other-app'), 'keep');
});
test('blocked/full storage never throws or prevents registration', () => {
  const storage = { get length() { throw Error('blocked'); }, getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); }, removeItem() { throw Error('blocked'); } };
  assert.equal(draft.writeDatingDraft(makeDraft(), storage), false);
  assert.equal(draft.readDatingDraft('member-a', storage), null); assert.doesNotThrow(() => draft.clearDatingDraft(undefined, storage));
});
test('draft enum/length boundaries are clamped and missing optional fields get safe defaults', () => {
  const d = draft.sanitizeDraft(makeDraft({ step: -3, fields: { name: '가'.repeat(90), sex: 'other', smoking: 'bad', photoVisibility: 'bad' } }), 'member-a');
  assert.equal(d.step, 0); assert.equal(d.fields.name.length, 30); assert.equal(d.fields.sex, null); assert.equal(d.fields.smoking, 'non_smoker'); assert.equal(d.fields.photoVisibility, 'blur');
});

const consents = Object.fromEntries(['consentOpenCard','consentFakeInfo','consentNoShow','consentFee','consentNoDirectContact','consentPrivacy'].map(k => [k,true]));
const validInput = extra => ({ fields: { ...fields }, targets: { open: true, oneOnOne: true }, selectedCount: 2, nicknameSaved: true, maxBirthYear: agePolicy.getMaxDatingBirthYear(), photos: ['', ''], consents: { ...consents }, ...extra });
for (let step = 0; step < 5; step++) test(`valid step ${step} passes existing rules`, () => assert.deepEqual(validation.validateOnboardingStep(step, validInput()), {}));
test('all invalid basic fields are identified separately in screen order', () => {
  const f = { ...fields, nickname: '', name: '', sex: null, birthYear: '2020', heightCm: '119', job: '', region: '' };
  assert.deepEqual(Object.keys(validation.validateOnboardingStep(0, validInput({ fields: f, nicknameSaved: false }))), ['nickname','sex','name','birthYear','heightCm','job','region']);
});
test('open-only users do not need 1:1 name/introduction/consents', () => {
  const input = validInput({ fields: { ...fields, name: '', introText: '' }, targets: { open: true, oneOnOne: false }, consents: { consentOpenCard: true } });
  for (const step of [0,1,4]) assert.deepEqual(validation.validateOnboardingStep(step, input), {});
});
test('1:1-only users do not need Instagram; open limits remain stricter', () => {
  const input = validInput({ fields: { ...fields, instagramId: '', job: '가'.repeat(70), strengthsText: '가'.repeat(500) }, targets: { open: false, oneOnOne: true } });
  for (const step of [0,1,2]) assert.deepEqual(validation.validateOnboardingStep(step, input), {});
  input.targets.open = true;
  assert.ok(validation.validateOnboardingStep(0, input).job); assert.ok(validation.validateOnboardingStep(1, input).strengthsText); assert.ok(validation.validateOnboardingStep(2, input).instagramId);
});
test('two photos and every mandatory consent get their own errors', () => {
  assert.deepEqual(Object.keys(validation.validateOnboardingStep(3, validInput({ photos: ['사진 1 선택', '사진 2 선택'] }))), ['photo0','photo1']);
  assert.deepEqual(Object.keys(validation.validateOnboardingStep(4, validInput({ consents: {} }))), Object.keys(consents));
});

function find(node, predicate) {
  if (predicate(node)) return node;
  let result; ts.forEachChild(node, child => { if (!result) result = find(child, predicate); }); return result;
}
function initializer(file, name) {
  const source = read(file), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return find(ast, n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name).initializer.getText(ast);
}
for (const surface of ['home', 'mypage']) for (const outcome of ['resolve', 'reject']) test(`${surface} actual reload ignores stale ${outcome}`, async () => {
  const queues = [deferred(), deferred()]; let fetchBatch = 0; let calls = 0, value, error = '', loading = false;
  const file = surface === 'home' ? 'app/community/dating/cards/page.tsx' : 'app/mypage/page.tsx';
  const name = surface === 'home' ? 'reloadOneOnOneHome' : 'reloadOneOnOneRecommendations';
  const gate = createLatestRequest();
  const bindings = {
    useCallback: fn => fn, viewerLoggedIn: true, oneOnOneHomeRequest: gate, oneOnOneRecommendationsRequest: gate,
    setOneOnOneHome: v => { value = v; }, setMyOneOnOneAutoRecommendations: v => { value = v; },
    setOneOnOneHomeError: v => { error = v; }, setOneOnOneHomeLoading: v => { loading = v; },
    fetch: async () => { calls++; const batch = fetchBatch; await queues[batch].promise; return { ok: true, json: async () => ({ items: [batch], canWrite: true }) }; },
  };
  const reload = evaluate('exports.reload = ' + initializer(file, name), bindings).reload;
  const old = reload(false); await tick(); fetchBatch = 1;
  const newer = reload(); await tick(); queues[1].resolve(); await newer;
  queues[0][outcome](outcome === 'resolve' ? undefined : Error('obsolete')); await old;
  assert.deepEqual(surface === 'home' ? value.recommendations : value, [1]); assert.equal(error, ''); assert.equal(loading, false);
  assert.equal(calls, surface === 'home' ? 8 : 2);
});
test('registration endpoint payloads and image upload code remain byte-for-byte identical to base', () => {
  const file = 'app/onboarding/dating/page.tsx';
  const before = execFileSync('git', ['show', 'b50e5d2:' + file], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g,'\n');
  const after = read(file).replace(/\r\n/g,'\n');
  for (const endpoint of ['/api/dating/cards/my', '/api/dating/1on1/cards']) {
    const payload = text => text.slice(text.indexOf('const response = await fetchWithTimeout("' + endpoint), text.indexOf('if (!response.ok)', text.indexOf('const response = await fetchWithTimeout("' + endpoint)));
    assert.equal(payload(after), payload(before));
  }
  const uploads = text => text.slice(text.indexOf('  const uploadOpenCardPhotos'), text.indexOf('  const submit ='));
  assert.equal(uploads(after), uploads(before));
});

test('field feedback preserves the original accept/reject rules across boundary cases', () => {
  const source = execFileSync('git', ['show', 'b50e5d2:app/onboarding/dating/page.tsx'], { cwd:root, encoding:'utf8' });
  const ast = ts.createSourceFile('before.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = find(ast, n => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'validateStep');
  const names = [...Object.keys(fields), ...Object.keys(consents), 'targets','selectedTargets','nicknameSaved','MAX_ADULT_BIRTH_YEAR','photos'];
  const oldValidate = evaluate('exports.make = values => { const {' + names.join(',') + '} = values; return ' + node.initializer.getText(ast) + '; };', {
    validateNickname: evaluate(read('lib/nickname.ts')).validateNickname,
    validInstagramId: v => /^[A-Za-z0-9._]{1,30}$/.test(v.trim().replace(/^@+/,'').replace(/\\s+/g,'').slice(0,30)),
    photoError: file => file.error || '',
  }).make;
  const changes = {
    sex:[null], nickname:['','a','normal_name','관리자'], name:['','가'.repeat(31)],
    birthYear:['','1959','1960','2008','2009','1996.5'], heightCm:['119','120','230','231'],
    job:['','가'.repeat(51),'가'.repeat(81)], region:['','가'.repeat(31),'가'.repeat(81)],
    introText:['','가'.repeat(2001)], strengthsText:['','가'.repeat(151),'가'.repeat(1001)],
    preferredPartnerText:['','가'.repeat(1001)], trainingYears:['-1','0','50','51','abc'],
    instagramId:['','@normal.user','bad!'],
  };
  const cases = [{ ...fields }];
  for (const [field, values] of Object.entries(changes)) for (const value of values) cases.push({ ...fields, [field]:value });
  let checked = 0;
  for (const targets of [{open:true,oneOnOne:true},{open:true,oneOnOne:false},{open:false,oneOnOne:true}]) {
    for (const f of cases) for (const nicknameSaved of [true,false]) {
      const input = validInput({ fields:f, targets, nicknameSaved });
      const old = oldValidate({ ...f, ...consents, targets, selectedTargets:['fixture'], nicknameSaved, MAX_ADULT_BIRTH_YEAR:input.maxBirthYear, photos:[{},{}] });
      for (let step=0; step<5; step++) {
        assert.equal(Object.keys(validation.validateOnboardingStep(step,input)).length > 0, Boolean(old(step)), JSON.stringify({step,targets,f}));
        checked++;
      }
    }
  }
  assert.ok(checked > 1000);
});
