const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Buffer, AbortSignal, Intl, Date, console, process,
    require: id => { if (id in mocks) return mocks[id]; throw new Error('Unexpected dependency: ' + id); }, ...globals });
  return exports;
}
const clear = { suspicionLevel: 'clear', flags: [], photoFlags: [], textFlags: [], summary: '정상', raw: {} };
const review = load('lib/dating-review.ts');
const card = { sourceType: 'one_on_one', photoPaths: ['a', 'b'], texts: { intro: '운동을 즐깁니다' }, bucket: 'dating-1on1-photos', displayName: '테스트', age: 30 };
function analyzer(fetcher, downloader = async () => ({ data: new Blob(['image'], {type: 'image/jpeg'}), error: null })) {
  const client = { storage: { from: () => ({ download: downloader }) } };
  const engine = load('lib/admin-dating-card-review.ts', {
    '@/lib/dating-profile-review': { ruleReview: () => ({ ...clear }), cleanText: v => String(v ?? '').trim(), REVIEW_RULES_VERSION: 'test' },
    '@/lib/images': {}, '@/lib/supabase/server': {}, '@/lib/dating-review': review,
  }, { fetch: fetcher });
  return token => engine.analyzeWithGemini(client, 'test-key', 'test-model', card, token);
}
const response = result => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }) });
test('gateway sends every photo, uses only gateway auth, and preserves evidence', async () => {
  const result = await analyzer(async (url, init) => {
    assert.equal(url, 'https://ai-gateway.vercel.sh/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer fixture-oidc');
    assert.equal(init.headers['X-goog-api-key'], undefined);
    assert.ok(init.signal);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'google/gemini-2.5-flash-lite');
    assert.equal(body.messages[0].content.filter(x => x.type === 'image_url').length, 2);
    return {ok: true, json: async () => ({choices: [{message: {content: JSON.stringify({...clear, suspicionLevel: 'high', photoFlags: ['AI 생성 워터마크']})}}]})};
  })('fixture-oidc');
  assert.equal(result.raw.transport, 'ai_gateway');
  assert.equal(result.raw.provider, 'gemini');
  assert.ok(result.photoFlags.includes('AI 생성 워터마크'));
});
for (const variant of ['402', '429', 'timeout', 'malformed']) test(`gateway ${variant} remains incomplete`, async () => {
  const result = await analyzer(async () => {
    if (variant === 'timeout') throw new Error('timeout');
    if (variant === 'malformed') return {ok: true, json: async () => ({choices: []})};
    return {ok: false, status: Number(variant), json: async () => ({error: 'unavailable'})};
  })('fixture-oidc');
  assert.equal(result.raw.provider, 'rules_fallback');
});
test('gateway cannot clear a profile with unreadable photos', async () => {
  const result = await analyzer(async () => ({ok: true, json: async () => ({choices: [{message: {content: JSON.stringify(clear)}}]})}), async () => ({error: 'missing'}))('fixture-oidc');
  assert.equal(result.suspicionLevel, 'medium');
  assert.ok(result.raw.incomplete.length);
});
for (const variant of ['http-error', 'timeout', 'malformed']) test(`AI ${variant} stays incomplete and never mutates a profile`, async () => {
  const run = analyzer(async () => {
    if (variant === 'timeout') throw new Error('timeout');
    if (variant === 'http-error') return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, json: async () => ({ candidates: [] }) };
  });
  assert.equal((await run()).raw.provider, 'rules_fallback');
});
test('partial photo failure cannot silently become a successful clear review', async () => {
  const result = await analyzer(async () => response(clear), async p => p === 'b' ? {error: 'missing'} : {data: new Blob(['image'])})();
  assert.equal(result.suspicionLevel, 'medium'); assert.ok(result.raw.incomplete.length);
});
test('every registered photo is sent and download/model calls have abort deadlines', async () => {
  const original = card.photoPaths; card.photoPaths = ['a', 'b', 'c'];
  try {
    let downloads = 0;
    await analyzer(async (_, init) => {
      assert.ok(init.signal); assert.equal(JSON.parse(init.body).contents[0].parts.length, 4);
      return response(clear);
    }, async (_, __, init) => { downloads++; assert.ok(init.signal); return {data: new Blob(['image'])}; })();
    assert.equal(downloads, 3);
  } finally { card.photoPaths = original; }
});
test('inconsistent AI clear with evidence is shown in the attention inbox', async () => {
  const result = await analyzer(async () => response({...clear, photoFlags: ['사진에 SNS ID 표시']}))();
  assert.equal(result.suspicionLevel, 'low'); assert.ok(result.photoFlags.length);
});
test('cron requires exact secret; cron-looking headers do not grant access', async () => {
  let calls = 0;
  const previous = process.env.CRON_SECRET; process.env.CRON_SECRET = 'fixture-secret';
  const route = load('app/api/cron/dating-profile-review/route.ts', {
    'next/server': { NextResponse: {json: (v, init) => Response.json(v, init)} },
    '@/lib/dating-auto-review-worker': {runAutomaticProfileReviews: async () => {calls++; return {claimed: 0};}},
  });
  try {
    assert.equal((await route.GET(new Request('https://example.test', {headers: {'x-vercel-cron': '1'}}))).status, 401);
    assert.equal(calls, 0);
    assert.equal((await route.GET(new Request('https://example.test', {headers: {authorization: 'Bearer fixture-secret'}}))).status, 200);
    assert.equal(calls, 1);
  } finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; }
});
