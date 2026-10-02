/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only by default. --queue requires an exact count and the already-verified deployment SHA.
// The existing production worker supplies server-signed unsubscribe links and handles actual delivery.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ts = require('typescript'), { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '..');
function load(relative) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', js)(require, loaded, loaded.exports);
  return loaded.exports;
}
const { PROFILE_REUSE_MAIL: mail, isOpenCardOnlyMailRecipient } = load('lib/open-card-profile-reuse-mail.ts');
const { fetchEmailMarketingExcludedUserIds } = load('lib/marketing-email.ts');
const argument = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ''; };
const hash = crypto.createHash('sha256').update(mail.key).digest('hex').slice(0, 32);
const jobId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
function check(result, label) { if (result.error) throw Error(label + ':' + result.error.code); return result.data; }
async function main() {
  if (argument('--env-file')) process.loadEnvFile(argument('--env-file'));
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('DB_CONFIG_MISSING');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const existing = check(await db.from('admin_outreach_mail_jobs').select('id,status,total_count,processed_count,sent_count,failed_count')
    .eq('id', jobId).maybeSingle(), 'JOB_READ');
  if (existing) { console.log(JSON.stringify({ existing_job: existing })); return; }
  const consented = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = check(await db.from('email_marketing_consents').select('user_id').eq('consented', true).order('user_id').range(offset, offset + 999), 'CONSENTS');
    consented.push(...rows.map(row => row.user_id)); if (rows.length < 1000) break;
  }
  const ids = [...new Set(consented)], excluded = await fetchEmailMarketingExcludedUserIds(db, ids, mail.campaign);
  const candidates = new Set();
  for (let index = 0; index < ids.length; index += 100) {
    const part = ids.slice(index, index + 100);
    const [open, one] = await Promise.all([
      db.from('dating_cards').select('owner_user_id').in('owner_user_id', part).in('status', ['pending', 'public']),
      db.from('dating_1on1_cards').select('user_id').in('user_id', part),
    ]);
    const hasOne = new Set(check(one, 'ONE_QUERY').map(row => row.user_id));
    for (const row of check(open, 'OPEN_QUERY')) if (!hasOne.has(row.owner_user_id) && !excluded.has(row.owner_user_id)) candidates.add(row.owner_user_id);
  }
  const recipients = [], emails = new Set();
  for (const userId of candidates) {
    const auth = await db.auth.admin.getUserById(userId);
    if (auth.error) continue;
    const email = auth.data.user?.email?.trim().toLowerCase();
    if (!email || emails.has(email) || !await isOpenCardOnlyMailRecipient(db, userId, email)) continue;
    const recent = check(await db.from('admin_open_card_outreach_mail_logs').select('id').eq('user_id', userId).eq('success', true)
      .gte('sent_at', new Date(Date.now() - 24 * 3600000).toISOString()).limit(1), 'RECENT_MAIL');
    if (recent.length) continue;
    emails.add(email); recipients.push({ user_id: userId, email, reason: mail.key });
  }
  for (const copy of [mail.subject, mail.body]) {
    if (Buffer.from(copy, 'utf8').toString('utf8') !== copy || /\uFFFD|\u0000/.test(copy)) throw Error('INVALID_UTF8_COPY');
  }
  console.log(JSON.stringify({ mode: process.argv.includes('--queue') ? 'queue' : 'preview', job_id: jobId,
    consented_count: ids.length, eligible_count: recipients.length, subject: mail.subject, body: mail.body }));
  if (!process.argv.includes('--queue')) return;
  if (!/^[a-f0-9]{40}$/.test(argument('--deployment')) || argument('--expected-count') !== String(recipients.length) || !recipients.length) throw Error('EXACT_COUNT_AND_DEPLOYMENT_REQUIRED');
  // No upsert: a deterministic primary key makes repeated queue requests fail instead of sending twice.
  const inserted = await db.from('admin_outreach_mail_jobs').insert({ id: jobId, campaign_key: mail.campaign, status: 'queued',
    subject: mail.subject, body: mail.body, recipients, total_count: recipients.length, admin_user_id: null,
    filters: { campaign_release: mail.key, require_open_without_one_on_one: true, consent_required: true,
      scope: 'open_card_only', deployment_sha: argument('--deployment'), initiated_by: 'site_owner_request' },
  }).select('id,status,total_count').single();
  console.log(JSON.stringify({ queued_job: check(inserted, 'QUEUE_INSERT') }));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { jobId };
