/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', ...Object.keys(globals), source)((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', mocks, globals);
    return require(name);
  }, exports, ...Object.values(globals));
  return exports;
}
const rules = load('lib/onboarding-funnel.ts');
test('aggregate ownership columns match the existing registration schema, not test-only assumptions', () => {
  const ddl = fs.readFileSync(path.join(root, 'supabase/sql/dating_cards_mode.sql'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'app/api/dating/cards/my/route.ts'), 'utf8');
  const sql = fs.readFileSync(path.join(root, 'supabase/sql/onboarding_funnel.sql'), 'utf8');
  assert.match(ddl, /owner_user_id uuid not null/);
  assert.match(api, /\.eq\("owner_user_id", user\.id\)/);
  assert.match(sql, /public\.dating_cards c where c\.owner_user_id = p\.user_id/);
});
for (const event of rules.ONBOARDING_EVENTS) test('accept only fixed diagnostic: ' + event, () => {
  assert.equal(rules.parseOnboardingEvent({ event }), event);
});
for (const bad of [null, {}, [], { event: 'custom' }, { event: 'submit_started', email: 'private@example.invalid' },
  { event: 'profile_basic', user_id: 'another' }, { event: { value: 'profile_basic' } }]) test('discard unsafe analytics payload ' + JSON.stringify(bad), () => {
  assert.equal(rules.parseOnboardingEvent(bad), null);
});
test('client telemetry is nonblocking, fixed payload, account scoped and deduplicated', async () => {
  const calls = [];
  const tracker = load('lib/onboarding-analytics.ts', {}, {
    window: {}, fetch: (url, init) => { calls.push({ url, init }); return Promise.reject(Error('offline')); },
  });
  assert.doesNotThrow(() => {
    tracker.trackOnboardingEvent('a', 'profile_basic'); tracker.trackOnboardingEvent('a', 'profile_basic');
    tracker.trackOnboardingEvent('b', 'profile_basic'); tracker.trackOnboardingEvent(null, 'profile_basic');
    tracker.trackOnboardingEvent('a', 'unknown');
  });
  await Promise.resolve();
  assert.equal(calls.length, 2);
  for (const call of calls) assert.deepEqual(JSON.parse(call.init.body), { event: 'profile_basic' });
});
test('unsupported timeout/browser APIs cannot break registration', () => {
  const tracker = load('lib/onboarding-analytics.ts', {}, { window: {}, AbortSignal: {}, fetch: () => { throw Error('must not run'); } });
  assert.doesNotThrow(() => tracker.trackOnboardingEvent('a', 'profile_intro'));
});
function ingestion({ user = { id: 'trusted' }, throws = false, allowed = true } = {}) {
  const writes = [];
  const api = load('app/api/analytics/onboarding/route.ts', {
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user }) },
    '@/lib/request-rate-limit': { checkRateLimit: () => ({ allowed }) },
    '@/lib/supabase/server': { createAdminClient: () => ({ from: (table) => ({
      upsert: (row, options) => ({ abortSignal: async () => { writes.push({ table, row, options }); if (throws) throw Error('private failure'); return { error: null }; } }),
    }) }) },
  });
  return { writes, post: (body, headers = {}) => api.POST(new Request('https://helchang.com/api/analytics/onboarding', {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { origin: 'https://helchang.com', 'content-type': 'application/json', ...headers },
  })) };
}
test('ingestion takes identity from auth and stores first occurrence without private values', async () => {
  const f = ingestion(); const res = await f.post({ event: 'profile_intro' });
  assert.equal(res.status, 204);
  assert.deepEqual(f.writes, [{ table: 'onboarding_funnel_events', row: { user_id: 'trusted', event_name: 'profile_intro' },
    options: { onConflict: 'user_id,event_name', ignoreDuplicates: true } }]);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
});
for (const [name, body, headers, options] of [
  ['foreign origin', { event: 'profile_basic' }, { origin: 'https://evil.invalid' }, {}],
  ['no origin', { event: 'profile_basic' }, { origin: '' }, {}],
  ['wrong content type', { event: 'profile_basic' }, { 'content-type': 'text/plain' }, {}],
  ['invalid JSON', '{', {}, {}], ['body overflow', ' '.repeat(1000), {}, {}],
  ['declared overflow', { event: 'profile_basic' }, { 'content-length': '10000' }, {}],
  ['private fields', { event: 'profile_basic', phone: 'private' }, {}, {}],
  ['not logged in', { event: 'profile_basic' }, {}, { user: null }],
  ['rate limited', { event: 'profile_basic' }, {}, { allowed: false }],
]) test('ingestion safely discards ' + name, async () => {
  const f = ingestion(options); assert.equal((await f.post(body, headers)).status, 204); assert.equal(f.writes.length, 0);
});
test('missing SQL/database failure remains nonfatal and never exposes an error body', async () => {
  const f = ingestion({ throws: true }); const res = await f.post({ event: 'profile_basic' });
  assert.equal(res.status, 204); assert.equal(await res.text(), '');
});
const summary = { cohort_start: '2026-09-22T15:00:00Z', measured_at: '2026-09-23T03:00:00Z', tracking_since: '2026-09-22T16:00:00Z',
  counts: { joined: 10, verified: 8, profile: 6, one_on_one: 5, mutual: 2, exchanged: 1 }, events: { profile_basic: 8 }, unregistered: { profile_basic: 2 } };
function overview({ authorized = true, data = summary, error = null } = {}) {
  const calls = [];
  const api = load('app/api/admin/onboarding-funnel/route.ts', { '@/lib/admin-route': { requireAdminRoute: async () =>
    authorized ? { ok: true, admin: { rpc: async (...args) => { calls.push(args); return { data, error }; } } }
      : { ok: false, response: new Response(null, { status: 403 }) } } });
  return { calls, get: (days = '7') => api.GET(new Request('https://helchang.com/api/admin/onboarding-funnel?days=' + days)) };
}
test('admin overview uses one aggregate RPC, no member rows, private no-store', async () => {
  const f = overview(); const res = await f.get('30');
  assert.equal(res.status, 200); assert.equal((await res.json()).available, true);
  assert.deepEqual(f.calls, [['admin_onboarding_funnel_summary', { p_days: 30 }]]);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
});
test('non-admin cannot query the aggregate', async () => {
  const f = overview({ authorized: false }); assert.equal((await f.get()).status, 403); assert.equal(f.calls.length, 0);
});
for (const days of ['0', '2', '10000', '30x', 'null']) test('invalid range is not queried: ' + days, async () => {
  const f = overview(); assert.equal((await f.get(days)).status, 400); assert.equal(f.calls.length, 0);
});
for (const code of ['42883', '42P01', 'PGRST202', 'PGRST205']) test('missing setup is unavailable, not zero: ' + code, async () => {
  const f = overview({ error: { code, message: 'private' } }); const body = await (await f.get()).json();
  assert.equal(body.available, false); assert.equal(body.summary, undefined);
});
test('invalid data/other DB errors cannot appear as healthy empty metrics', async () => {
  for (const f of [overview({ data: null }), overview({ data: { ...summary, counts: {} } }),
    overview({ error: { code: '42501', message: 'private' } })]) {
    const res = await f.get(); assert.equal(res.status, 503); assert.ok(!(await res.text()).includes('private'));
  }
});
const recovery = load('lib/error-recovery.ts');
for (const url of ['/payments/success', '/payments/fail', '/payments/test/success', '/auth/callback', '/signup',
  '/onboarding/dating', '/account-deletion', '/dating/paid', '/unknown']) test('recovery never remounts action/callback page: ' + url, () => {
  assert.equal(recovery.getErrorRecoveryContext(url).canRetry, false);
});
for (const url of ['/community/dating/cards', '/mypage', '/notifications', '/phone-verification']) test('explicit retry only for audited read pages: ' + url, () => {
  assert.equal(recovery.getErrorRecoveryContext(url).canRetry, true);
});
test('support content does not read error text, stack, raw URL or credentials', () => {
  assert.equal(recovery.getSafeErrorDigest({ digest: 'phone=secret@email' }), '');
  const text = recovery.recoverySupportText('GT-1234', '결제', '검증시각');
  assert.ok(text.includes('문의 코드: GT-1234'));
  assert.ok(!text.includes('undefined'));
  const source = fs.readFileSync(path.join(root, 'components/ErrorRecovery.tsx'), 'utf8');
  assert.ok(!/error\.(message|stack)|location\.(href|search)|fetch\(/.test(source));
});
test('matching, payment and OTP backend implementations remain untouched', () => {
  for (const file of ['app/api/dating/1on1/recommendations/my/route.ts', 'lib/dating-1on1-recommendations.ts',
    'app/api/mypage/phone-verification/send/route.ts', 'app/api/mypage/phone-verification/verify/route.ts',
    'app/api/payments/toss/confirm/route.ts', 'app/api/dating/1on1/matches/my/route.ts']) {
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'),
      execFileSync('git', ['show', 'd2fa9e8:' + file], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n'));
  }
});
