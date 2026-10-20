/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only: replay real eligible pools locally. Never invoke production RPCs.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.env.AUDIT_ENV_DIR || path.resolve(__dirname, '..'), false, { info() {}, error() {} });
const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin;
const readCache = new Map();
const db = require('@supabase/supabase-js').createClient(origin, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (url, init) => {
    assert.equal(new URL(url).origin, origin);
    assert.ok(['GET', 'HEAD'].includes(init?.method || 'GET'), 'audit forbids writes');
    assert.ok(!new URL(url).pathname.includes('/rpc/'), 'audit forbids RPCs');
    const key = String(url);
    if (!readCache.has(key)) readCache.set(key, fetch(url, { ...init, signal: AbortSignal.timeout(20000) }).then(async r =>
      ({ status: r.status, body: await r.text(), headers: r.headers })));
    const r = await readCache.get(key); return new Response(r.body, { status: r.status, headers: r.headers });
  } },
});
const ok = r => { if (r.error) throw Error(r.error.code + ': ' + r.error.message); return r.data; };
async function auditUser(userId) {
  let captured;
  const modules = new Map();
  function load(name) {
    if (name === 'server-only') return {};
    if (name === '@/lib/images') return { buildSignedImageUrl: () => '', extractStorageObjectPathFromBuckets: () => null };
    if (!name.startsWith('@/')) return require(name);
    if (modules.has(name)) return modules.get(name).exports;
    const mod = { exports: {} }; modules.set(name, mod);
    new Function('require', 'module', 'exports', ts.transpileModule(
      fs.readFileSync(path.join(__dirname, '..', name.slice(2) + '.ts'), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)(load, mod, mod.exports);
    if (name === '@/lib/dating-1on1-recommendation-page') {
      const fn = mod.exports.nextRecommendationPage;
      mod.exports.nextRecommendationPage = (...args) => { captured = args; return fn(...args); };
    }
    if (name === '@/lib/dating-1on1-recommendation-data') {
      mod.exports.fetchRecommendationDetails = async (admin, ids) => {
        const data = ok(await admin.from('dating_1on1_cards').select('id,user_id,sex,birth_year,region,status,created_at')
          .in('id', [...new Set(ids)]).in('status', ['submitted', 'reviewing', 'approved']));
        return new Map(data.map(c => [c.id, c]));
      };
    }
    return mod.exports;
  }
  const source = ok(await db.from('dating_1on1_cards').select('id')
    .eq('user_id', userId).in('status', ['submitted', 'reviewing', 'approved']).order('created_at', { ascending: false }).limit(1))[0];
  if (!source) return { eligible: false };
  const at = Date.now();
  const response = await load('@/lib/dating-1on1-recommendation-service').loadOneOnOneRecommendations(db,
    { id: userId }, { sourceCardId: source.id, at: new Date(at).toISOString() });
  const body = await response.json();
  if (!response.ok || !captured) return { eligible: false, status: response.status };
  const pages = load('@/lib/dating-1on1-recommendation-page');
  const rules = load('@/lib/dating-1on1-recommendations');
  const distance = load('@/lib/region-distance').getRegionDistanceMeta;
  const [src, pool, previous, , , originalContext, replayed] = captured;
  const ids = p => [...p.recommendations, ...p.extraRecommendations].map(c => c.id);
  const simulate = improved => {
    const context = { ...originalContext, observations: originalContext.observations.map(r => ({ ...r })),
      recentPages: improved ? [...(originalContext.recentPages || [])] : undefined };
    let prior = previous;
    const ever = new Set(ids(previous)), steps = [], previousPages = [ids(previous)];
    for (let i = 0; i < 30; i++) {
      const time = at + i * 60000;
      const next = pages.nextRecommendationPage(src, pool, prior, new Date(time).toISOString(), time, context, replayed);
      const nextIds = ids(next), prevIds = ids(prior);
      const overlap = arr => nextIds.filter(id => arr.includes(id)).length;
      nextIds.forEach(id => ever.add(id));
      steps.push({ main: next.recommendations.length, extra: next.extraRecommendations.length,
        immediateOverlap: overlap(prevIds), twoPagesAgoOverlap: i ? overlap(previousPages.at(-2)) : 0,
        covered: ever.size, ageMatch: next.recommendations.filter(c => rules.isCandidateInSourceAgeRange(src, c)).length,
        near90: next.recommendations.filter(c => { const km = distance(src.region, c.region).distanceKm; return km != null && km <= 90; }).length,
      });
      if (improved) {
        if (!i) context.recentPages.push({ at: time - 1, ids: prevIds });
        context.recentPages.push({ at: time, ids: nextIds });
      }
      for (const id of nextIds) if (!context.observations.some(r => r.id === id)) context.observations.push({ id, at: time + 1 });
      previousPages.push(nextIds); prior = next;
    }
    return { first: steps[0], covered12: steps[11].covered, covered30: steps[29].covered,
      worstImmediate: Math.max(...steps.map(s => s.immediateOverlap)),
      worstTwoAgo: Math.max(...steps.map(s => s.twoPagesAgoOverlap)),
      minAgeMatch: Math.min(...steps.map(s => s.ageMatch)), minNear90: Math.min(...steps.map(s => s.near90)),
      ...(process.env.AUDIT_DETAILS === '1' ? { steps, ages: Object.fromEntries(
        [...new Set(pool.map(c => c.age))].sort((a,b) => a-b).map(age => [age, pool.filter(c => c.age === age).length])),
        sourceAge: src.age, sourceSex: src.sex } : {}) };
  };
  const before = simulate(false), after = simulate(true);
  return { eligible: true, pool: pool.length, before, after, productionWrites: 0,
    availability: { remaining: body.plan?.refresh_remaining, bonusRemaining: body.plan?.refresh_bonus_remaining } };
}
module.exports = { auditUser, db, ok, readCache };
if (require.main === module) {
  assert.ok(process.env.AUDIT_USER_ID, 'AUDIT_USER_ID required');
  auditUser(process.env.AUDIT_USER_ID).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e.message); process.exitCode = 1; });
}
