/* eslint-disable @typescript-eslint/no-require-imports */
// Bounded, read-only production replay across demographic/region cohorts.
// Never sends refresh POSTs, mutates records, downloads photos, or logs contacts.
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const ageRules = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'lib/dating-age.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(ageRules);
require('@next/env').loadEnvConfig(process.env.AUDIT_ENV_DIR || root, false, { info() {}, error() {} });
const nativeFetch = global.fetch;
const db = require('@supabase/supabase-js').createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, init) => {
    if (!['GET', 'HEAD'].includes(init?.method || 'GET')) throw new Error('Audit prohibits writes');
    return nativeFetch(url, init);
  } },
});
function regionGroup(region) {
  if (/서울|경기|인천/.test(region)) return 'capital';
  if (/충청|충남|충북|대전|세종/.test(region)) return 'chungcheong';
  if (/부산|대구|울산|경상|경남|경북/.test(region)) return 'yeongnam';
  if (/전라|전남|전북|광주/.test(region)) return 'honam';
  if (/강원|제주/.test(region)) return 'gangwon-jeju';
  return 'unknown';
}
(async () => {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('dating_1on1_cards')
      .select('id,user_id,sex,birth_year,region,created_at,recommendation_refresh_used_at')
      .in('status', ['submitted', 'reviewing', 'approved'])
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 499);
    if (error) throw new Error(`Cohort scan failed: ${error.code}`);
    rows.push(...data);
    if (data.length < 500) break;
    if (offset >= 19500) throw new Error('Cohort scan exceeds bounded audit limit');
  }
  const latestByUser = new Map();
  for (const row of rows) if (!latestByUser.has(row.user_id)) latestByUser.set(row.user_id, row);
  const groups = new Map();
  const currentYear = new Date().getFullYear();
  for (const row of latestByUser.values()) {
    const area = regionGroup(row.region);
    if (area === 'unknown') continue;
    const age = currentYear - row.birth_year + 1;
    const key = `${row.sex}/${area}${area === 'capital' ? age < 30 ? '/under30' : '/30plus' : ''}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const results = [];
  for (const [cohort, members] of groups) {
    if (process.env.AUDIT_COHORT && cohort !== process.env.AUDIT_COHORT) continue;
    const { data: profiles, error } = await db.from('profiles').select('user_id,is_banned')
      .in('user_id', members.map(row => row.user_id));
    if (error) throw new Error('Audit source eligibility lookup failed');
    const allowed = new Set(profiles.filter(row => !row.is_banned).map(row => row.user_id));
    const eligible = members.filter(row => allowed.has(row.user_id) && ageRules.parseDatingBirthYear(row.birth_year) != null);
    if (!eligible.length) {
      const result = { cohort, cohortSize: members.length, skipped: true, reason: 'no eligible source' };
      results.push(result); console.log(JSON.stringify(result)); continue;
    }
    // Prefer a member who has used refresh, not just a brand-new account.
    eligible.sort((a, b) => Date.parse(b.recommendation_refresh_used_at || '1970-01-01') - Date.parse(a.recommendation_refresh_used_at || '1970-01-01'));
    const member = eligible[Number(process.env.AUDIT_MEMBER_OFFSET) || 0];
    if (!member) throw new Error('Invalid audit member offset');
    const proc = spawnSync(process.execPath, [path.join(__dirname, 'audit-recommendation-quality.cjs')], {
      cwd: root, env: { ...process.env, AUDIT_USER_ID: member.user_id }, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
    });
    if (proc.status !== 0) {
      // Deliberately do not print service errors with query values/user details.
      const result = { cohort, cohortSize: members.length, auditFailed: true,
        reason: proc.stderr.includes('Account is not eligible for recommendations') ? 'banned or withdrawn source' :
          proc.stderr.includes('DATING_AGE_INELIGIBLE') ? 'age-ineligible source' :
          proc.stderr.includes('Audit failed: 200 {"items":[]}') ? 'no eligible active source' : 'read-only audit failed',
        status: Number(proc.stderr.match(/Audit failed: (\d+)/)?.[1]) || null };
      results.push(result); console.log(JSON.stringify(result)); continue;
    }
    const output = proc.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    const report = output.find(item => item.pool);
    const next = output.find(item => item.simulatedNextRefresh)?.simulatedNextRefresh;
    const result = { cohort, cohortSize: members.length, pool: report.pool, main: report.main,
      extra: report.extra, next: next ? { count: next.count, overlap: next.overlap, nearAndAge: next.nearAndAge, extra:next.extra } : null };
    results.push(result); console.log(JSON.stringify(result));
  }
  console.log(JSON.stringify({ cohorts: results.length, successful: results.filter(r => !r.auditFailed && !r.skipped).length,
    skipped: results.filter(r => r.skipped).length,
    enoughNearbyButRemote: results.filter(r => r.pool?.nearAndAge >= 10 && r.main.nearAndAge < 10).length,
    enoughNearbyNextButRemote: results.filter(r => r.pool?.nearAndAge >= 10 && r.next?.nearAndAge < 10).length,
    unchangedWholePage: results.filter(r => r.next && r.main.count === 10 && r.next.overlap === 10).length,
  }));
  if (results.some(r => r.auditFailed || (r.pool?.nearAndAge >= 10 && (r.main.nearAndAge < 10 || r.next?.nearAndAge < 10)))) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
