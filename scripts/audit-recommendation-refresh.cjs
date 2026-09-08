/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only operational replay. No messages, auth changes, refresh consumption or photos.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require('@next/env').loadEnvConfig(process.env.AUDIT_ENV_DIR || root);
const nativeFetch = global.fetch;
const cache = new Map();
const db = require('@supabase/supabase-js').createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (url, init) => {
    if (!['GET', 'HEAD'].includes(init?.method || 'GET')) throw new Error('Audit prohibits writes');
    const key = String(url);
    if (!cache.has(key)) cache.set(key, nativeFetch(url, init).then(async (r) => ({ body: await r.text(), status: r.status, headers: r.headers })));
    const r = await cache.get(key); return new Response(r.body, { status: r.status, headers: r.headers });
  } },
});
let viewer, captured;
const modules = new Map();
function load(name) {
  if (name === 'server-only') return {};
  if (name === '@/lib/supabase/server') return { createAdminClient: () => db };
  if (name === '@/lib/supabase/request') return { getRequestAuthContext: async () => ({ user: { id: viewer } }) };
  if (name === '@/lib/images') return { buildSignedImageUrl: () => '', extractStorageObjectPathFromBuckets: () => null };
  if (!name.startsWith('@/')) return require(name);
  if (modules.has(name)) return modules.get(name).exports;
  const mod = { exports: {} }; modules.set(name, mod);
  const source = fs.readFileSync(path.join(root, name.slice(2) + '.ts'), 'utf8');
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText)(load, mod, mod.exports);
  if (name === '@/lib/dating-1on1-recommendations') {
    const original = mod.exports.sortCandidatesForSource;
    mod.exports.sortCandidatesForSource = (source, pool, seed, now) => {
      if (seed.endsWith(':default')) captured = { source, pool, now };
      return original(source, pool, seed, now);
    };
  }
  if (name === '@/lib/dating-1on1-recommendation-data') {
    mod.exports.fetchRecommendationDetails = async (_, ids) => new Map(captured.pool.filter(c => ids.includes(c.id)).map(c => [c.id, c]));
  }
  return mod.exports;
}
(async () => {
  const events = [];
  for (let from = 0; from < 5000; from += 500) {
    const r = await db.from('dating_1on1_recommendation_refresh_events').select('id,card_id,user_id,refreshed_at')
      .gte('refreshed_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .order('refreshed_at', { ascending: false }).order('id', { ascending: false }).range(from, from + 499);
    if (r.error) throw r.error;
    events.push(...r.data); if (r.data.length < 500) break;
  }
  const grouped = new Map();
  for (const event of events) { const rows = grouped.get(event.card_id) || []; rows.push(event); grouped.set(event.card_id, rows); }
  const samples = [...grouped.values()].filter(rows => rows.length >= 2 &&
    (!process.env.AUDIT_CARD_ID || rows[0].card_id === process.env.AUDIT_CARD_ID)).slice(0, Number(process.env.AUDIT_LIMIT || 20));
  console.log(JSON.stringify({ events: events.length, refreshedCards: grouped.size, repeatedCards: [...grouped.values()].filter(r=>r.length>=2).length, sampled: samples.length }));
  const route = load('@/app/api/dating/1on1/recommendations/my/route');
  const rules = load('@/lib/dating-1on1-recommendations');
  for (const rows of samples) {
    viewer = rows[0].user_id; captured = null;
    const response = await route.GET(new Request('https://example.test/'));
    const data = await response.json();
    if (!captured || !data.items?.length) { console.log(JSON.stringify({ card: rows[0].card_id.slice(0,8), skippedStatus: response.status })); continue; }
    const { source, pool, now } = captured;
    const defaults = rules.takeBalancedRecommendations(source, rules.sortCandidatesForSource(source,pool,'audit:default',now),10,new Set(),now);
    const replay = (stamp) => {
      const excluded = rules.getRefreshExcludeIds(source,defaults,stamp);
      return rules.takeBalancedRecommendations(source,rules.sortRefreshCandidatesForSource(source,pool,stamp,excluded,now),10,excluded,now);
    };
    const before = replay(rows[1].refreshed_at), after = replay(rows[0].refreshed_at);
    const overlap = after.filter(c=>before.some(old=>old.id===c.id)).length;
    const history = rows.map(r=>r.refreshed_at);
    const improvedBefore = rules.replayRecommendationRefreshes(source,pool,defaults,history.slice(1),new Set(),10,now).recommendations;
    const improvedAfter = rules.replayRecommendationRefreshes(source,pool,defaults,history,new Set(),10,now).recommendations;
    const improvedOverlap = improvedAfter.filter(c=>improvedBefore.some(old=>old.id===c.id)).length;
    const group = data.items.find(item=>item.source_card_id===source.id);
    const current = group?.recommendations || [];
    const currentVsOldOverlap = current.filter(c=>after.some(old=>old.id===c.id)).length;
    const nameRes = await db.from('dating_1on1_cards').select('name').eq('id',source.id).maybeSingle();
    console.log(JSON.stringify({ name: nameRes.data?.name, card: source.id.slice(0,8), sex:source.sex, pool:pool.length, overlap, improvedOverlap, currentVsOldOverlap, currentShown:current.length, recoveryApplied:group?.recovery_refresh_applied, refreshUsed:group?.refresh_used_count, refreshRemaining:group?.refresh_remaining, shown:after.length, hoursBetween:Math.round((Date.parse(rows[0].refreshed_at)-Date.parse(rows[1].refreshed_at))/3600000), latest:rows[0].refreshed_at }));
  }
})().catch(e=>{console.error(e.message);process.exitCode=1});
