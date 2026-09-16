/* eslint-disable @typescript-eslint/no-require-imports */
// Targeted read-only replay. Never consumes refreshes or loads names/photos/contact output.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require('@next/env').loadEnvConfig(process.env.AUDIT_ENV_DIR || root, false, { info() {}, error() {} });
const userId = process.env.AUDIT_USER_ID;
if (!userId) throw new Error('AUDIT_USER_ID is required');
const nativeFetch = global.fetch;
const cache = new Map();
const db = require('@supabase/supabase-js').createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (url, init) => {
    if (!['GET', 'HEAD'].includes(init?.method || 'GET')) throw new Error('Audit prohibits writes');
    const key = String(url);
    if (!cache.has(key)) cache.set(key, nativeFetch(url, init).then(async r => ({ body: await r.text(), status: r.status, headers: r.headers })));
    const r = await cache.get(key); return new Response(r.body, { status: r.status, headers: r.headers });
  } },
});
let captured, replayArgs, defaultArgs;
const modules = new Map();
function load(name) {
  if (name === 'server-only') return {};
  if (name === '@/lib/supabase/server') return { createAdminClient: () => db };
  if (name === '@/lib/supabase/request') return { getRequestAuthContext: async () => ({ user: { id: userId } }) };
  if (name === '@/lib/images') return { buildSignedImageUrl: () => '', extractStorageObjectPathFromBuckets: () => null };
  if (!name.startsWith('@/')) return require(name);
  if (modules.has(name)) return modules.get(name).exports;
  const mod = { exports: {} }; modules.set(name, mod);
  const src = fs.readFileSync(path.join(root, name.slice(2) + '.ts'), 'utf8');
  new Function('require', 'module', 'exports', ts.transpileModule(src, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText)(load, mod, mod.exports);
  if (name === '@/lib/dating-1on1-recommendations') {
    const sort = mod.exports.sortCandidatesForSource;
    mod.exports.sortCandidatesForSource = (source, pool, seed, now) => {
      if (seed.endsWith(':default')) captured = { source, pool, now, seed };
      return sort(source, pool, seed, now);
    };
    const replay = mod.exports.replayRecommendationRefreshes;
    mod.exports.replayRecommendationRefreshes = (...args) => { replayArgs = args; return replay(...args); };
    const balanced = mod.exports.takeBalancedRecommendations;
    mod.exports.takeBalancedRecommendations = (...args) => {
      if (args[2] === 10) defaultArgs = args;
      return balanced(...args);
    };
  }
  if (name === '@/lib/dating-1on1-recommendation-data') {
    mod.exports.fetchRecommendationDetails = async (_, ids) => new Map(captured.pool.filter(c => ids.includes(c.id)).map(c => [c.id, c]));
  }
  return mod.exports;
}
(async () => {
  const res = await load('@/app/api/dating/1on1/recommendations/my/route').GET(new Request('https://example.test/'));
  const body = await res.json();
  if (res.status !== 200 || !captured) throw new Error('Audit failed: ' + res.status + ' ' + JSON.stringify(body));
  const rules = load('@/lib/dating-1on1-recommendations');
  const { getRegionDistanceMeta } = load('@/lib/region-distance');
  const { source, pool, now } = captured;
  const group = body.items.find(row => row.source_card_id === source.id);
  const summarize = rows => ({
    count: rows.length,
    within90km: rows.filter(c => { const d = getRegionDistanceMeta(source.region, c.region).distanceKm; return d != null && d <= 90; }).length,
    ageMatch: rows.filter(c => rules.isCandidateInSourceAgeRange(source, c)).length,
    nearAndAge: rows.filter(c => { const d = getRegionDistanceMeta(source.region, c.region).distanceKm; return d != null && d <= 90 && rules.isCandidateInSourceAgeRange(source,c); }).length,
    createdLast7d: rows.filter(c => Date.parse(c.created_at) >= now - 7*86400000).length,
  });
  const items = rows => rows.map(c => ({ card: c.id.slice(0,8), age: c.age, region: c.region, distance: Math.round(getRegionDistanceMeta(source.region,c.region).distanceKm ?? -1), created: c.created_at.slice(0,10) }));
  console.log(JSON.stringify({ source: { card: source.id.slice(0,8), age: source.age, region: source.region }, pool: summarize(pool), main: summarize(group.recommendations), extra: summarize(group.admin_recommendations), mainItems: items(group.recommendations), extraItems: items(group.admin_recommendations), refresh: { last: group.refresh_used_at, used: group.refresh_used_count, remaining: group.refresh_remaining, history: replayArgs?.[3] ?? [] }, queries: cache.size }));
  if (defaultArgs) {
    const replay = modules.get('@/lib/dating-1on1-recommendations').exports.replayRecommendationRefreshes;
    const args = replayArgs ?? [source, pool, group.recommendations, [], defaultArgs[3], 10, now];
    const a = group.recommendations;
    const b = replay(args[0],args[1],args[2],[...args[3],new Date(now).toISOString()],args[4],args[5],now).recommendations;
    console.log(JSON.stringify({ simulatedNextRefresh: { overlap: a.filter(c=>b.some(x=>x.id===c.id)).length, ...summarize(b), items: items(b) } }));
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
