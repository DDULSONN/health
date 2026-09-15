/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, mocks = {}) {
  const mod = { exports: {} };
  const js = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function('require', 'module', 'exports', js)((id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('@/')) throw new Error('Unexpected dependency: ' + id);
    return require(id);
  }, mod, mod.exports);
  return mod.exports;
}

const { getVerifiedLoginUser } = load('lib/verified-login-user.ts');
function authMock({ noSession, user = { id: 'member' }, error, sessionError } = {}) {
  const calls = [];
  return { calls, auth: {
    getSession: async () => ({ data: { session: noSession ? null : { user: { id: 'cached' } } }, error: sessionError }),
    getUser: async () => { calls.push('verify'); return { data: { user }, error }; },
    signOut: async (options) => { calls.push(options.scope); return { error: null }; },
  } };
}
test('login uses live Auth user, not cached user', async () => {
  const client = authMock();
  assert.equal((await getVerifiedLoginUser(client)).id, 'member');
  assert.deepEqual(client.calls, ['verify']);
});
test('anonymous login does not query Auth', async () => {
  const client = authMock({ noSession: true });
  assert.equal(await getVerifiedLoginUser(client), null);
  assert.deepEqual(client.calls, []);
});
test('deleted and invalid cached sessions never redirect as logged in', async () => {
  for (const options of [{ user: { id: 'member', deleted_at: '2026-09-15' } },
    { error: { code: 'user_not_found' } }, { error: { code: 'session_not_found' } },
    { error: { status: 401 } }]) {
    const client = authMock(options);
    assert.equal(await getVerifiedLoginUser(client), null);
    assert.deepEqual(client.calls, ['verify', 'local']);
  }
});
test('Auth/network outages do not sign out active members', async () => {
  for (const error of [{ status: 503 }, { name: 'AuthRetryableFetchError' }]) {
    const client = authMock({ error });
    await assert.rejects(getVerifiedLoginUser(client));
    assert.deepEqual(client.calls, ['verify']);
  }
});

function routeMock({ user = { id: 'self', email: 'test@example.invalid' }, result, originBlocked } = {}) {
  const deletions = [];
  const expired = [];
  const { NextResponse } = require('next/server');
  const DELETE = load('app/api/mypage/account/route.ts', {
    '@/lib/account-deletion': {
      getAccountDeletionConfigError: () => null, getRequestIp: () => null,
      accountDeletionMessage: (pending) => pending ? '정리 미완료' : '탈퇴 완료',
      performAccountDeletion: async (params) => { deletions.push(params.userId); return result ?? { ok: true, mode: 'hard', cleanupPending: false, hiddenOpenCards: 0 }; },
    },
    '@/lib/request-origin': { ensureAllowedMutationOrigin: () => originBlocked ? NextResponse.json({}, { status: 403 }) : null },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user }) },
    '@/lib/supabase/server': { createAdminClient: () => ({}) },
    'next/headers': { cookies: async () => ({
      getAll: () => ['sb-example-auth-token.0', 'sb-example-auth-token.1', 'sb-other-auth-token', 'theme', 'sb-example-auth-token-code-verifier'].map((name) => ({ name, value: 'value' })),
      set: (name, value, options) => { assert.equal(value, ''); assert.equal(options.maxAge, 0); expired.push(name); },
    }) },
  }).DELETE;
  return { DELETE, deletions, expired };
}
test('self deletion rejects anonymous, wrong account and foreign-origin requests before mutation', async () => {
  for (const [config, expected, expectedUser] of [[{ user: null }, 401, 'self'], [{}, 409, 'someone-else'], [{ originBlocked: true }, 403, 'self']]) {
    const state = routeMock(config);
    const res = await state.DELETE(new Request('https://example.com/api/mypage/account', { method: 'DELETE', headers: { 'x-account-user-id': expectedUser } }));
    assert.equal(res.status, expected);
    assert.deepEqual(state.deletions, []);
    assert.deepEqual(state.expired, []);
  }
});
test('successful self deletion expires only this project login cookies, including chunks', async () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  try {
    for (const soft of [false, true]) {
      const state = routeMock({ result: { ok: true, mode: soft ? 'soft' : 'hard', cleanupPending: soft, hiddenOpenCards: 1 } });
      const res = await state.DELETE(new Request('https://example.com/api/mypage/account', { method: 'DELETE', headers: { 'x-account-user-id': 'self' } }));
      assert.deepEqual(state.deletions, ['self']);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.cleanup_pending, soft);
      assert.deepEqual(state.expired.sort(), ['sb-example-auth-token', 'sb-example-auth-token.0', 'sb-example-auth-token.1']);
      assert.equal(res.cookies.get('sb-example-auth-token.0').value, '');
      assert.equal(res.cookies.get('sb-other-auth-token'), undefined);
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  }
});
test('failed deletion does not clear active member cookies', async () => {
  const state = routeMock({ result: { ok: false, error: 'delete failed' } });
  const res = await state.DELETE(new Request('https://example.com/api/mypage/account', { method: 'DELETE' }));
  assert.equal(res.status, 500);
  assert.deepEqual(state.expired, []);
});

function getDeletionHandler(globals) {
  const file = ts.createSourceFile('page.tsx', read('app/mypage/page.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleDeleteAccount') handler = node.initializer.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(handler);
  const code = ts.transpileModule('const handler = ' + handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(globals), code + '; return handler;')(...Object.values(globals));
}
test('real mypage handler authenticates deletion and fully reloads only after success', async () => {
  for (const [succeeds, signOutFails] of [[true, false], [true, true], [false, false]]) {
    const events = [];
    const handler = getDeletionHandler({
      deletingAccount: false,
      setAccountDeleteConfirmOpen: () => {}, setDeletingAccount: () => {},
      supabase: { auth: {
        getSession: async () => ({ data: { session: { user: { id: 'self' }, access_token: 'test-token' } }, error: null }),
        signOut: async (options) => { events.push(options.scope); if (signOutFails) throw new Error('offline'); return { error: null }; },
      } },
      fetch: async (url, options) => {
        assert.equal(url, '/api/mypage/account');
        assert.equal(options.method, 'DELETE');
        assert.equal(options.headers.Authorization, 'Bearer test-token');
        assert.equal(options.headers['x-account-user-id'], 'self');
        return { ok: succeeds, json: async () => ({ ok: succeeds }) };
      },
      alert: () => {}, console: { warn: () => {}, error: () => {} },
      window: { location: { replace: (url) => events.push(url) } },
    });
    await handler();
    assert.deepEqual(events, succeeds ? ['local', '/'] : []);
  }
});

test('PostgreSQL: reproduce old cascade failure, fix it, preserve normal history and other members', async () => {
  assert.ok(process.env.ACCOUNT_DELETION_PGLITE_PATH, 'Set ACCOUNT_DELETION_PGLITE_PATH to @electric-sql/pglite (isolated local database, never production)');
  const { PGlite } = require(process.env.ACCOUNT_DELETION_PGLITE_PATH);
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth; create role authenticated;
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create table auth.users(id uuid primary key);
      create table profiles(user_id uuid references auth.users(id) on delete cascade, role text);
      create table dating_1on1_cards(id uuid primary key, user_id uuid references auth.users(id) on delete cascade, status text, created_at timestamptz default now());
      create table notifications(user_id uuid references auth.users(id) on delete cascade);
    `);
    const migration = read('supabase/sql/dating_1on1_card_profile_history.sql');
    const oldMigration = migration.replace(/  -- Auth deletion cascades[\s\S]*?  end if;\s*\n/, '');
    assert.notEqual(oldMigration, migration, 'baseline removes only the new cascade guard');
    await db.exec(oldMigration);
    const one = '00000000-0000-0000-0000-000000000001';
    const two = '00000000-0000-0000-0000-000000000002';
    const card = '10000000-0000-0000-0000-000000000001';
    await db.exec(`insert into auth.users values ('${one}'),('${two}'); insert into profiles values ('${one}','user'),('${two}','user'); insert into notifications values ('${one}'),('${two}'); insert into dating_1on1_cards(id,user_id,status) values ('${card}','${one}','approved'),('${two}','${two}','approved');`);
    await assert.rejects(db.exec(`delete from auth.users where id='${one}'`), (err) => err.code === '23503' && err.constraint === 'dating_1on1_card_profile_history_user_id_fkey');
    const fix = read('supabase/sql/account_deletion_profile_history_fix.sql');
    await db.exec(fix);
    await db.exec(fix);
    assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n, 2, 'migration itself never deletes accounts');
    await db.exec(`update dating_1on1_cards set status='reviewing' where id='${card}'; delete from dating_1on1_cards where id='${card}';`);
    assert.deepEqual((await db.query(`select event_type from dating_1on1_card_profile_history where user_id='${one}' order by created_at,id`)).rows.map((r) => r.event_type).sort(), ['created', 'deleted', 'updated']);
    await db.exec(`insert into dating_1on1_cards(id,user_id,status) values ('${card}','${one}','approved'); delete from auth.users where id='${one}';`);
    for (const table of ['profiles', 'notifications', 'dating_1on1_cards', 'dating_1on1_card_profile_history']) {
      const rows = (await db.query(`select user_id from ${table}`)).rows;
      assert.deepEqual(rows.map((r) => r.user_id), [two], table + ': only the other member remains');
    }
    await assert.rejects(db.exec(`insert into dating_1on1_card_profile_history(user_id,event_type,snapshot) values ('${one}','created','{}')`), (err) => err.code === '23503');
    // Fresh install/re-running the base migration must retain the same guard.
    await db.exec(migration);
    await db.exec(`delete from auth.users where id='${two}'`);
    assert.equal((await db.query('select count(*)::int n from dating_1on1_card_profile_history')).rows[0].n, 0);
  } finally { await db.close(); }
});
