/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => dependencies[name] || require(name), mod, mod.exports);
  return mod.exports;
}
const ui = load('lib/auth-ui-recovery.ts');
function sourceTree(file) {
  return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function findNode(tree, predicate) {
  let result;
  const visit = node => { if (!result && predicate(node)) result = node; if (!result) ts.forEachChild(node, visit); };
  visit(tree); assert.ok(result, 'expected source node'); return result;
}
function evaluateExpression(expression, bindings) {
  const code = ts.transpileModule('const result = ' + expression + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), code + '\nreturn result;')(...Object.values(bindings));
}
for (const code of ['', 'RECOVERY_CHECK_FAILED', 'RECOVERY_NOT_AUTHENTICATED', 'UNKNOWN', 'RECOVERY_ACCOUNT_MISMATCH', 'RECOVERY_SESSION_EXPIRED']) {
  test('actual login callback preserves session only for retryable failures: ' + (code || 'success'), async () => {
    const tree = sourceTree('app/login/page.tsx');
    const declaration = findNode(tree, n => ts.isVariableDeclaration(n) && n.name.getText(tree) === 'finishPasswordRecoveryLogin');
    let signOuts = 0, retry = false;
    const callback = evaluateExpression(declaration.initializer.arguments[0].getText(tree), {
      isRecoveryFlow: true, checkAccountRecoverySession: async () => ({ ok: !code, code }),
      accountRecoveryNeedsRetry: ui.accountRecoveryNeedsRetry, setRecoveryRetry: value => { retry = value; }, setError() {},
    });
    const client = { auth: { signOut: async input => { assert.deepEqual(input, { scope: 'local' }); signOuts++; return { error: null }; } } };
    assert.equal(await callback(client), !code);
    assert.equal(signOuts, code && !ui.accountRecoveryNeedsRetry(code) ? 1 : 0);
    assert.equal(retry, Boolean(code && ui.accountRecoveryNeedsRetry(code)));
    signOuts = 0; retry = false;
    assert.equal(await callback(client, () => false), false);
    assert.equal(signOuts, 0, 'stale checks cannot sign out the current account');
    assert.equal(retry, false, 'stale checks cannot change the current UI');
  });
}
function linkHref(file, label, bindings) {
  const tree = sourceTree(file);
  const link = findNode(tree, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'Link' &&
    node.children.some(child => child.getText(tree).includes(label)));
  const href = link.openingElement.attributes.properties.find(p => p.name?.getText(tree) === 'href');
  return new URL(evaluateExpression(href.initializer.expression.getText(tree), bindings), 'https://fixture.invalid');
}
const safePath = load('lib/safe-internal-path.ts');
const recoveryLinks = load('lib/account-recovery.ts', { '@/lib/safe-internal-path': safePath });
for (const next of ['/onboarding/dating', '/community/dating/cards?tab=one_on_one#requests', '/mypage?section=matching']) {
  for (const recovery of [true, false]) test('actual reset navigation retains target and recovery mode: ' + next + ' / ' + recovery, () => {
    const reset = linkHref('app/login/page.tsx', '비밀번호를 잊으셨나요?', {
      next, isRecoveryFlow: recovery, buildPasswordResetHref: recoveryLinks.buildPasswordResetHref,
    });
    assert.equal(reset.pathname, '/auth/reset-password');
    assert.equal(reset.searchParams.get('next'), next);
    assert.equal(reset.searchParams.get('recovery'), recovery ? '1' : null);
    const back = linkHref('app/auth/reset-password/page.tsx', '돌아가기', { recoveryFlow: recovery, nextPath: next });
    assert.equal(back.pathname, recovery ? '/account-recovery' : '/login');
    assert.equal(back.searchParams.get('next'), next);
  });
}
for (const valid of [true, false]) test('real Supabase SDK: incoming OTP ' + (valid ? 'replaces' : 'does not validate') + ' the cached account', async () => {
  const { createClient } = require('@supabase/supabase-js');
  const key = 'fixture-recovery-' + valid;
  const member = id => ({ id, aud: 'authenticated', email: id + '@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
  const session = id => ({ access_token: 'fixture-access-' + id, refresh_token: 'fixture-refresh-' + id, token_type: 'bearer',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: member(id) });
  const values = new Map([[key, JSON.stringify(session('old-member'))]]); let requests = 0;
  const client = createClient('https://fixture.invalid', 'fixture-anon', { auth: {
    storageKey: key, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    storage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
  }, global: { fetch: async (url, init) => {
    assert.equal(String(url), 'https://fixture.invalid/auth/v1/verify'); assert.equal(init.method, 'POST'); requests++;
    const body = JSON.parse(init.body); assert.equal(body.token_hash, 'fixture-email-token'); assert.equal(body.type, 'recovery');
    return new Response(JSON.stringify(valid ? session('recovered-member') : { code: 'otp_expired', message: 'Token has expired' }), {
      status: valid ? 200 : 403, headers: { 'Content-Type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
    });
  } } });
  try {
    assert.equal((await client.auth.getSession()).data.session.user.id, 'old-member');
    const response = await client.auth.verifyOtp({ token_hash: 'fixture-email-token', type: 'recovery' });
    assert.equal(Boolean(response.error), !valid);
    assert.equal((await client.auth.getSession()).data.session.user.id, valid ? 'recovered-member' : 'old-member');
    assert.equal(requests, 1);
  } finally { await client.auth.stopAutoRefresh(); client.realtime.disconnect(); }
});
test('consumed auth tokens are removed without losing recovery mode or the destination', () => {
  let result;
  global.window = {
    location: { href: 'https://fixture.invalid/auth/callback?token_hash=secret&code=one-time&type=recovery&recovery=1&next=%2Fmypage#access_token=secret&refresh_token=secret' },
    history: { state: { fixture: true }, replaceState: (state, _title, href) => { assert.deepEqual(state, { fixture: true }); result = new URL(href); } },
  };
  try {
    ui.clearConsumedAuthLink();
    assert.equal(result.searchParams.get('recovery'), '1');
    assert.equal(result.searchParams.get('next'), '/mypage');
    assert.equal(result.hash, '');
    assert.ok(!result.href.includes('secret') && !result.href.includes('one-time'));
  } finally { delete global.window; }
});
test('blocked or full hint storage never breaks authentication UI', () => {
  global.window = { get localStorage() { throw Error('SecurityError'); } };
  try {
    assert.equal(ui.readAuthHint('recent_login_email'), null);
    assert.doesNotThrow(() => ui.writeAuthHint('recent_login_email', 'fixture@example.invalid'));
    assert.doesNotThrow(() => ui.removeAuthHint('pending_signup_referral'));
  } finally { delete global.window; }
});
test('auth read timeout ends waiting, without retrying or mutating an account', async () => {
  let reads = 0;
  await assert.rejects(ui.readAuthWithTimeout(() => { reads++; return new Promise(() => {}); }, 5), /auth_read_timeout/);
  assert.equal(reads, 1);
  assert.equal(await ui.readAuthWithTimeout(async () => 'member', 100), 'member');
  await assert.rejects(ui.readAuthWithTimeout(async () => { throw Error('offline'); }), /offline/);
});
test('temporary recovery failures can retry; mismatched and expired tickets cannot bypass verification', () => {
  for (const code of ['RECOVERY_CHECK_FAILED', 'RECOVERY_NOT_AUTHENTICATED', 'UNKNOWN']) assert.equal(ui.accountRecoveryNeedsRetry(code), true);
  for (const code of ['RECOVERY_ACCOUNT_MISMATCH', 'RECOVERY_SESSION_EXPIRED']) assert.equal(ui.accountRecoveryNeedsRetry(code), false);
});
for (const message of ['over_email_send_rate_limit', 'invalid email', 'Signups not allowed for otp', 'network failed']) test('email errors are Korean and do not disclose account details: ' + message, () => {
  const copy = ui.authEmailError(message);
  assert.match(copy, /[가-힣]/); assert.ok(!copy.includes(message)); assert.ok(!copy.includes('�'));
});
function routeHarness(options = {}) {
  let lookups = 0, cleared = 0;
  const route = load('app/api/account-recovery/session/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => {
      const response = new Response(JSON.stringify(data), init);
      response.cookies = { delete: () => { cleared++; } }; return response;
    } } },
    '@/lib/account-recovery-ticket': { ACCOUNT_RECOVERY_COOKIE: 'ticket', readAccountRecoveryTicket: value => value === 'valid' ? { phoneHash: options.ticketHash || 'same' } : null },
    '@/lib/solapi-phone-verification': { hashPhoneForVerificationStorage: () => 'same' },
    '@/lib/supabase/server': {
      createClient: async () => ({ auth: { getUser: async () => {
        if (options.authThrows) throw Error('network');
        return { data: { user: options.guest ? null : { id: 'member', ...(options.deleted ? { deleted_at: '2026-01-01' } : {}) } }, error: options.authError || null };
      } } }),
      createAdminClient: () => ({ from: table => {
        assert.equal(table, 'profiles'); lookups++;
        const q = { select: fields => { assert.equal(fields, 'phone_verified,phone_e164'); return q; }, eq: (field, id) => { assert.equal(field, 'user_id'); assert.equal(id, 'member'); return q; }, maybeSingle: async () => {
          if (options.dbThrows) throw Error('db');
          return { data: options.missing ? null : { phone_verified: !options.unverified, phone_e164: '+821012345678' }, error: options.dbError ? { message: 'fixture failure' } : null };
        } }; return q;
      } }),
    },
  });
  return { run: () => route.GET({ cookies: { get: () => options.ticket ? { value: options.ticket } : undefined } }), get lookups() { return lookups; }, get cleared() { return cleared; } };
}
for (const [name, options, status, code, cleared] of [
  ['matching phone', { ticket: 'valid' }, 200, undefined, 1],
  ['generic recovery still supports already verified accounts', {}, 200, undefined, 0],
  ['different phone rejected', { ticket: 'valid', ticketHash: 'other' }, 409, 'RECOVERY_ACCOUNT_MISMATCH', 0],
  ['expired/tampered ticket rejected', { ticket: 'expired' }, 409, 'RECOVERY_SESSION_EXPIRED', 0],
  ['unverified account rejected', { unverified: true }, 409, 'RECOVERY_ACCOUNT_MISMATCH', 0],
  ['missing profile rejected', { missing: true }, 409, 'RECOVERY_ACCOUNT_MISMATCH', 0],
  ['anonymous rejected before lookup', { guest: true }, 401, 'RECOVERY_NOT_AUTHENTICATED', 0],
  ['deleted account rejected', { deleted: true }, 401, 'RECOVERY_NOT_AUTHENTICATED', 0],
  ['expired auth rejected', { authError: { status: 401 } }, 401, 'RECOVERY_NOT_AUTHENTICATED', 0],
  ['auth outage is retryable', { authError: { status: 503 } }, 503, 'RECOVERY_CHECK_FAILED', 0],
  ['thrown auth outage is retryable', { authThrows: true }, 503, 'RECOVERY_CHECK_FAILED', 0],
  ['database outage is retryable', { dbError: true }, 503, 'RECOVERY_CHECK_FAILED', 0],
  ['thrown database outage is retryable', { dbThrows: true }, 503, 'RECOVERY_CHECK_FAILED', 0],
]) test('recovery endpoint: ' + name, async () => {
  const h = routeHarness(options), response = await h.run(), body = await response.json();
  assert.equal(response.status, status); assert.equal(body.code, code); assert.equal(body.ok, status === 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(h.cleared, cleared);
  assert.ok(!JSON.stringify(body).includes('8210')); assert.ok(!JSON.stringify(body).includes('email'));
  if (options.guest || options.authError || options.authThrows || options.deleted) assert.equal(h.lookups, 0);
});
for (const [name, statuses, expected, expectedReads] of [
  ['success', [200], '', 1], ['one transient retry', [503, 200], '', 2],
  ['persistent outage', [503, 503], 'RECOVERY_CHECK_FAILED', 2],
  ['mismatch does not retry', [409], 'RECOVERY_ACCOUNT_MISMATCH', 1],
  ['network timeout stays bounded', ['hang', 'hang'], 'RECOVERY_CHECK_FAILED', 2],
]) test('recovery client: ' + name, async () => {
  const originalFetch = global.fetch; let reads = 0;
  global.window = { setTimeout: fn => setTimeout(fn, 1) };
  global.fetch = async (_url, init) => {
    assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'same-origin');
    const status = statuses[reads++];
    if (status === 'hang') return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Error('aborted'))));
    return new Response(JSON.stringify({ ok: status === 200, code: status === 409 ? 'RECOVERY_ACCOUNT_MISMATCH' : 'RECOVERY_CHECK_FAILED' }), { status });
  };
  const request = load('lib/client-json-request.ts');
  const client = load('lib/account-recovery-client.ts', { '@/lib/client-json-request': { fetchClientJson: (url, init) => request.fetchClientJson(url, init, 5) } });
  try {
    assert.deepEqual(await client.checkAccountRecoverySession(), { ok: expected === '', code: expected }); assert.equal(reads, expectedReads);
  } finally { global.fetch = originalFetch; delete global.window; }
});
