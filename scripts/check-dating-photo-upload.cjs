/* eslint-disable @typescript-eslint/no-require-imports */
// No network or live storage: execute actual helper/route against bounded mocks.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const owner='00000000-0000-4000-8000-000000000101';
function load(file,deps={},globals={}){
  const exports={},js=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',...Object.keys(globals),js)(name=>{if(name in deps)return deps[name];if(name.startsWith('@/'))return load(name.slice(2)+'.ts',deps,globals);throw Error('Unexpected dependency '+name);},exports,...Object.values(globals));return exports;
}
function transport(response){
  let calls=0,timerId=0;const timers=new Map();
  const api=load('lib/dating-photo-upload.ts',{}, {fetch:async(_u,options)=>{calls++;return typeof response==='function'?response(options,calls):response;},setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id)});
  const trigger=ms=>[...timers.values()].find(timer=>timer.ms===ms)?.fn();
  return {...api,run:(options,url='/api/dating/1on1/upload')=>api.uploadDatingPhoto(url,new FormData(),url==='/api/dating/cards/upload'?'open_raw':'one_on_one',options),calls:()=>calls,timers,expire:()=>trigger(45000),retry:()=>trigger(350)};
}
test('valid upload path accepted without automatic retries; timer removed',async()=>{const f=transport(new Response(JSON.stringify({path:'cards/me/photo.webp'})));assert.equal(await f.run(),'cards/me/photo.webp');assert.equal(f.calls(),1);assert.equal(f.timers.size,0);});
for(const [status,reason] of [[400,'rejected'],[401,'auth'],[403,'auth'],[413,'too_large'],[429,'rate_limited'],[500,'server'],[503,'server']])test('HTTP '+status+' gets privacy-safe actionable error and fixed reason',async()=>{
  const f=transport(new Response('PRIVATE provider body / secret filename',{status}));
  await assert.rejects(f.run(),e=>e instanceof f.DatingPhotoUploadError&&e.diagnostic.reason===reason&&!e.message.includes('PRIVATE'));
  assert.equal(f.calls(),1);assert.equal(f.timers.size,0);
});
for(const body of ['html',JSON.stringify({}),JSON.stringify({path:''}),JSON.stringify({path:123})])test('invalid successful response is not treated as a saved photo: '+body,async()=>{const f=transport(new Response(body));await assert.rejects(f.run(),e=>e.diagnostic.reason==='invalid_response');assert.equal(f.timers.size,0);});
test('network failure preserves fixed diagnostic',async()=>{const f=transport(()=>{throw TypeError('private URL');});await assert.rejects(f.run(),e=>e.diagnostic.reason==='network'&&!e.message.includes('private'));});
for (const status of [404,410]) test('OpenCard application upload identifies an unavailable card without retry: '+status,async()=>{
  const f=transport(new Response('private provider detail',{status}));
  await assert.rejects(f.run({retryTransient:true},'/api/dating/cards/upload'),e=>e.diagnostic.reason==='rejected'&&e.message==='지금은 이 오픈카드에 지원할 수 없어요.');
  assert.equal(f.calls(),1);assert.equal(f.timers.size,0);
});
for(const bodyStage of [false,true])test('timeout covers headers AND response body '+bodyStage,async()=>{
  const f=transport(({signal})=>{const pending=new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));return bodyStage?{ok:true,json:()=>pending}:pending;});
  const promise=f.run();await Promise.resolve();f.expire();await assert.rejects(promise,e=>e.diagnostic.reason==='timeout');assert.equal(f.timers.size,0);
});
for (const bodyStage of [false,true]) test('deadline releases the uploader even when fetch/JSON ignores abort '+bodyStage,async()=>{
  let signal, bodyWasRead=false;
  const f=transport(options=>{signal=options.signal;const hung=new Promise(()=>{});return bodyStage?{ok:true,json:()=>{bodyWasRead=true;return hung;}}:hung;});
  const task=f.run({retryTransient:true});await Promise.resolve();
  assert.equal(bodyWasRead,bodyStage);f.expire();
  await assert.rejects(task,e=>e.diagnostic.reason==='timeout');
  assert.equal(signal.aborted,true);assert.equal(f.calls(),1);assert.equal(f.timers.size,0);
});
for (const first of ['network',503]) test('standalone opt-in can recover one interrupted upload: '+first,async()=>{
  const f=transport((_options,calls)=>{if(calls>1)return new Response('{"path":"cards/me/photo.webp"}');
    if(first==='network')throw new TypeError('private transport error');return new Response('not JSON',{status:first});});
  const task=f.run({retryTransient:true});await Promise.resolve();f.retry();
  assert.equal(await task,'cards/me/photo.webp');assert.equal(f.calls(),2);assert.equal(f.timers.size,0);
});
for (const [status,reason] of [[401,'auth'],[413,'too_large'],[429,'rate_limited']]) test('opt-in does not retry HTTP '+status,async()=>{
  const f=transport(new Response('not JSON',{status}));
  await assert.rejects(f.run({retryTransient:true}),e=>e.diagnostic.reason===reason);
  assert.equal(f.calls(),1);assert.equal(f.timers.size,0);
});
test('an unreadable success body never triggers another POST',async()=>{
  const f=transport(new Response('not JSON',{status:200}));
  await assert.rejects(f.run({retryTransient:true}),e=>e.diagnostic.reason==='invalid_response');
  assert.equal(f.calls(),1);assert.equal(f.timers.size,0);
});
test('the original budget cancels a pending retry without issuing a second POST',async()=>{
  const f=transport(new Response('unavailable',{status:503}));
  const task=f.run({retryTransient:true});await Promise.resolve();f.expire();
  await assert.rejects(task,e=>e.diagnostic.reason==='timeout');assert.equal(f.calls(),1);assert.equal(f.timers.size,0);
});
test('a failed retry still makes at most two upload requests and never reads provider errors',async()=>{
  const f=transport(()=>new Response('private provider diagnostics',{status:503}));
  const task=f.run({retryTransient:true});await Promise.resolve();f.retry();
  await assert.rejects(task,e=>e.diagnostic.reason==='server'&&!e.message.includes('private'));
  assert.equal(f.calls(),2);assert.equal(f.timers.size,0);
});
function server(options={}){
  const writes=[],kv=[],logs=[],mirrorChecks=[];
  const admin={from:table=>{
    const filters=[];
    const query={
      select:field=>{assert.equal(field,'id');return query;},
      eq:(key,value)=>{filters.push([key,value]);return query;},
      limit:limit=>{assert.equal(limit,1);return query;},
      abortSignal:async signal=>{
        assert.ok(signal instanceof AbortSignal);assert.equal(table,'dating_cards');
        assert.deepEqual(filters,[['owner_user_id',owner],['members_only',true]]);
        mirrorChecks.push(owner);
        if(options.mirrorCheckThrow)throw Error('unavailable');
        if(options.mirrorCheckError)return {data:null,error:{code:'PGRST204'}};
        return {data:options.memberOnly?[{id:'marked'}]:[],error:null};
      },
    };
    return query;
  },storage:{from:bucket=>({download:async()=>({data:new Blob(['fixture']),error:null}),upload:async(object,payload,config)=>{
    writes.push({bucket,object,config});
    if(options.primaryFailure&&bucket==='dating-card-photos'&&!object.includes('/thumb/'))return {error:{message:'storage failure'}};
    if(options.publicThrow&&bucket==='dating-card-lite')throw Error('mirror failed');
    if(options.thumbUploadThrow&&object.includes('/thumb/'))throw Error('thumb failed');
    return {error:null};
  }})}};
  const sharp={default:()=>{const chain={rotate:()=>chain,resize:()=>chain,blur:()=>chain,webp:()=>chain,toBuffer:async()=>{if(options.processingThrow)throw Error('image codec failed');return Buffer.from('webp');}};return chain;}};
  const deps={
    '@/lib/supabase/server':{createAdminClient:()=>admin},'@/lib/supabase/request':{getRequestAuthContext:async()=>({user:options.signedOut?null:{id:owner}})},
    '@/lib/request-origin':{ensureAllowedMutationOrigin:()=>options.badOrigin?new Response(null,{status:403}):null},
    '@/lib/edge-kv':{kvSetString:async(...args)=>{kv.push(args);if(options.kvThrow)throw Error('kv unavailable');}},
    'next/server':{NextResponse:{json:(body,options)=>new Response(JSON.stringify(body),options)}},sharp,
  },globals={console:{error:()=>{},warn:(...args)=>logs.push(args)},process:{env:{SUPABASE_SERVICE_ROLE_KEY:'fake-only'}}};
  const api=load('app/api/dating/cards/upload-card/route.ts',deps,globals);
  const thumb=load('lib/dating-blur-thumb.ts',deps,globals);
  return {writes,kv,logs,mirrorChecks,thumb:(raw='cards/'+owner+'/raw/fixture-asset-0.webp')=>thumb.ensureBlurThumbFromRaw(admin,raw),
    post:kind=>{const form=new FormData();form.set('kind',kind);form.set('asset_id','fixture-asset');form.set('index','0');form.set('file',new File(['fixture'],'photo.webp',{type:'image/webp'}));return api.POST(new Request('https://fixture.invalid/api/dating/cards/upload-card',{method:'POST',body:form}));}};
}
for(const kind of ['raw','lite','blur'])test('valid '+kind+' remains owner scoped with matching WebP extension',async()=>{
  const f=server(),r=await f.post(kind);assert.equal(r.status,201);const body=await r.json();assert.equal(body.path,'cards/'+owner+'/'+kind+'/fixture-asset-0.webp');assert.equal(f.writes[0].config.upsert,false);
  assert.equal(f.mirrorChecks.length,kind==='blur'?1:0,'raw and lite never need a public-mirror lookup');
  if(kind==='raw')assert.equal(f.writes.length,1);
  if(kind==='lite')assert.deepEqual(f.writes.map(write=>write.bucket),['dating-card-photos','dating-card-photos']);
  if(kind==='blur')assert.deepEqual(f.writes.map(write=>write.bucket),['dating-card-photos','dating-card-lite']);
});
for(const options of [{memberOnly:true},{mirrorCheckError:true},{mirrorCheckThrow:true}])test('blur upload and regeneration remain private and usable '+JSON.stringify(options),async()=>{
  const f=server(options),r=await f.post('blur');
  assert.equal(r.status,201);
  assert.equal((await r.json()).path,'cards/'+owner+'/blur/fixture-asset-0.webp');
  assert.equal(await f.thumb(),'cards/'+owner+'/blur/fixture-asset-0.webp');
  assert.deepEqual(f.writes.map(write=>write.bucket),['dating-card-photos','dating-card-photos']);
  assert.deepEqual(f.mirrorChecks,[owner,owner]);assert.deepEqual(f.kv,[]);
});
test('regeneration preserves ordinary public mirrors but refuses unknown legacy ownership',async()=>{
  const f=server();
  assert.equal(await f.thumb(),'cards/'+owner+'/blur/fixture-asset-0.webp');
  assert.deepEqual(f.writes.map(write=>write.bucket),['dating-card-photos','dating-card-lite']);
  assert.equal(f.kv.length,1);
  const legacy=server();
  assert.equal(await legacy.thumb('legacy/raw/a.jpg'),'legacy/blur/a.webp');
  assert.deepEqual(legacy.writes.map(write=>write.bucket),['dating-card-photos']);
  assert.deepEqual(legacy.mirrorChecks,[]);assert.deepEqual(legacy.kv,[]);
});
for(const [kind,options] of [['lite',{processingThrow:true}],['lite',{thumbUploadThrow:true}],['blur',{publicThrow:true}],['blur',{kvThrow:true}]])test('optional thumbnail/mirror failure cannot undo private '+kind+' upload '+JSON.stringify(options),async()=>{const f=server(options),r=await f.post(kind);assert.equal(r.status,201);assert.ok((await r.json()).path.includes('/'+kind+'/'));assert.ok(f.logs.length);});
test('blur processing is mandatory, never falls back to public raw image',async()=>{const f=server({processingThrow:true});assert.equal((await f.post('blur')).status,500);assert.equal(f.writes.length,0);});
for(const kind of ['raw','lite','blur'])test('primary '+kind+' storage failure is still fatal',async()=>{const f=server({primaryFailure:true});assert.equal((await f.post(kind)).status,500);assert.equal(f.writes.length,1);assert.equal(f.kv.length,0);});
for(const options of [{signedOut:true},{badOrigin:true}])test('upload authorization stays fail closed '+JSON.stringify(options),async()=>{const f=server(options);assert.ok((await f.post('raw')).status>=400);assert.equal(f.writes.length,0);});
const rules=load('lib/onboarding-funnel.ts');
test('diagnostics accept only two fixed enums on upload_failed',()=>{
  assert.equal(rules.parseOnboardingEvent({event:'upload_failed',upload:{stage:'open_raw',reason:'too_large'}}),'upload_failed');
  for(const body of [
    {event:'profile_basic',upload:{stage:'open_raw',reason:'too_large'}},
    {event:'upload_failed',upload:{stage:'filename.jpg',reason:'too_large'}},
    {event:'upload_failed',upload:{stage:'open_raw',reason:'private error'}},
    {event:'upload_failed',upload:{stage:'open_raw',reason:'too_large',email:'private'}},
    {event:'upload_failed',upload:null},{event:'upload_failed',upload:[]},
    {event:'upload_failed',upload:{stage:'open_raw',reason:'too_large'},phone:'private'},
  ])assert.equal(rules.parseOnboardingEvent(body),null);
});
test('analytics sends bounded diagnostics once per stage/reason; does not send identity',async()=>{
  const calls=[],tracker=load('lib/onboarding-analytics.ts',{}, {window:{},fetch:async(url,init)=>{calls.push(JSON.parse(init.body));return new Response(null,{status:204});}});
  const diagnostic={stage:'open_raw',reason:'too_large'};
  tracker.trackOnboardingEvent('member','upload_failed',diagnostic);tracker.trackOnboardingEvent('member','upload_failed',diagnostic);
  tracker.trackOnboardingEvent('member','upload_failed',{stage:'one_on_one',reason:'timeout'});
  await Promise.resolve();assert.equal(calls.length,2);assert.deepEqual(calls[0],{event:'upload_failed',upload:diagnostic});assert.ok(!JSON.stringify(calls).includes('member'));
});
function analytics(options={}){
  const writes=[],logs=[];
  const api=load('app/api/analytics/onboarding/route.ts',{
    'next/server':{NextResponse:Response},
    '@/lib/supabase/request':{getRequestAuthContext:async()=>({user:options.signedOut?null:{id:'trusted-member'}})},
    '@/lib/request-rate-limit':{checkRateLimit:()=>({allowed:!options.limited})},
    '@/lib/supabase/server':{createAdminClient:()=>({from:()=>({upsert:(row,config)=>({abortSignal:async()=>{writes.push({row,config});if(options.dbThrows)throw Error('db unavailable');return {error:null};}})})})},
  },{console:{warn:(...args)=>logs.push(args)}});
  return {writes,logs,post:(body,foreign=false)=>api.POST(new Request('https://fixture.invalid/api/analytics/onboarding',{method:'POST',body:JSON.stringify(body),headers:{origin:foreign?'https://other.invalid':'https://fixture.invalid','content-type':'application/json'}}))};
}
test('new logs do not change existing event storage or require SQL; DB failure stays nonfatal',async()=>{
  for(const dbThrows of [false,true]){
    const f=analytics({dbThrows}),r=await f.post({event:'upload_failed',upload:{stage:'open_raw',reason:'too_large'}});
    assert.equal(r.status,204);assert.deepEqual(f.writes[0].row,{user_id:'trusted-member',event_name:'upload_failed'});
    assert.equal(f.logs.length,1);assert.ok(!JSON.stringify(f.logs).includes('trusted-member'));
  }
});
for(const options of [{signedOut:true},{limited:true},{foreign:true}])test('diagnostics cannot bypass authentication/origin/rate limit '+JSON.stringify(options),async()=>{
  const f=analytics(options);assert.equal((await f.post({event:'upload_failed',upload:{stage:'one_on_one',reason:'server'}},options.foreign)).status,204);assert.equal(f.logs.length,0);assert.equal(f.writes.length,0);
});
