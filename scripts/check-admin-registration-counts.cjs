/* eslint-disable @typescript-eslint/no-require-imports */
// Exercises the real admin handler and React renderer; no network or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const fixedNow = Date.parse('2026-10-14T13:00:00Z');
const transpile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const moduleAt = (file, resolve = require) => {
  const m = { exports: {} };
  new Function('require', 'module', 'exports', transpile(fs.readFileSync(path.join(root, file), 'utf8')))(resolve, m, m.exports);
  return m.exports;
};
const helpers = moduleAt('lib/admin-registration-counts.ts');
const realModules = new Map();
function realModule(name) {
  if (!name.startsWith('@/')) return require(name);
  if (!realModules.has(name)) realModules.set(name, moduleAt(`${name.slice(2)}.ts`, realModule));
  return realModules.get(name);
}
const activeHelpers = realModule('@/lib/admin-active-one-on-one-counts');

function loadApi(data = {}, { status = 200, errorTable, errorFields, now = fixedNow, advanceClock = false } = {}) {
  const calls = []; let clockCalls = 0;
  const admin = { from(table) {
    const query = { table, filters: [], ordering: [], start: 0, end: 999, options: {} };
    const b = {
      select(fields, options = {}) { query.fields = fields; query.options = options; return b; },
      eq(k,v) { query.filters.push(['eq',k,v]); return b; },
      neq(k,v) { query.filters.push(['neq',k,v]); return b; },
      gte(k,v) { query.filters.push(['gte',k,v]); return b; },
      gt(k,v) { query.filters.push(['gt',k,v]); return b; },
      lt(k,v) { query.filters.push(['lt',k,v]); return b; },
      in(k,v) { query.filters.push(['in',k,v]); return b; },
      order(k,o) { query.ordering.push([k,o.ascending]); return b; },
      range(s,e) { query.start=s;query.end=e;return b; },
      limit(n) { query.end=query.start+n-1;return b; },
      then(resolve,reject) { return Promise.resolve().then(() => {
        calls.push(query);
        if(table===errorTable || query.fields===errorFields) return {data:null,error:{code:'XX000',message:'test read failure'}};
        let rows=[...(data[table]||[])];
        for(const [op,k,v] of query.filters) rows=rows.filter(r=>op==='eq'?r[k]===v:op==='neq'?r[k]!==v:op==='in'?v.includes(r[k]):r[k]!=null&&(op==='gte'?r[k]>=v:op==='gt'?r[k]>v:r[k]<v));
        rows.sort((a,b)=>{for(const [k,asc] of query.ordering) if(a[k]!==b[k]) return (a[k]<b[k]?-1:1)*(asc?1:-1);return 0;});
        const count=rows.length;
        const selected=rows.slice(query.start,query.end+1).map(r=>Object.fromEntries(query.fields.split(',').map(k=>[k,r[k]])));
        return {data:query.options.head?null:selected,count,error:null};
      }).then(resolve,reject); },
    };
    return b;
  } };
  const m={exports:{}};
  const resolver=n=>n==='@/lib/admin-route'?{requireAdminRoute:async()=>status===200?{ok:true,admin}:{ok:false,response:Response.json({error:'denied'},{status})}}:
    n==='@/lib/admin-registration-counts'?helpers:n==='@/lib/dating-match-metrics'?{
      countCumulativeOpenCardMatches:async()=>12,countCumulativeSwipeMatches:async()=>4,fetchRecentSwipeMatchTimestampRows:async()=>[],
    }:realModule(n);
  class TestDate extends Date {
    constructor(...args){super(...(args.length?args:[now]));}
    static now(){return now+(advanceClock?clockCalls++*1000:0);}
  }
  new Function('require','module','exports','Date',transpile(fs.readFileSync(path.join(root,'app/api/admin/site-dashboard/route.ts'),'utf8')))(resolver,m,m.exports,TestDate);
  return {...m.exports,calls,admin};
}
const row=(id,sex,created_at='2026-10-14T01:00:00.000Z',status='pending')=>({id,sex,created_at,status});
async function body(api){const r=await api.GET();assert.equal(r.status,200);return r.json();}

test('registration groups are independent and unknown values preserve the total',()=>{
  const a=helpers.createRegistrationSexBreakdown(),b=helpers.createRegistrationSexBreakdown();
  for(const sex of ['male','female',null,undefined,'']) helpers.addRegistrationSexCount(a.open_card_created,sex);
  assert.deepEqual(a.open_card_created,{male:1,female:1,unknown:3});
  assert.deepEqual(a.one_on_one_created,{male:0,female:0,unknown:0});
  assert.deepEqual(b.open_card_created,{male:0,female:0,unknown:0});
  assert.equal(helpers.isRegistrationFeatureKey('open_card_applied'),false);
});

test('today uses KST midnight and retains every registration status, not applications',async()=>{
  const api=loadApi({dating_cards:[row('before','female','2026-10-13T14:59:59.999Z'),row('start','male','2026-10-13T15:00:00.000Z','hidden'),row('f','female'),row('unknown',null),row('tomorrow','male','2026-10-14T15:00:00.000Z')],
    dating_1on1_cards:[row('one-m','male',undefined,'submitted'),row('one-f','female',undefined,'approved')],
    dating_card_applications:[row('app',undefined)]});
  const result=await body(api);
  assert.equal(result.today.open_card_created,3);
  assert.deepEqual(result.todayRegistrationsBySex.open_card_created,{male:1,female:1,unknown:1});
  assert.equal(result.today.one_on_one_created,2);
  assert.deepEqual(result.todayRegistrationsBySex.one_on_one_created,{male:1,female:1,unknown:0});
  assert.equal(result.today.open_card_applied,1);
  assert.equal(result.current.totalDatingMatches,16);
  const yesterday=result.recent7d.find(d=>d.dateKey==='2026-10-13');
  assert.equal(yesterday.counts.open_card_created,1);
  assert.deepEqual(yesterday.registrationsBySex.open_card_created,{male:0,female:1,unknown:0});
  assert.equal(result.recent7d.length,7);
});

test('daily registration reads remain unchanged and active counts never fetch photos or introductions',async()=>{
  const api=loadApi({dating_cards:[row('m','male')],dating_1on1_cards:[row('f','female')]});await body(api);
  const sexReads=api.calls.filter(q=>q.fields.includes('sex')&&q.filters.some(([op])=>op==='gte'));
  assert.deepEqual(sexReads.map(q=>q.table).sort(),['dating_1on1_cards','dating_cards']);
  for(const q of sexReads){assert.equal(q.fields,'created_at,sex');assert.equal(q.filters.length,1);assert.equal(q.filters[0][0],'gte');assert.deepEqual(q.ordering,[['created_at',true],['id',true]]);}
  assert.equal(api.calls.some(q=>/email|nickname|photo|intro/.test(q.fields)),false);
});

test('pagination includes more than 1,000 same-timestamp registrations exactly once',async()=>{
  const rows=Array.from({length:1007},(_,i)=>row(String(i).padStart(4,'0'),i%2?'female':'male'));
  const api=loadApi({dating_cards:rows});const r=await body(api);
  assert.equal(r.today.open_card_created,1007);
  assert.deepEqual(r.todayRegistrationsBySex.open_card_created,{male:504,female:503,unknown:0});
  assert.equal(api.calls.filter(q=>q.table==='dating_cards'&&q.fields==='created_at,sex').length,2);
});

test('zero days and daily sex totals stay consistent across both features',async()=>{
  const r=await body(loadApi());
  for(const d of r.recent7d)for(const key of ['open_card_created','one_on_one_created']){
    assert.deepEqual(d.registrationsBySex[key],{male:0,female:0,unknown:0});
    assert.equal(Object.values(d.registrationsBySex[key]).reduce((a,b)=>a+b,0),d.counts[key]);
  }
});

test('year rollover is correct and a request crossing midnight keeps one consistent day',async()=>{
  const before=Date.parse('2026-12-31T14:59:59.999Z');
  const data={dating_cards:[row('dec','male','2026-12-31T14:59:59.000Z'),row('jan','female','2026-12-31T15:00:00.000Z')]};
  const r=await body(loadApi(data,{now:before,advanceClock:true}));
  assert.equal(r.recent7d.at(-1).dateKey,'2026-12-31');assert.equal(r.today.open_card_created,1);assert.equal(r.todayRegistrationsBySex.open_card_created.male,1);
  const next=await body(loadApi(data,{now:before+1}));assert.equal(next.recent7d.at(-1).dateKey,'2027-01-01');assert.equal(next.todayRegistrationsBySex.open_card_created.female,1);
});

test('non-admin requests cannot query any dashboard data',async()=>{
  for(const status of [401,403]){const api=loadApi({}, {status});assert.equal((await api.GET()).status,status);assert.equal(api.calls.length,0);}
});

test('database failures do not become a successful zero dashboard',async()=>{
  const api=loadApi({}, {errorTable:'dating_1on1_cards'});
  const r=await api.GET();assert.equal(r.status,500);assert.equal(Object.hasOwn(await r.json(),'todayRegistrationsBySex'),false);
});

test('real component renders compact Korean counts, unknown and old response safely',()=>{
  const Component=moduleAt('components/admin/AdminRegistrationSexCounts.tsx').default;
  const render=counts=>renderToStaticMarkup(React.createElement(Component,{counts}));
  assert.equal(render(undefined),'');assert.equal(render(null),'');
  const html=render({male:1200,female:0,unknown:2});
  for(const text of ['남 1,200건','여 0건','미확인 2건','flex-wrap','whitespace-nowrap'])assert.ok(html.includes(text),text);
  assert.ok(!render({male:0,female:0,unknown:0}).includes('미확인'));
});

test('mypage displays the two breakdowns and seven-day details without requiring a new payload field',()=>{
  const source=fs.readFileSync(path.join(root,'app/mypage/page.tsx'),'utf8');
  assert.ok(source.includes('todayRegistrationsBySex?.open_card_created'));
  assert.ok(source.includes('todayRegistrationsBySex?.[item.key]'));
  assert.ok(source.includes('day.registrationsBySex?.[key]'));
  assert.ok(source.includes('오늘 1:1 프로필 등록'));
  assert.ok(source.includes('const AdminRegistrationSexCounts = dynamic('));
  assert.ok(source.includes('const AdminActiveOneOnOneCounts = dynamic('));
  assert.ok(source.includes('activeOneOnOneProfiles?:'));
  assert.ok(source.includes('<AdminActiveOneOnOneCounts counts={adminSiteDashboard.current.activeOneOnOneProfiles} />'));
});

const activeCard=(id,sex='male',extra={})=>({id,user_id:`user-${id}`,sex,status:'approved',birth_year:1995,phone:null,created_at:'2026-01-01T00:00:00Z',...extra});
const profile=(id,extra={})=>({user_id:`user-${id}`,phone_e164:null,is_banned:false,...extra});

test('active profiles include submitted/reviewing/approved, not paused/rejected/deleted/banned/invalid-age rows',async()=>{
  const cards=['submitted','reviewing','approved','paused','rejected','deleted'].map((status,i)=>activeCard(`status-${i}`,i%2?'female':'male',{status}));
  cards.push(activeCard('banned'),activeCard('orphan'),activeCard('age', 'female',{birth_year:2010}),activeCard('unknown',null));
  const profiles=cards.filter(c=>c.id!=='orphan').map(c=>({user_id:c.user_id,phone_e164:null,is_banned:c.id==='banned'}));
  const r=await body(loadApi({dating_1on1_cards:cards,profiles}));
  assert.deepEqual(r.current.activeOneOnOneProfiles,{total:3,male:2,female:1});
  assert.equal(r.today.one_on_one_created,0); // Active profiles are not just today's registrations.
  assert.ok(!JSON.stringify(r).includes('user-status'));
});

test('one member counts once, using the latest active profile and its current sex',async()=>{
  const cards=[activeCard('old','male',{user_id:'owner'}),activeCard('new','female',{user_id:'owner',created_at:'2026-10-14T00:00:00Z'}),activeCard('paused','male',{user_id:'owner',status:'paused',created_at:'2026-10-14T01:00:00Z'})];
  const api=loadApi({dating_1on1_cards:cards,profiles:[{user_id:'owner',is_banned:false}]});
  assert.deepEqual(await activeHelpers.fetchActiveOneOnOneCounts(api.admin,fixedNow),{total:1,male:0,female:1});
});

test('same phone accounts count once, verified phone wins over old card snapshots and phone formats normalize',async()=>{
  const api=loadApi({dating_1on1_cards:[activeCard('a','male',{phone:'010-0000-0001'}),activeCard('b','female',{phone:'01000000002',created_at:'2026-10-14T00:00:00Z'})],
    profiles:[profile('a',{phone_e164:'+821000000009'}),profile('b',{phone_e164:'010-0000-0009'})]});
  assert.deepEqual(await activeHelpers.fetchActiveOneOnOneCounts(api.admin,fixedNow),{total:1,male:0,female:1});
});

test('latest invalid or banned identity does not resurrect an older profile, even in cross-account chains',async()=>{
  const cards=[activeCard('a','male',{user_id:'u1',phone:'01000000001'}),activeCard('b','female',{user_id:'u1',phone:'01000000002',created_at:'2026-02-01T00:00:00Z'}),activeCard('c','female',{user_id:'u2',phone:'01000000002',created_at:'2026-03-01T00:00:00Z'}),activeCard('d','male',{user_id:'u3',phone:'01000000001',created_at:'2025-01-01T00:00:00Z'})];
  for(const banned of [false,true]) {
    const data={dating_1on1_cards:cards,profiles:[{user_id:'u1',is_banned:false},{user_id:'u2',is_banned:banned},{user_id:'u3',is_banned:false}]};
    const api=loadApi(data);
    const counts=await activeHelpers.fetchActiveOneOnOneCounts(api.admin,fixedNow);
    assert.deepEqual(counts,banned?{total:0,male:0,female:0}:{total:1,male:0,female:1});
    const currentIds=await realModule('@/lib/dating-1on1-current-cards').getCurrentOneOnOneCardIds(api.admin,cards);
    assert.equal(counts.total,currentIds.size);
  }
});

test('timestamp ties choose the same latest ID as matching, independent of input ordering',async()=>{
  for(const cards of [[activeCard('a','male',{user_id:'owner'}),activeCard('z','female',{user_id:'owner'})],[activeCard('z','female',{user_id:'owner'}),activeCard('a','male',{user_id:'owner'})]]) {
    const api=loadApi({dating_1on1_cards:cards,profiles:[{user_id:'owner'}]});
    assert.deepEqual(await activeHelpers.fetchActiveOneOnOneCounts(api.admin,fixedNow),{total:1,male:0,female:1});
  }
});

test('active profiles paginate beyond the DB row limit and batch owner reads, with no recent-activity cutoff',async()=>{
  const cards=Array.from({length:1207},(_,i)=>activeCard(String(i).padStart(4,'0'),i%2?'female':'male'));
  const data={dating_1on1_cards:cards,profiles:cards.map(c=>({user_id:c.user_id,is_banned:false}))};
  const before=structuredClone(data),api=loadApi(data);
  assert.deepEqual(await activeHelpers.fetchActiveOneOnOneCounts(api.admin,fixedNow),{total:1207,male:604,female:603});
  const pages=api.calls.filter(q=>q.table==='dating_1on1_cards');assert.equal(pages.length,3);
  for(const page of pages){assert.equal(page.end,499);assert.deepEqual(page.ordering,[['id',true]]);}
  const batches=api.calls.filter(q=>q.table==='profiles');assert.equal(batches.length,7);
  for(const batch of batches){assert.ok(batch.filters[0][2].length<=200);assert.equal(batch.fields,'user_id,phone_e164,is_banned');}
  assert.deepEqual(data,before);
});

test('empty active pool returns real zeros without reading owners',async()=>{
  const api=loadApi();
  assert.deepEqual(await activeHelpers.fetchActiveOneOnOneCounts(api.admin,fixedNow),{total:0,male:0,female:0});
  assert.equal(api.calls.length,1);
});

test('active-only read failures preserve the dashboard but explicitly mark the count unavailable',async()=>{
  const api=loadApi({}, {errorFields:'id,user_id,sex,phone,birth_year,created_at'});
  const response=await api.GET();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  const r=await response.json();assert.equal(r.current.activeOneOnOneProfiles,null);assert.equal(r.today.open_card_created,0);
  const profileFailure=loadApi({dating_1on1_cards:[activeCard('a')]},{errorFields:'user_id,phone_e164,is_banned'});
  assert.equal((await body(profileFailure)).current.activeOneOnOneProfiles,null);
});

test('real active count card distinguishes people from registrations, wraps on mobile and never invents zeros',()=>{
  const Component=moduleAt('components/admin/AdminActiveOneOnOneCounts.tsx').default;
  const render=counts=>renderToStaticMarkup(React.createElement(Component,{counts}));
  const html=render({total:1234,male:1000,female:234});
  for(const text of ['현재 활성 1:1 프로필','1,234명','남 1,000명','여 234명','flex-wrap']) assert.ok(html.includes(text));
  assert.ok(!html.includes('건'));assert.ok(render({total:0,male:0,female:0}).includes('여 0명'));
  for(const missing of [undefined,null]){const empty=render(missing);assert.ok(empty.includes('새로고침'));assert.ok(!empty.includes('0명'));}
  assert.ok(render(null).includes('집계하지 못했습니다'));
});
