/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { test } = require('node:test'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith('@/')) return require(name);
    if (cache.has(name)) return cache.get(name).exports;
    const m = { exports: {} }; cache.set(name, m);
    const js = ts.transpileModule(fs.readFileSync(path.join(root, name.slice(2) + '.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', ...Object.keys(globals), js)(load, m, m.exports, ...Object.values(globals)); return m.exports;
  }
  return load;
}
// Test the default config without inheriting deployment URLs or rollout overrides.
const load = loader({}, { process: { env: {} } });
const { EXPANSION_MAIL: mail, isExpansionMailRecipient: eligible } = load('@/lib/dating-expansion-mail');
function db(options = {}) {
  const queries = [];
  const user = { id: 'member', email: 'member@example.test', email_confirmed_at: '2026-10-01T00:00:00Z', ...options.user };
  return { queries, auth: { admin: { getUserById: async () => ({ data: { user: options.noUser ? null : user }, error: options.authError ? {} : null }) } },
    from(table) {
      const filters = []; queries.push({ table, filters });
      const result = { data: table === 'dating_1on1_cards' ? (options.noOne ? [] : [{ birth_year: 1996, ...options.card }])
        : options.noProfile ? null : { role: 'user', is_banned: false, phone_e164: '+821012345678', ...options.profile },
      error: options.errorTable === table ? {} : null };
      const q = { select: () => q, eq: (...args) => { filters.push(args); return q; },
        in: (...args) => { filters.push(args); return q; }, order: (...args) => { filters.push(['order', ...args]); return q; },
        limit: value => { filters.push(['limit', value]); return q; }, maybeSingle: () => Promise.resolve(result),
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) }; return q;
    } };
}
test('recipient requires the newest active owned 1:1 profile and a matching verified live account', async () => {
  const admin = db(); assert.equal(await eligible(admin, 'member', 'MEMBER@example.test'), true);
  assert.deepEqual(admin.queries.find(q => q.table === 'dating_1on1_cards').filters, [
    ['user_id', 'member'], ['status', ['submitted', 'reviewing', 'approved']],
    ['order', 'created_at', { ascending: false }], ['order', 'id', { ascending: false }], ['limit', 1],
  ]);
});
for (const options of [{ noOne: true }, { noProfile: true }, { noUser: true }, { authError: true },
  { profile: { role: 'admin' } }, { profile: { is_banned: true } }, { profile: { phone_e164: null } },
  { profile: { phone_e164: 'invalid' } }, { card: { birth_year: null } }, { card: { birth_year: 2020 } },
  { card: { birth_year: 1900 } }, { user: { deleted_at: '2026-10-01' } }, { user: { email_confirmed_at: null } },
  { user: { email: 'changed@example.test' } }, { user: { id: 'another' } },
  { user: { banned_until: '2999-01-01T00:00:00Z' } }, { user: { banned_until: 'invalid-date' } },
  { errorTable: 'dating_1on1_cards' }, { errorTable: 'profiles' }]) {
  test('expansion notice excludes ' + JSON.stringify(options), async () => assert.equal(await eligible(db(options), 'member', 'member@example.test'), false));
}
test('invalid addresses and disabled rollout never query members', async () => {
  assert.equal(await eligible({}, '', 'member@example.test'), false);
  assert.equal(await eligible({}, 'member', 'not-an-email'), false);
  const disabled = loader({ '@/lib/dating-1on1-expansion': { isExpansionEnabled: () => false } })('@/lib/dating-expansion-mail');
  assert.equal(await disabled.isExpansionMailRecipient({}, 'member', 'member@example.test'), false);
});
test('UTF-8 copy is accurate, bounded, non-weekend-only, and signed unsubscribe works', () => {
  for (const copy of [mail.subject, mail.body]) {
    assert.equal(Buffer.from(copy, 'utf8').toString('utf8'), copy);
    assert.ok(!/[\uFFFD\u0000]/.test(copy));
  }
  assert.ok(mail.subject.startsWith('(광고) '));
  for (const term of ['하루 최대 3명', '기존 추천 후보', '오늘의 추가 후보', '나이 조건은 유지', '새로고침 횟수는 차감되지',
    '같은 날에는 다시 눌러도', '별도의 비용', '?tab=one_on_one']) assert.ok(mail.body.includes(term), term);
  assert.ok(!/주말|반드시 3명|무조건/.test(mail.body));
  const marketing = load('@/lib/marketing-email');
  const text = marketing.appendMarketingEmailFooter({ body: mail.body, userId: 'member', email: 'member@example.test', campaignKey: mail.campaign });
  const url = new URL(text.split('\n').find(line => line.includes('/api/email/unsubscribe?')));
  assert.equal(url.origin, 'https://helchang.com');
  assert.equal(marketing.verifyEmailUnsubscribeToken({ userId: 'member', email: 'member@example.test', campaignKey: mail.campaign, token: url.searchParams.get('token') }), true);
  assert.equal(marketing.verifyEmailUnsubscribeToken({ userId: 'another', email: 'member@example.test', campaignKey: mail.campaign, token: url.searchParams.get('token') }), false);
});
test('queue is preview-only by default, checks deployment/count and prevents duplicate jobs/emails', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/queue-dating-expansion-mail.cjs'), 'utf8');
  assert.ok(source.includes('if (!queue) return;'));
  assert.ok(source.includes("argument('--expected-count') !== String(recipients.length)"));
  assert.ok(source.indexOf("await verifyDeployment(argument('--deployment'))") < source.indexOf('.insert({ id: jobId'));
  assert.ok(source.includes("states[0]?.state !== 'success'"));
  assert.ok(source.includes('.insert({ id: jobId')); assert.ok(!source.includes('.upsert('));
  assert.ok(source.includes('emails.has(email)') && source.includes('fetchEmailMarketingExcludedUserIds'));
  assert.ok(source.includes("UNAUTHORIZED_MUTATION") && source.includes("method === 'POST'"));
  const { jobId } = require('./queue-dating-expansion-mail.cjs');
  assert.match(jobId, /^[a-f0-9-]{36}$/);
});
test('unsubscribe uses the configured deployment host, including www and preview domains', () => {
  for (const origin of ['https://www.helchang.com', 'https://fixture.vercel.app']) {
    const marketing = loader({}, { process: { env: { NEXT_PUBLIC_SITE_URL: origin } } })('@/lib/marketing-email');
    const url = new URL(marketing.buildEmailUnsubscribeUrl({ userId: 'member', email: 'member@example.test', campaignKey: mail.campaign }));
    assert.equal(url.origin, origin);
    assert.equal(marketing.verifyEmailUnsubscribeToken({ userId: 'member', email: 'member@example.test', campaignKey: mail.campaign, token: url.searchParams.get('token') }), true);
  }
});
test('real mail sender preserves Korean in UTF-8 JSON, plain text and HTML with only one addressee', async () => {
  const marketing = load('@/lib/marketing-email');
  const text = marketing.appendMarketingEmailFooter({ body: mail.body, userId: 'member', email: 'member@example.test', campaignKey: mail.campaign });
  let calls = 0;
  const sender = loader({ '@/lib/images': {}, '@/lib/dating-open': {}, '@/lib/dating-blocks': {},
    '@/lib/dating-contact-blocks': {}, '@/lib/supabase/server': {}, '@/lib/marketing-email': {} }, {
    process: { env: { RESEND_API_KEY: 'fixture-key', NOTIFY_FROM_EMAIL: 'Fixture <sender@example.test>' } },
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.resend.com/emails');
      const payload = JSON.parse(Buffer.from(options.body, 'utf8').toString('utf8'));
      assert.deepEqual(payload.to, ['member@example.test']);
      assert.equal(payload.subject, mail.subject); assert.equal(payload.text, text);
      assert.ok(payload.html.includes('<meta charset="utf-8" />'));
      assert.ok(payload.html.includes('후보 넓혀보기')); assert.ok(payload.html.includes('수신거부'));
      assert.ok(!/[\uFFFD\u0000]/.test(options.body));
      assert.equal(options.headers['Idempotency-Key'], 'fixture-expansion-member');
      return new Response('{}', { status: 200 });
    },
  })('@/lib/dating-swipe');
  assert.equal((await sender.sendDatingEmailToAddressDetailed('member@example.test', mail.subject, text, { idempotencyKey: 'fixture-expansion-member' })).ok, true);
  assert.equal(calls, 1);
});

// Exercise the actual worker with isolated DB/provider stubs. Never calls the network or a real recipient.
async function runWorker({ consent = true, cohort = true, flagged = true, missingEmail = false, authorized = true } = {}) {
  const events = [], writes = [];
  const job = { id: 'job', campaign_key: mail.campaign, status: 'queued', subject: mail.subject, body: mail.body,
    filters: flagged ? { require_expansion_eligible: true } : {}, recipients: [{ user_id: 'member', email: missingEmail ? null : 'member@example.test' }],
    processed_count: 0, total_count: 1, sent_count: 0, failed_count: 0 };
  const admin = { from(table) {
    let mutation = false;
    const q = { select: () => q, in: () => q, order: () => q, eq: () => q, limit: () => q,
      update: value => { mutation = true; writes.push({ table, value }); return q; },
      insert: value => { mutation = true; writes.push({ table, value }); return q; },
      then: (resolve, reject) => Promise.resolve({ data: mutation ? null : [job], error: null }).then(resolve, reject) }; return q;
  } };
  const worker = loader({
    '@/lib/cron-auth': { ensureCronAuthorized: () => authorized ? null : new Response(null, { status: 401 }) },
    '@/lib/supabase/server': { createAdminClient: () => admin },
    '@/lib/marketing-email': {
      fetchEmailMarketingExcludedUserIds: async () => { events.push('consent'); return new Set(consent ? [] : ['member']); },
      appendMarketingEmailFooter: input => { events.push('footer'); return input.body + '\nSIGNED-OPT-OUT'; },
    },
    '@/lib/open-card-profile-reuse-mail': { isOpenCardOnlyMailRecipient: () => { throw Error('unrelated cohort called'); } },
    '@/lib/dating-expansion-mail': { isExpansionMailRecipient: async () => { events.push('eligibility'); return cohort; } },
    '@/lib/dating-swipe': { sendDatingEmailToAddressDetailed: async (email, subject, body, options) => {
      events.push('send'); assert.equal(email, 'member@example.test'); assert.equal(subject, mail.subject);
      assert.ok(body.endsWith('SIGNED-OPT-OUT')); assert.equal(options.idempotencyKey, 'outreach-job:job:member:0');
      return { ok: true, status: 200 };
    } },
  })('@/app/api/cron/admin-outreach-mail-jobs/route');
  const response = await worker.GET(new Request('https://fixture.invalid'));
  return { response, events, writes };
}
test('worker checks consent and current eligibility before sending a single idempotent email', async () => {
  const r = await runWorker(); assert.equal(r.response.status, 200);
  assert.deepEqual(r.events, ['consent', 'eligibility', 'footer', 'send']);
  assert.equal((await r.response.json()).result.sent, 1);
});
test('consent withdrawal after queueing stops delivery without querying the profile', async () => {
  const r = await runWorker({ consent: false }); assert.deepEqual(r.events, ['consent']);
  assert.equal((await r.response.json()).result.sent, 0);
});
test('withdrawn/banned/ineligible profile after queueing stops delivery', async () => {
  const r = await runWorker({ cohort: false }); assert.deepEqual(r.events, ['consent', 'eligibility']);
  assert.equal((await r.response.json()).result.sent, 0);
  assert.ok(r.writes.some(w => Array.isArray(w.value) && w.value[0]?.provider_error === 'COHORT_NO_LONGER_ELIGIBLE'));
});
test('older unrelated outreach jobs do not acquire new eligibility restrictions', async () => {
  const r = await runWorker({ flagged: false, cohort: false }); assert.deepEqual(r.events, ['consent', 'footer', 'send']);
});
test('missing email cannot be sent', async () => {
  const r = await runWorker({ missingEmail: true }); assert.deepEqual(r.events, ['consent']);
});
test('unauthorized worker call cannot read or send', async () => {
  const r = await runWorker({ authorized: false }); assert.equal(r.response.status, 401);
  assert.deepEqual(r.events, []); assert.deepEqual(r.writes, []);
});
