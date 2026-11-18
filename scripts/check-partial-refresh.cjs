/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function loader(overrides={}){const cache=new Map();return function load(name){
 if(Object.hasOwn(overrides,name))return overrides[name];
 if(!name.startsWith('@/'))return require(name);
 if(cache.has(name))return cache.get(name).exports;
 const m={exports:{}};cache.set(name,m);
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',name.slice(2)+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(load,m,m.exports);return m.exports;
};}
const now=Date.now(),day=86400000,pageAt=now-3600000;
const card=(id,patch={})=>({id,user_id:'u'+id,sex:'female',age:28,region:'50',created_at:new Date(now-60*day).toISOString(),...patch});
const old=Array.from({length:13},(_,i)=>card('old'+i));
const source=card('source',{sex:'male',age:30});
const previous={recommendations:old.slice(0,10),extraRecommendations:old.slice(10)};
const fresh=Array.from({length:20},(_,i)=>card('new'+i,{region:String(i),last_active_at:null}));
const ctx=()=>({observations:old.map(c=>({id:c.id,at:now-2*day})),handled:new Set(),extraExcluded:new Set(),recentPages:[],expansionIds:new Set()});
const load=loader({'@/lib/region-distance':{getRegionDistanceMeta:(_a,b)=>({distanceKm:b==='unknown'?null:Number(b)})}});
const {partialRecommendationPage:partial}=load('@/lib/dating-1on1-partial-refresh');
test('partial repair is deterministic and changes at most three slots without touching input',()=>{
 const context=ctx(),input=structuredClone({source,previous,context,fresh});const a=partial(source,fresh,previous,context,pageAt,now);
 assert.equal(a.changes.length,3);assert.deepEqual(a,partial(source,fresh,previous,context,pageAt,now));
 assert.deepEqual({source,previous,context,fresh},input);assert.deepEqual(a.page.extraRecommendations,previous.extraRecommendations);
 assert.deepEqual(a.page.recommendations.slice(0,7),previous.recommendations.slice(0,7));
 assert.deepEqual(a.changes.map(x=>x.to),['new0','new1','new2']);
});
for(const [name,patch] of [['not viewed',c=>c.observations=[]],['current page views',c=>c.observations.forEach(o=>o.at=pageAt)],['stale views',c=>c.observations.forEach(o=>o.at=now-31*day)],['less than half',c=>c.observations=c.observations.slice(0,6)]])test(name,()=>{const c=ctx();patch(c);assert.equal(partial(source,fresh,previous,c,pageAt,now).changes.length,0);});
for(const [name,patch] of [['wrong age',c=>c.age=50],['unknown region',c=>c.region='unknown'],['farther',c=>c.region='60'],['distant',c=>c.region='190']])test(name+' never used to manufacture change',()=>{const pool=structuredClone(fresh);pool.forEach(patch);assert.equal(partial(source,pool,previous,ctx(),pageAt,now).changes.length,0);});
for(const kind of ['observations','recentPages','expansionIds','handled','extraExcluded'])test('excludes '+kind,()=>{const c=ctx();if(kind==='observations')c.observations.push(...fresh.map(c=>({id:c.id,at:now-1})));else if(kind==='recentPages')c.recentPages=[{at:now-1,ids:fresh.map(c=>c.id)}];else c[kind]=new Set(fresh.map(c=>c.id));assert.equal(partial(source,fresh,previous,c,pageAt,now).changes.length,0);});
test('inactive compatible people remain eligible, recent activity is not a quota',()=>{assert.equal(partial(source,fresh.map(c=>({...c,last_active_at:new Date(now-100*day).toISOString()})),previous,ctx(),pageAt,now).changes.length,3);});
test('duplicate user identities cannot fill multiple slots',()=>{const p=partial(source,fresh.map(c=>({...c,user_id:'same'})),previous,ctx(),pageAt,now);assert.equal(p.changes.length,1);});
test('subsequent daily repairs exhaust unseen alternatives then stop, never ping-pong',()=>{
 let p=previous,c=ctx(),at=now;const delivered=new Set(old.map(c=>c.id));let total=0;
 for(let step=0;step<12;step++){
  const r=partial(source,fresh,p,c,at-3600000,at);assert.ok(r.changes.length<=3);
  for(const x of r.changes){assert.equal(delivered.has(x.to),false);delivered.add(x.to);total++;}
  assert.deepEqual(r.page.extraRecommendations,previous.extraRecommendations);
  p=r.page;c.recentPages.push({at,ids:[...p.recommendations,...p.extraRecommendations].map(c=>c.id)});
  c.observations.push(...p.recommendations.map(c=>({id:c.id,at})));at+=day;
 }
 assert.equal(total,10,'stop before replacing a close candidate with a farther unused one');
});

function monitorFixture(opts={}){
 const writes=[],calls=[],sent=[];let planned=0;
 const job={id:'audit',user_id:'owner',lease_token:'lease'},attempt={user_id:'owner',source_card_id:'source'};
 const p={source_card_id:'source',partial:{changes:[{}]},monitor:{safe_local_change:true}};
 const admin={from:table=>{let update,filters=[];const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q;},in:()=>q,gte:()=>q,lt:()=>q,order:()=>q,limit:()=>q,maybeSingle:()=>q,single:()=>q,
 update:v=>{update=v;writes.push([table,v]);return q;},then:(resolve,reject)=>{
 let data=[];if(table.endsWith('_settings'))data={mode:opts.mode??'repair',email_enabled:true,partial_enabled:true};
 if(table==='dating_1on1_recommendation_pages')data={source_card_id:'source',refreshed_at:new Date(pageAt).toISOString(),main_candidate_ids:old.slice(0,10).map(c=>c.id),extra_candidate_ids:old.slice(10).map(c=>c.id)};
 if(table==='dating_1on1_cards')data=filters.some(f=>f[0]==='id')?{id:'source'}:[{id:'source',user_id:'owner',created_at:source.created_at},...old];
 if(table==='dating_1on1_candidate_impressions')data=opts.noRepeat?[]:old.map(c=>({candidate_user_id:c.user_id}));
 if(table==='profiles')data={is_banned:false};
 if(table==='dating_1on1_refresh_attempts')data={source_card_id:'source'};
 if(table==='dating_1on1_refresh_audits')data=update?[{id:job.id}]:filters.some(f=>f[0]==='id')?{repair_count:1,finding:'partial_repaired',repair_main_ids:opts.staleMail?[]:old.slice(0,10).map(c=>c.id),repair_extra_ids:old.slice(10).map(c=>c.id)}:[{...job,attempt_id:'attempt',repaired_at:new Date(pageAt).toISOString(),finding:'partial_repaired'}];
 return Promise.resolve({data,error:opts.readError?{}:null}).then(resolve,reject);
 }};return q;},rpc:async(name,args)=>{calls.push([name,args]);return{data:opts.result??'repaired',error:opts.rpcError?{}:null};}};
 const api=loader({'@/lib/dating-1on1-recommendation-service':{loadOneOnOneRecommendations:async(_a,_u,args)=>{planned++;assert.equal(args.partialRepair,true);return Response.json({plan:opts.emptyPlan?undefined:p},{status:opts.planStatus??200});}},
 '@/lib/dating-swipe':{sendDatingEmailNotification:async(_a,u,s,text,check,key)=>{if(await check()){sent.push({u,s,text,key});return true;}return false;}},
 '@/lib/dating-1on1-reminders':{isOneOnOneReminderHour:()=>true}})('@/lib/dating-1on1-refresh-monitor');
 return{api,admin,job,attempt,writes,calls,sent,planned:()=>planned};
}
test('cheap real-view preflight skips full scans and writes only audit outcome',async()=>{const f=monitorFixture({noRepeat:true});assert.equal(await f.api.auditPartialRefresh(f.admin,f.job,f.attempt,'repair'),'no_safe_partial');assert.equal(f.planned(),0);assert.equal(f.calls.length,0);assert.ok(f.writes.every(w=>w[0]==='dating_1on1_refresh_audits'));});
for(const [name,opts,mode,result,callCount] of [
 ['observe',{},{},'partial_ready',0],['empty',{emptyPlan:true},'repair','no_safe_partial',0],
 ['stale',{planStatus:409},'repair','superseded',0],['commit',{},'repair','partial_repaired',1],
 ['duplicate',{result:'already_repaired'},'repair','partial_repaired',1],['cooldown',{result:'cooldown'},'repair','repair_cooldown',1],
 ['conflict',{result:'stale_plan'},'repair','superseded',1],
])test('worker '+name,async()=>{const f=monitorFixture(opts);assert.equal(await f.api.auditPartialRefresh(f.admin,f.job,f.attempt,typeof mode==='string'?mode:'observe'),result);assert.equal(f.calls.length,callCount);assert.equal(f.sent.length,0);assert.ok(f.calls.every(c=>c[0]==='repair_dating_1on1_partial_audit'));});
for(const opts of [{rpcError:true},{planStatus:503},{readError:true}])test('uncertain read/write never sends or claims recovery '+JSON.stringify(opts),async()=>{const f=monitorFixture(opts);await assert.rejects(f.api.auditPartialRefresh(f.admin,f.job,f.attempt,'repair'));assert.equal(f.writes.length,0);assert.equal(f.sent.length,0);});
test('partial email requires a committed exact page, is not a diagnosis of a bug',async()=>{
 const prior={RESEND_API_KEY:process.env.RESEND_API_KEY,NOTIFY_FROM_EMAIL:process.env.NOTIFY_FROM_EMAIL};process.env.RESEND_API_KEY='synthetic';process.env.NOTIFY_FROM_EMAIL='a@invalid.local';
 try{for(const staleMail of [false,true]){const f=monitorFixture({staleMail});assert.equal(await f.api.deliverRefreshRepairEmails(f.admin,Date.now()+45000),staleMail?0:1);assert.equal(f.sent.length,staleMail?0:1);if(!staleMail){assert.match(f.sent[0].text,/반복해서 보였던 후보 일부/);assert.doesNotMatch(f.sent[0].text,/처리 오류를 확인/);assert.equal(f.sent[0].key,'refresh-repair-audit');}}}
 finally{for(const [k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
