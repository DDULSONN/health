/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { test } = require('node:test'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file) {
  const m = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', js)(require, m, m.exports); return m.exports;
}
const { PROFILE_REUSE_MAIL: mail, isOpenCardOnlyMailRecipient: eligible } = load('lib/open-card-profile-reuse-mail.ts');
function db(options = {}) {
  const queries = [];
  const user = { id: 'member', email: 'member@example.test', email_confirmed_at: '2026-10-01T00:00:00Z', ...options.user };
  return { queries, auth: { admin: { getUserById: async () => ({ data: { user: options.noUser ? null : user }, error: options.authError ? {} : null }) } },
    from(table) {
      const filters = []; queries.push({ table, filters });
      let result = { data: table === 'dating_cards' ? (options.noOpen ? [] : [{ id: 'open' }])
        : table === 'dating_1on1_cards' ? (options.hasOne ? [{ id: 'one' }] : [])
          : options.noProfile ? null : { role: 'user', is_banned: false, ...options.profile }, error: options.errorTable === table ? {} : null };
      const q = { select: () => q, eq: (...args) => { filters.push(args); return q; },
        in: (...args) => { filters.push(args); return q; }, limit: () => q, maybeSingle: () => Promise.resolve(result),
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) }; return q;
    } };
}
test('eligible only for owned active open, no 1:1 history, confirmed matching live account', async () => {
  const admin = db(); assert.equal(await eligible(admin, 'member', 'MEMBER@example.test'), true);
  assert.deepEqual(admin.queries.find(q => q.table === 'dating_cards').filters, [['owner_user_id', 'member'], ['status', ['pending', 'public']]]);
  assert.deepEqual(admin.queries.find(q => q.table === 'dating_1on1_cards').filters, [['user_id', 'member']]);
});
for (const options of [{ noOpen: true }, { hasOne: true }, { noProfile: true }, { noUser: true },
  { profile: { role: 'admin' } }, { profile: { is_banned: true } }, { authError: true },
  { user: { deleted_at: '2026-10-01' } }, { user: { email_confirmed_at: null } },
  { user: { email: 'changed@example.test' } }, { user: { id: 'another' } },
  { user: { banned_until: '2999-01-01T00:00:00Z' } }, { user: { banned_until: 'invalid-date' } },
  { errorTable: 'dating_cards' }, { errorTable: 'dating_1on1_cards' }, { errorTable: 'profiles' }]) {
  test('fail closed ' + JSON.stringify(options), async () => assert.equal(await eligible(db(options), 'member', 'member@example.test'), false));
}
test('empty identifiers and malformed mail never reach DB', async () => {
  assert.equal(await eligible({}, '', 'member@example.test'), false);
  assert.equal(await eligible({}, 'member', 'not-an-email'), false);
});
test('UTF-8 text, accurate claims, target URL, paid disclosure and signed opt-out footer', () => {
  for (const copy of [mail.subject, mail.body]) {
    assert.equal(Buffer.from(copy, 'utf8').toString('utf8'), copy);
    assert.ok(!/[\uFFFD\u0000]/.test(copy));
  }
  assert.ok(mail.subject.startsWith('(광고) '));
  for (const term of ['기존 오픈카드', '확인과 동의', '별도의 비용', '추천 후보로도', 'target=one_on_one', '이름·출생연도·자기소개']) assert.ok(mail.body.includes(term));
  const marketing = load('lib/marketing-email.ts');
  const text = marketing.appendMarketingEmailFooter({ body: mail.body, userId: 'member', email: 'member@example.test', campaignKey: mail.campaign });
  const url = new URL(text.split('\n').find(line => line.includes('/api/email/unsubscribe?')));
  assert.equal(url.searchParams.get('campaign'), 'one_on_one_outreach');
  assert.equal(marketing.verifyEmailUnsubscribeToken({ userId: 'member', email: 'member@example.test', campaignKey: mail.campaign, token: url.searchParams.get('token') }), true);
  const sender = fs.readFileSync(path.join(root, 'lib/dating-swipe.ts'), 'utf8');
  assert.ok(sender.includes('<meta charset="utf-8" />'));
});
test('queue requires explicit action, uses deterministic primary key; worker rechecks opt-in and selected cohort only', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/queue-open-card-profile-reuse-mail.cjs'), 'utf8');
  assert.ok(source.includes("if (!process.argv.includes('--queue')) return"));
  assert.ok(source.includes("argument('--expected-count') !== String(recipients.length)"));
  assert.ok(source.includes('.insert({ id: jobId')); assert.ok(!source.includes('.upsert('));
  assert.ok(source.includes('fetchEmailMarketingExcludedUserIds') && source.includes('emails.has(email)'));
  const worker = fs.readFileSync(path.join(root, 'app/api/cron/admin-outreach-mail-jobs/route.ts'), 'utf8');
  assert.ok(worker.indexOf('fetchEmailMarketingExcludedUserIds(admin') < worker.indexOf('sendDatingEmailToAddressDetailed(item.email'));
  assert.ok(worker.indexOf('await isOpenCardOnlyMailRecipient(admin') < worker.indexOf('sendDatingEmailToAddressDetailed(item.email'));
  assert.ok(worker.includes('require_open_without_one_on_one !== true'));
  assert.ok(worker.includes('COHORT_NO_LONGER_ELIGIBLE'));
});
