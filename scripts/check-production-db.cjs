// No .env loading, secrets in output, migrations, or member-record queries.
const EXPECTED = [
  'dating_user_blocks', 'dating_1on1_candidate_hides', 'dating_user_reports', 'dating_1on1_match_proposals',
  'public.hide_dating_1on1_candidate(uuid,uuid,uuid)', 'public.restore_dating_1on1_candidate(uuid,uuid)', 'private_hides_writes',
  'block_pair_unique', 'hide_pair_unique',
];
function validateContract(body) {
  if (body?.version !== 1 || !Array.isArray(body.checks) || body.checks.length !== EXPECTED.length ||
    new Set(body.checks.map(row => row?.name)).size !== EXPECTED.length ||
    !EXPECTED.every(name => body.checks.some(row => row?.name === name && typeof row.ok === 'boolean'))) {
    throw Error('DB preflight response invalid. Install dating_release_contract.sql; no data was changed.');
  }
  const failed = body.checks.filter(row => !row.ok).map(row => row.name);
  if (body.ok !== true || failed.length) throw Error('DB preflight failed: ' + (failed.join(', ') || 'invalid summary') + '. Deployment stopped; no data was changed.');
}
async function run({ env = process.env, fetchImpl = fetch, force = false, log = console.log } = {}) {
  // Offline CI/local builds have no production credentials. Preview builds must
  // not acquire production secrets or contact the production database.
  if (!force && !(env.VERCEL === '1' && env.VERCEL_ENV === 'production')) {
    log('DB preflight skipped: non-production build (offline tests remain required).'); return;
  }
  let url;
  try { url = new URL(env.NEXT_PUBLIC_SUPABASE_URL); } catch { throw Error('DB preflight configuration missing.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || !env.SUPABASE_SERVICE_ROLE_KEY) throw Error('DB preflight configuration invalid.');
  const endpoint = new URL('/rest/v1/rpc/check_dating_release_contract', url);
  let response;
  try {
    response = await fetchImpl(endpoint, { method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(10000) });
  } catch { throw Error('DB preflight unavailable or timed out. Deployment stopped; retry after checking DB availability.'); }
  if (!response.ok) throw Error(`DB preflight HTTP ${response.status}. Check server credentials and dating_release_contract.sql. No data was changed.`);
  let body;
  try { body = await response.json(); } catch { throw Error('DB preflight response invalid.'); }
  validateContract(body);
  log(`DB preflight passed (${EXPECTED.length} catalog checks; no member data read or changed).`);
}
module.exports = { run, validateContract, EXPECTED };
if (require.main === module) run({ force: process.argv.includes('--required') }).catch(error => { console.error(error.message); process.exitCode = 1; });
