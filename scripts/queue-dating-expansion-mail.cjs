/* eslint-disable @typescript-eslint/no-require-imports */
// Preview by default. The existing production worker signs opt-out links and sends one recipient per email.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ts = require('typescript'), { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '..');
function load(name) {
  if (!name.startsWith('@/')) return require(name);
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(root, name.slice(2) + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', js)(load, mod, mod.exports);
  return mod.exports;
}
const { EXPANSION_MAIL: mail, isExpansionMailRecipient } = load('@/lib/dating-expansion-mail');
const { fetchEmailMarketingExcludedUserIds } = load('@/lib/marketing-email');
const argument = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ''; };
const hash = crypto.createHash('sha256').update(mail.key).digest('hex').slice(0, 32);
const jobId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
function check(result, label) { if (result.error) throw Error(label + ':' + result.error.code); return result.data; }
async function verifyDeployment(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw Error('EXACT_DEPLOYMENT_REQUIRED');
  const read = async url => {
    const response = await fetch(url, { headers: { 'User-Agent': 'GymTools-notice-release-check' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error('DEPLOYMENT_CHECK_FAILED');
    return response.json();
  };
  const deployments = await read(`https://api.github.com/repos/DDULSONN/health/deployments?sha=${sha}&per_page=10`);
  const production = deployments.find(item => item.sha === sha && item.environment === 'Production');
  if (!production || new URL(production.statuses_url).origin !== 'https://api.github.com') throw Error('PRODUCTION_DEPLOYMENT_MISSING');
  const states = await read(production.statuses_url);
  if (states[0]?.state !== 'success') throw Error('PRODUCTION_DEPLOYMENT_NOT_SUCCESSFUL');
}
async function main() {
  if (argument('--env-dir')) require('@next/env').loadEnvConfig(argument('--env-dir'), false, { info(){}, error(){} });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('DB_CONFIG_MISSING');
  const queue = process.argv.includes('--queue');
  const dbOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin;
  const db = createClient(dbOrigin, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => {
      const target = new URL(url), method = init?.method || 'GET';
      if (target.origin !== dbOrigin || (!['GET', 'HEAD'].includes(method) &&
        !(queue && method === 'POST' && target.pathname === '/rest/v1/admin_outreach_mail_jobs'))) throw Error('UNAUTHORIZED_MUTATION');
      return fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
    } },
  });
  const existing = check(await db.from('admin_outreach_mail_jobs').select('id,status,total_count,processed_count,sent_count,failed_count,failure_summary')
    .eq('id', jobId).maybeSingle(), 'JOB_READ');
  if (existing || process.argv.includes('--status')) { console.log(JSON.stringify({ existing_job: existing })); return; }
  const consented = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = check(await db.from('email_marketing_consents').select('user_id').eq('consented', true).order('user_id').range(offset, offset + 999), 'CONSENTS');
    consented.push(...rows.map(row => row.user_id)); if (rows.length < 1000) break;
  }
  const ids = [...new Set(consented)], excluded = await fetchEmailMarketingExcludedUserIds(db, ids, mail.campaign);
  const candidates = new Set();
  for (let index = 0; index < ids.length; index += 100) {
    const rows = check(await db.from('dating_1on1_cards').select('user_id').in('user_id', ids.slice(index, index + 100))
      .in('status', ['submitted', 'reviewing', 'approved']), 'ONE_QUERY');
    for (const row of rows) if (!excluded.has(row.user_id)) candidates.add(row.user_id);
  }
  const recipients = [], emails = new Set();
  for (const userId of [...candidates].sort()) {
    const auth = await db.auth.admin.getUserById(userId);
    if (auth.error?.status === 404) continue;
    if (auth.error) throw Error('AUTH_READ_FAILED');
    const email = auth.data.user?.email?.trim().toLowerCase();
    if (!email || emails.has(email) || !await isExpansionMailRecipient(db, userId, email)) continue;
    const recent = check(await db.from('admin_open_card_outreach_mail_logs').select('id').eq('user_id', userId).eq('success', true)
      .gte('sent_at', new Date(Date.now() - 24 * 3600000).toISOString()).limit(1), 'RECENT_MAIL');
    if (recent.length) continue;
    emails.add(email); recipients.push({ user_id: userId, email, reason: mail.key });
  }
  for (const copy of [mail.subject, mail.body]) {
    if (Buffer.from(copy, 'utf8').toString('utf8') !== copy || /\uFFFD|\u0000/.test(copy)) throw Error('INVALID_UTF8_COPY');
  }
  console.log(JSON.stringify({ mode: queue ? 'queue' : 'preview', job_id: jobId,
    consented_count: ids.length, eligible_count: recipients.length, subject: mail.subject, body: mail.body }));
  if (!queue) return;
  if (argument('--expected-count') !== String(recipients.length) || !recipients.length) throw Error('EXACT_POSITIVE_COUNT_REQUIRED');
  await verifyDeployment(argument('--deployment'));
  // No upsert: repeated/concurrent launches share the same primary key and cannot create a second job.
  const inserted = await db.from('admin_outreach_mail_jobs').insert({ id: jobId, campaign_key: mail.campaign, status: 'queued',
    subject: mail.subject, body: mail.body, recipients, total_count: recipients.length, admin_user_id: null,
    filters: { campaign_release: mail.key, require_expansion_eligible: true, consent_required: true,
      deployment_sha: argument('--deployment'), initiated_by: 'site_owner_request' },
  }).select('id,status,total_count').single();
  console.log(JSON.stringify({ queued_job: check(inserted, 'QUEUE_INSERT') }));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { jobId, verifyDeployment };
