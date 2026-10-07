/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../lib/viewer-session-recovery.ts'),'utf8');
const mod={exports:{}};
new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod.exports);
const {createViewerSessionRecovery}=mod.exports;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<100;i++){if(check())return;await sleep(5);}assert.ok(check(),'condition timed out');}
const member=id=>({data:{user:{id}},error:null});
const failure=error=>({data:{user:null},error});
function harness(read,{initial='a',timeoutMs=30}={}){
  const states=[];let listener,reads=0,boundaries=0,unsubscribed=0;
  const recovery=createViewerSessionRecovery({auth:{
    getUser:()=>{reads++;return read(reads);},
    onAuthStateChange:fn=>{listener=fn;queueMicrotask(()=>fn('INITIAL_SESSION',initial?{user:{id:initial}}:null));return {data:{subscription:{unsubscribe(){unsubscribed++;}}}};},
  },onState:s=>states.push(s),onIdentityChange:()=>boundaries++,timeoutMs,retryDelayMs:2});
  recovery.start();
  return {...recovery,states,emit:(event,id)=>listener(event,id?{user:{id}}:null),
    get state(){return states.at(-1);},get reads(){return reads;},get boundaries(){return boundaries;},get unsubscribed(){return unsubscribed;}};
}
test('normal verified member, same-identity events do not poll',async()=>{
  const h=harness(()=>member('a'));await sleep(5);
  assert.deepEqual(h.state,{status:'authenticated',userId:'a'});
  h.emit('SIGNED_IN','a');h.emit('TOKEN_REFRESHED','a');h.recoverOnReturn();h.retry();await sleep(5);
  assert.equal(h.reads,1);h.stop();
});
test('actual guest remains guest without automatic retries',async()=>{
  const h=harness(()=>failure({name:'AuthSessionMissingError'}),{initial:null});await sleep(10);
  assert.equal(h.state.status,'guest');assert.equal(h.reads,1);h.stop();
});
for(const error of [{status:503},{status:429},{name:'AuthRetryableFetchError'},{status:403}])test('transient error never treated as logout: '+JSON.stringify(error),async()=>{
  const h=harness(()=>failure(error));await sleep(15);
  assert.equal(h.state.status,'error');assert.equal(h.reads,2);assert.ok(h.states.every(s=>s.status!=='guest'));
  await sleep(12);assert.equal(h.reads,2);h.stop();
});
test('one bounded retry recovers without a sign-in event',async()=>{
  const h=harness(n=>n===1?failure({status:503}):member('a'));await sleep(15);
  assert.equal(h.state.status,'authenticated');assert.equal(h.reads,2);assert.equal(h.boundaries,0);h.stop();
});
test('manual retry is deduplicated and recovers after persistent failure',async()=>{
  let resolve;const h=harness(n=>n<=2?failure({status:503}):new Promise(r=>resolve=r));await sleep(15);
  h.retry();h.retry();await sleep(2);assert.equal(h.reads,3);resolve(member('a'));await sleep(2);
  assert.equal(h.state.status,'authenticated');h.stop();
});
test('normal same-user auth event recovers an errored view, outside event callback',async()=>{
  const h=harness(n=>n<=2?failure({status:503}):member('a'));await sleep(15);
  h.emit('TOKEN_REFRESHED','a');assert.equal(h.reads,2);await sleep(10);
  assert.equal(h.state.status,'authenticated');assert.equal(h.reads,3);h.stop();
});
test('return-to-page recovery is throttled, without periodic polling',async()=>{
  const h=harness(n=>n<=2?failure({status:503}):member('a'));await sleep(15);
  h.recoverOnReturn();assert.equal(h.reads,2);
  const originalNow=Date.now;Date.now=()=>originalNow()+6000;
  try{h.recoverOnReturn();h.recoverOnReturn();await sleep(5);assert.equal(h.reads,3);assert.equal(h.state.status,'authenticated');}
  finally{Date.now=originalNow;h.stop();}
});
for(const error of [{status:401},{code:'session_not_found'},{code:'user_not_found'},{name:'AuthSessionMissingError'}])test('invalid stored session does not create a reload loop '+JSON.stringify(error),async()=>{
  const h=harness(()=>failure(error));await sleep(5);
  assert.equal(h.state.status,'guest');assert.equal(h.boundaries,0);assert.equal(h.reads,1);h.stop();
});
test('deleted Auth user is not authenticated',async()=>{
  const h=harness(()=>({data:{user:{id:'a',deleted_at:'2026-01-01'}},error:null}));await sleep(5);
  assert.equal(h.state.status,'guest');h.stop();
});
test('account switch invalidates late old-identity response and clears display before reload',async()=>{
  let resolve;const h=harness(()=>new Promise(r=>resolve=r));await sleep(2);
  h.emit('SIGNED_IN','b');assert.equal(h.boundaries,1);assert.deepEqual(h.state,{status:'checking',userId:null});
  resolve(member('a'));await sleep(5);assert.equal(h.state.userId,null);assert.ok(h.unsubscribed>0);h.stop();
});
test('signout never reopens old data when getUser completes late',async()=>{
  let resolve;const h=harness(()=>new Promise(r=>resolve=r));await sleep(2);
  h.emit('SIGNED_OUT',null);resolve(member('a'));await sleep(5);
  assert.equal(h.boundaries,1);assert.equal(h.state.userId,null);h.stop();
});
test('cleanup drops late reads and pending retry timers',async()=>{
  let resolve;const h=harness(()=>new Promise(r=>resolve=r));await sleep(2);h.stop();
  const count=h.states.length;resolve(member('a'));await sleep(5);assert.equal(h.states.length,count);
  const j=harness(()=>failure({status:503}));await sleep(1);j.stop();await sleep(10);assert.equal(j.reads,1);
});
test('hanging identity reads terminate UI wait after two bounded attempts',async()=>{
  const h=harness(()=>new Promise(()=>{}),{timeoutMs:3});await until(()=>h.state.status==='error');
  assert.equal(h.state.status,'error');assert.equal(h.reads,2);h.stop();
});
test('thrown network failures recover and never become unhandled rejections',async()=>{
  const h=harness(n=>{if(n===1)throw Error('network');return member('a');});await sleep(15);
  assert.equal(h.state.status,'authenticated');h.stop();
});
test('unmount before deferred start never subscribes or reads',()=>{
  let touched=0;const h=createViewerSessionRecovery({auth:{getUser:()=>touched++,onAuthStateChange:()=>touched++},onState:()=>touched++,onIdentityChange:()=>touched++});
  h.stop();h.start();assert.equal(touched,0);
});

for(const mode of ['retry','manual','missing'])test('real Supabase SDK with isolated storage: '+mode,async()=>{
  const {createClient}=require('@supabase/supabase-js');
  const storageKey='fixture-session-'+mode;
  const fixtureUser={id:'fixture-member',aud:'authenticated',email:'fixture@example.invalid',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
  const values=new Map([[storageKey,JSON.stringify({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:fixtureUser})]]);
  let requests=0,recovered=false;
  const client=createClient('https://fixture.invalid','fixture-anon',{auth:{storageKey,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,
    storage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}},
    global:{fetch:async(url,init)=>{
      assert.equal(String(url),'https://fixture.invalid/auth/v1/user');assert.equal(init.method,'GET');requests++;
      if(mode==='missing')return new Response(JSON.stringify({code:'session_not_found',message:'Session missing'}),{status:401,headers:{'Content-Type':'application/json','x-supabase-api-version':'2024-01-01'}});
      if(!recovered&&(mode==='manual'||requests===1))return new Response('temporary unavailable',{status:503});
      return new Response(JSON.stringify(fixtureUser),{status:200,headers:{'Content-Type':'application/json'}});
    }}});
  const states=[];let boundaries=0;
  const recovery=createViewerSessionRecovery({auth:client.auth,onState:s=>states.push(s),onIdentityChange:()=>boundaries++,timeoutMs:500,retryDelayMs:2});
  try{
    recovery.start();
    if(mode==='missing'){
      await until(()=>states.at(-1)?.status==='guest'||boundaries>0);
      assert.equal(values.has(storageKey),false,'SDK clears a definitively invalid session');
      assert.ok(states.every(s=>s.status!=='authenticated'));
    }else{
      await until(()=>states.at(-1)?.status===(mode==='manual'?'error':'authenticated'));
      assert.ok(values.has(storageKey),'transient failure preserves the existing login');
      assert.equal(requests,2);
      if(mode==='manual'){recovered=true;recovery.retry();await until(()=>states.at(-1)?.status==='authenticated');assert.equal(requests,3);}
      assert.equal(boundaries,0);assert.ok(states.every(s=>s.status!=='guest'));
    }
  }finally{recovery.stop();await client.auth.stopAutoRefresh();client.realtime.disconnect();}
});
