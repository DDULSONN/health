/* eslint-disable @typescript-eslint/no-require-imports */
// No network or live storage: execute actual helper/route against bounded mocks.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,deps={},globals={}){
  const exports={},js=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',...Object.keys(globals),js)(name=>{if(name in deps)return deps[name];if(name.startsWith('@/'))return load(name.slice(2)+'.ts',deps,globals);throw Error('Unexpected dependency '+name);},exports,...Object.values(globals));return exports;
}
function transport(response){
  let calls=0,expire;const timers=new Set();
  const api=load('lib/dating-photo-upload.ts',{}, {fetch:async(_u,options)=>{calls++;return typeof response==='function'?response(options):response;},setTimeout:fn=>{expire=fn;timers.add(1);return 1;},clearTimeout:id=>timers.delete(id)});
  return {...api,run:()=>api.uploadDatingPhoto('/api/dating/1on1/upload',new FormData(),'one_on_one'),calls:()=>calls,timers,expire:()=>expire()};
}
test('valid upload path accepted without automatic retries; timer removed',async()=>{const f=transport(new Response(JSON.stringify({path:'cards/me/photo.webp'})));assert.equal(await f.run(),'cards/me/photo.webp');assert.equal(f.calls(),1);assert.equal(f.timers.size,0);});
for(const [status,reason] of [[400,'rejected'],[401,'auth'],[403,'auth'],[413,'too_large'],[429,'rate_limited'],[500,'server'],[503,'server']])test('HTTP '+status+' gets privacy-safe actionable error and fixed reason',async()=>{
  const f=transport(new Response('PRIVATE provider body / secret filename',{status}));
  await assert.rejects(f.run(),e=>e instanceof f.DatingPhotoUploadError&&e.diagnostic.reason===reason&&!e.message.includes('PRIVATE'));
  assert.equal(f.calls(),1);assert.equal(f.timers.size,0);
});
for(const body of ['html',JSON.stringify({}),JSON.stringify({path:''}),JSON.stringify({path:123})])test('invalid successful response is not treated as a saved photo: '+body,async()=>{const f=transport(new Response(body));await assert.rejects(f.run(),e=>e.diagnostic.reason==='invalid_response');assert.equal(f.timers.size,0);});
test('network failure preserves fixed diagnostic',async()=>{const f=transport(()=>{throw TypeError('private URL');});await assert.rejects(f.run(),e=>e.diagnostic.reason==='network'&&!e.message.includes('private'));});
for(const bodyStage of [false,true])test('timeout covers headers AND response body '+bodyStage,async()=>{
  const f=transport(({signal})=>{const pending=new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));return bodyStage?{ok:true,json:()=>pending}:pending;});
  const promise=f.run();await Promise.resolve();f.expire();await assert.rejects(promise,e=>e.diagnostic.reason==='timeout');assert.equal(f.timers.size,0);
});
function server(options={}){
  const writes=[],kv=[],logs=[];
  const admin={storage:{from:bucket=>({upload:async(object,payload,config)=>{
    writes.push({bucket,object,config});
    if(options.primaryFailure&&bucket==='dating-card-photos'&&!object.includes('/thumb/'))return {error:{message:'storage failure'}};
    if(options.publicThrow&&bucket==='dating-card-lite')throw Error('mirror failed');
    if(options.thumbUploadThrow&&object.includes('/thumb/'))throw Error('thumb failed');
    return {error:null};
  }})}};
  const sharp={default:()=>{const chain={rotate:()=>chain,resize:()=>chain,blur:()=>chain,webp:()=>chain,toBuffer:async()=>{if(options.processingThrow)throw Error('image codec failed');return Buffer.from('webp');}};return chain;}};
  const api=load('app/api/dating/cards/upload-card/route.ts',{
    '@/lib/supabase/server':{createAdminClient:()=>admin},'@/lib/supabase/request':{getRequestAuthContext:async()=>({user:options.signedOut?null:{id:'fixture-owner'}})},
    '@/lib/request-origin':{ensureAllowedMutationOrigin:()=>options.badOrigin?new Response(null,{status:403}):null},
    '@/lib/edge-kv':{kvSetString:async(...args)=>{kv.push(args);if(options.kvThrow)throw Error('kv unavailable');}},
    'next/server':{NextResponse:{json:(body,options)=>new Response(JSON.stringify(body),options)}},sharp,
  },{console:{error:()=>{},warn:(...args)=>logs.push(args)},process:{env:{SUPABASE_SERVICE_ROLE_KEY:'fake-only'}}});
  return {writes,kv,logs,post:kind=>{const form=new FormData();form.set('kind',kind);form.set('asset_id','fixture-asset');form.set('index','0');form.set('file',new File(['fixture'],'photo.webp',{type:'image/webp'}));return api.POST(new Request('https://fixture.invalid/api/dating/cards/upload-card',{method:'POST',body:form}));}};
}
for(const kind of ['raw','lite','blur'])test('valid '+kind+' remains owner scoped with matching WebP extension',async()=>{
  const f=server(),r=await f.post(kind);assert.equal(r.status,201);const body=await r.json();assert.equal(body.path,'cards/fixture-owner/'+kind+'/fixture-asset-0.webp');assert.equal(f.writes[0].config.upsert,false);
  if(kind==='raw')assert.equal(f.writes.length,1);
});
for(const options of [{processingThrow:true},{publicThrow:true},{thumbUploadThrow:true},{kvThrow:true}])test('optional thumbnail/mirror failure cannot undo private lite upload '+JSON.stringify(options),async()=>{const f=server(options),r=await f.post('lite');assert.equal(r.status,201);assert.match((await r.json()).path,/\/lite\//);assert.ok(f.logs.length);});
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
