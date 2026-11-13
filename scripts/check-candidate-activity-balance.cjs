/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), cache = new Map();
function load(name) {
  if (name === '@/lib/region-distance') return { getRegionDistanceMeta: (_source, region) => ({ distanceKm: region === 'unknown' ? null : Number(region) }) };
  if (!name.startsWith('@/')) return require(name);
  if (cache.has(name)) return cache.get(name).exports;
  const m = { exports: {} }; cache.set(name, m);
  new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(path.join(root, name.slice(2)+'.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(load, m, m.exports); return m.exports;
}
const { nextRecommendationPage, restoreRecommendationPage } = load('@/lib/dating-1on1-recommendation-page');
const { getOneOnOneCandidateAvailability: availability, getOneOnOneCandidateAvailabilityCopy: copy } = load('@/lib/dating-1on1-candidate-availability');
const refreshCopy = load('@/lib/dating-1on1-refresh-copy');
const at = Date.parse('2026-11-14T01:00:00Z'), day = 86400000;
const card = (id, extra = {}) => ({ id, age: 28, sex: 'female', region: '30', created_at: '2026-01-01T00:00:00Z', ...extra });
const source = card('source', { sex: 'male', age: 30 });
const all = page => [...page.recommendations, ...page.extraRecommendations];
const previousCards = Array.from({ length: 13 }, (_, i) => card('previous'+i));
const previous = { recommendations: previousCards.slice(0, 10), extraRecommendations: previousCards.slice(10) };
const makeContext = seen => ({ limit:10, extraLimit:3, handled:new Set(), extraExcluded:new Set(),
  observations: seen.map(c => ({ id:c.id, at:at-8*day })), recentPages:[] });
const plan = (pool, ctx, prior = previous, time = at) => nextRecommendationPage(source, pool, prior, new Date(time).toISOString(), time, ctx);

test('recent compatible regional revisits get six slots; unseen profiles still get four', () => {
  const active = Array.from({ length:30 }, (_,i) => card('active'+i, { last_active_at:new Date(at-day).toISOString() }));
  const unseen = Array.from({ length:40 }, (_,i) => card('unseen'+i));
  const pool = [...previousCards,...active,...unseen], ctx = makeContext([...previousCards,...active]);
  const next = plan(pool,ctx);
  assert.equal(next.recommendations.filter(c=>c.id.startsWith('active')).length,6);
  assert.equal(next.recommendations.filter(c=>c.id.startsWith('unseen')).length,4);
  assert.equal(all(next).filter(c=>c.id.startsWith('previous')).length,0);
  assert.deepEqual(plan(pool,ctx),next);
  const restored=restoreRecommendationPage(source,pool,{refreshed_at:new Date(at).toISOString(),main_candidate_ids:next.recommendations.map(c=>c.id),extra_candidate_ids:next.extraRecommendations.map(c=>c.id)},at+1,ctx);
  assert.deepEqual(restored,next,'GET must not rerank the saved page');
});

for (const bad of [{region:'400'},{region:'unknown'},{age:40},{last_active_at:new Date(at+day).toISOString()}, {last_active_at:'invalid'}, {last_active_at:new Date(at-31*day).toISOString()}]) {
  test('activity never overrides fit or trusts invalid/old activity: '+JSON.stringify(bad),()=>{
    const active=Array.from({length:30},(_,i)=>card('wrong'+i,{last_active_at:new Date(at-day).toISOString(),...bad}));
    const unseen=Array.from({length:40},(_,i)=>card('unseen'+i));
    const next=plan([...previousCards,...active,...unseen],makeContext([...previousCards,...active]));
    assert.ok(next.recommendations.every(c=>c.id.startsWith('unseen')));
  });
}

test('recent cancelled/skipped candidates do not jump ahead via the activity reservation',()=>{
  const handled=Array.from({length:30},(_,i)=>card('handled'+i,{last_active_at:new Date(at-day).toISOString(),last_handled_at:new Date(at-1000).toISOString()}));
  const unseen=Array.from({length:40},(_,i)=>card('unseen'+i));
  const ctx=makeContext([...previousCards,...handled]);ctx.handled=new Set(handled.map(c=>c.id));
  assert.ok(plan([...previousCards,...handled,...unseen],ctx).recommendations.every(c=>c.id.startsWith('unseen')));
});

for(const sex of ['male','female'])test('20 refreshes keep variety and age/region compatibility: '+sex,()=>{
  const sourceForSex={...source,sex},target=sex==='male'?'female':'male';
  const pool=Array.from({length:130},(_,i)=>card('person'+i,{age:30,sex:target,region:String([20,45,70,85][i%4]),last_active_at:i<65?new Date(at-day).toISOString():null}));
  const ctx=makeContext(pool);let prior={recommendations:pool.slice(0,10),extraRecommendations:pool.slice(10,13)};
  const seen=new Set(),pages=[];
  for(let i=0;i<20;i++){
    const time=at+i*60000;
    const next=nextRecommendationPage(sourceForSex,pool,prior,new Date(time).toISOString(),time,ctx);
    const ids=all(next).map(c=>c.id);
    assert.equal(ids.length,13);assert.equal(new Set(ids).size,13);
    assert.equal(ids.filter(id=>all(prior).some(c=>c.id===id)).length,0);
    if(i>=2)assert.equal(ids.filter(id=>pages[i-2].includes(id)).length,0,'no A/B loop');
    for(const id of ids)seen.add(id);
    ctx.recentPages.push({at:time-1,ids:all(prior).map(c=>c.id)},{at:time,ids});pages.push(ids);prior=next;
  }
  assert.ok(seen.size>=100,'activity reservation cannot trap the same small subset');
});

test('scarcity metadata is presentation-only and accurately distinguishes empty/few/full',()=>{
  for(const eligibleCount of [0,1,6,9]){
    const hint=availability({eligibleCount,hiddenCount:20,excludedByHistoryCount:30,favoriteCount:1});
    assert.equal(hint.candidate_count,eligibleCount);assert.equal(hint.state,eligibleCount?'limited':'empty');
    assert.match(copy(hint).detail,/이미 요청/);assert.match(copy(hint).hidden,/숨김을 해제/);assert.match(copy(hint).favorites,/찜한/);
  }
  for(const eligibleCount of [-1,NaN,1.5,10,100])assert.equal(availability({eligibleCount,hiddenCount:0,excludedByHistoryCount:0,favoriteCount:0}),null);
  const hint=availability({eligibleCount:0,hiddenCount:0,excludedByHistoryCount:0,favoriteCount:0});
  assert.equal(copy(hint).hidden,null);assert.match(copy(hint).detail,/새로 등록/);
  assert.equal(copy({...hint,candidate_count:4}),null);assert.equal(copy(null),null);
});

test('scarce pools do not upsell refreshes or show unused-refresh pressure; allowance remains unchanged',()=>{
  const usage={source_card_id:'source',source_card_status:'approved',can_refresh:true,refresh_remaining:2,refresh_limit:2,refresh_bonus_remaining:1,
    refresh_used_count:0,refresh_used_at:null,candidate_pool_count:4,recommendation_availability:availability({eligibleCount:4,hiddenCount:3,excludedByHistoryCount:2,favoriteCount:0})};
  const snapshot=JSON.stringify(usage);
  assert.equal(refreshCopy.shouldShowOneOnOneRefreshReminder(usage,at),false);
  assert.equal(refreshCopy.shouldOfferOneOnOnePlus({...usage,can_refresh:false,refresh_remaining:0,refresh_limit:1,refresh_bonus_remaining:0},false),false);
  assert.equal(refreshCopy.getOneOnOneRefreshCopy(usage).button,'후보 새로고침 · 2회');
  assert.equal(JSON.stringify(usage),snapshot);
});

test('both screens place the existing restore control before candidates and keep read-only reload callbacks',()=>{
  const home=fs.readFileSync(path.join(root,'components/dating/OneOnOneHomePanel.tsx'),'utf8');
  const my=fs.readFileSync(path.join(root,'app/mypage/page.tsx'),'utf8');
  for(const text of [home,my])assert.equal((text.match(/<CandidateHidesPanel /g)||[]).length,1);
  assert.ok(home.indexOf('<CandidateHidesPanel')<home.indexOf('{recommendations.map('));
  assert.match(home,/availability=\{group.recommendation_availability\}/);
  assert.match(my,/availability=\{autoRecommendationGroup\?\.recommendation_availability\}/);
  assert.match(my,/onRestored=\{\(\) => reloadOneOnOneRecommendations\(true, true\)\}/);
});
