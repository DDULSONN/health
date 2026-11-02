/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, env = {}) {
  const m = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'module', 'exports', 'process', js)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', mocks, env);
    throw Error('Unexpected dependency ' + name);
  }, m, m.exports, { env });
  return m.exports;
}
const { filterMalformedSessionCookies: filter } = load('lib/supabase/session-cookies.ts');
const url = 'https://synthetic.supabase.co', key = 'sb-synthetic-auth-token';
const cookie = (name, value) => ({ name, value });
const encode = value => 'base64-' + Buffer.from(value).toString('base64url');
const session = JSON.stringify({ access_token: 'synthetic', refresh_token: 'synthetic', expires_at: 2000000000, user: { id: 'fixture', name: '한글 🙂' } });
for (const value of [session, encode(session)]) test('valid session bytes are untouched: ' + value.slice(0, 7), () => {
  const cookies = [cookie(key, value), cookie('theme', 'dark')];
  assert.equal(filter(cookies, url), cookies);
});
test('chunked Unicode session is untouched; whole cookie takes SDK precedence', () => {
  const value = encode(session), cookies = [cookie(key + '.1', value.slice(30)), cookie(key + '.0', value.slice(0, 30))];
  assert.equal(filter(cookies, url), cookies);
  const whole = [...cookies, cookie(key, session), cookie(key + '.2', 'stale')];
  assert.equal(filter(whole, url), whole);
});
for (const value of ['{broken', JSON.stringify(session), 'null', '[]', 'true', 'base64-???', encode('{broken')]) {
  test('malformed session isolated, verifier/other project cookies preserved: ' + value.slice(0, 12), () => {
    const others = [cookie(key + '-code-verifier', 'pkce'), cookie('sb-other-auth-token', session), cookie('theme', 'dark')];
    assert.deepEqual(filter([cookie(key, value), cookie(key + '.0', 'stale'), ...others], url), others);
  });
}
test('missing config/session does not touch unrelated cookies', () => {
  const cookies = [cookie('theme', 'dark')];
  assert.equal(filter(cookies, url), cookies); assert.equal(filter(cookies, ''), cookies);
});
test('actual Supabase SDK cannot leak a malformed session or call Auth using it', async t => {
  const logs = [], errors = t.mock.method(console, 'error', (...args) => logs.push(args));
  let calls = 0;
  const { createServerClient } = require('@supabase/ssr');
  const client = createServerClient(url, 'synthetic-anon', {
    global: { fetch: async () => { calls++; throw Error('NETWORK_FORBIDDEN'); } },
    cookies: { getAll: () => filter([cookie(key, encode(JSON.stringify(session)))], url), setAll: () => {} },
  });
  const result = await client.auth.getSession();
  assert.equal(result.data.session, null); assert.equal(calls, 0); assert.deepEqual(logs, []);
  errors.mock.restore();
});
function authFixture({ cookieThrows = false, bearerValid = true, cookieValid = false } = {}) {
  const failure = Error('upstream unavailable'); const calls = [];
  const cookieClient = { auth: { getUser: async () => { calls.push('cookie'); if (cookieThrows) throw failure;
    return { data: { user: cookieValid ? { id: 'cookie-user' } : null }, error: null }; } } };
  const bearerClient = { auth: { getUser: async token => { calls.push(token);
    return { data: { user: bearerValid ? { id: 'verified-bearer-user' } : null }, error: null }; } } };
  const api = load('lib/supabase/request.ts', {
    '@/lib/supabase/server': { createClient: async () => cookieClient },
    '@supabase/supabase-js': { createClient: (_url, _key, options) => {
      assert.equal(options.auth.persistSession, false); assert.equal(options.auth.autoRefreshToken, false); return bearerClient;
    } },
  });
  return { api, failure, calls };
}
test('cookie lookup exception still permits a server-verified bearer session', async () => {
  const f = authFixture({ cookieThrows: true });
  const result = await f.api.getRequestAuthContext(new Request('https://example.invalid', { headers: { Authorization: 'Bearer synthetic' } }));
  assert.equal(result.user.id, 'verified-bearer-user'); assert.equal(result.authMode, 'bearer'); assert.deepEqual(f.calls, ['cookie', 'synthetic']);
});
for (const token of [null, 'invalid']) test('upstream failure with no valid bearer is not converted into logout: ' + token, async () => {
  const f = authFixture({ cookieThrows: true, bearerValid: false });
  await assert.rejects(f.api.getRequestAuthContext(new Request('https://example.invalid', { headers: token ? { Authorization: 'Bearer ' + token } : {} })), f.failure);
});
test('valid cookie retains identity even if a different bearer is supplied', async () => {
  const f = authFixture({ cookieValid: true });
  const result = await f.api.getRequestAuthContext(new Request('https://example.invalid', { headers: { Authorization: 'Bearer other' } }));
  assert.equal(result.user.id, 'cookie-user'); assert.deepEqual(f.calls, ['cookie']);
});
test('missing sessions are anonymous, never inferred from unverified data', async () => {
  const f = authFixture({ bearerValid: false });
  assert.equal((await f.api.getRequestAuthContext(new Request('https://example.invalid'))).user, null);
});
function nudgeFixture(failAt = -1, legacy = false) {
  const reads = [];
  const admin = { from: table => {
    assert.equal(table, 'dating_1on1_contact_nudges'); let ids, columns;
    const q = { select: value => { columns = value; return q; }, in: (column, value) => { assert.equal(column, 'match_id'); ids = value; return q; },
      order: () => q, abortSignal: signal => { assert.ok(signal instanceof AbortSignal); return q; },
      then: (resolve, reject) => {
        reads.push({ ids, columns });
        const error = reads.length === failAt ? { code: '57014' } : legacy && columns.includes('read_at') ? { code: '42703', message: 'column read_at does not exist' } : null;
        return Promise.resolve({ data: error ? null : ids.map(id => ({ id: 'n' + id, match_id: id, created_at: '2026-11-01T00:00:00Z', message_text: '반가워요 🙂' })), error }).then(resolve, reject);
      } }; return q;
  } };
  return { admin, reads, api: load('lib/dating-1on1-contact-nudges-server.ts') };
}
test('650 match IDs are read in bounded batches without losing messages', async () => {
  const f = nudgeFixture(); const ids = Array.from({ length: 650 }, (_, i) => 'id' + i);
  const result = await f.api.loadOneOnOneContactNudges(f.admin, [...ids, ...ids.slice(0, 5)]);
  assert.equal(result.available, true); assert.equal(result.rows.length, 650); assert.equal(f.reads.length, 7);
  assert.ok(f.reads.every(r => r.ids.length <= 100)); assert.deepEqual(new Set(result.rows.map(r => r.match_id)), new Set(ids));
});
test('old schema falls back once, preserving original Korean messages', async () => {
  const f = nudgeFixture(-1, true);
  const result = await f.api.loadOneOnOneContactNudges(f.admin, Array.from({ length: 201 }, (_, i) => String(i)));
  assert.equal(result.available, true); assert.equal(result.readReceiptsAvailable, false); assert.equal(result.rows.length, 201);
  assert.equal(f.reads.length, 4); assert.equal(result.rows[0].message_text, '반가워요 🙂');
});
test('partial/timeout failure never enables sending on incomplete messages', async t => {
  const logs = []; t.mock.method(console, 'error', (...args) => logs.push(args));
  const f = nudgeFixture(2);
  const result = await f.api.loadOneOnOneContactNudges(f.admin, Array.from({ length: 201 }, (_, i) => String(i)));
  assert.deepEqual(result, { available: false, readReceiptsAvailable: false, rows: [] }); assert.equal(f.reads.length, 2);
  assert.deepEqual(logs, [['[contact-nudge] optional lookup failed', { code: '57014' }]]);
});
test('no matches means no enrichment query', async () => {
  const f = nudgeFixture(); await f.api.loadOneOnOneContactNudges(f.admin, []); assert.equal(f.reads.length, 0);
});
