/* eslint-disable @typescript-eslint/no-require-imports */
// Offline transport tests: no credentials, payment provider or production writes.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),mod={exports:{}};
const source=fs.readFileSync(path.join(root,'lib/contact-care-client.ts'),'utf8');
new Function('module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod,mod.exports);
const {fetchCareJson,CareTransportError,careClientError,careAttemptRecorded,snapshotCareEvidence}=mod.exports;
async function mockFetch(mock,fn){const previous=global.fetch;global.fetch=mock;try{await fn();}finally{global.fetch=previous;}}

test('transport uses the same-origin care endpoint once and preserves a definite business rejection',()=>mockFetch(async(url,init)=>{
  assert.equal(url,'/api/dating/1on1/contact-care');assert.equal(init.method,'POST');assert.equal(init.body,'{"action":"redeem"}');
  return Response.json({error:'진행 중인 결제가 있어요. 교환권은 유지돼요.'},{status:409});
},async()=>{const result=await fetchCareJson({method:'POST',body:'{"action":"redeem"}'},100);assert.equal(result.response.status,409);assert.match(result.body.error,/교환권은 유지/);}));
test('network failure never retries the mutation and never leaks native error text',async()=>{
  let calls=0;await mockFetch(async()=>{calls++;throw TypeError('Failed to fetch');},async()=>{
    await assert.rejects(fetchCareJson({method:'POST'},100),e=>e instanceof CareTransportError&&/[가-힣]/.test(e.message));
    assert.equal(calls,1);
  });assert.doesNotMatch(careClientError(TypeError('Failed to fetch')),/Failed to fetch/);
});
for(const phase of ['fetch','body'])test('deadline releases a stalled '+phase+' even when abort is ignored',()=>mockFetch(async()=>phase==='fetch'?new Promise(()=>{}):{json:()=>new Promise(()=>{})},async()=>{
  await assert.rejects(fetchCareJson({method:'POST'},20),e=>e.kind==='timeout');
}));
test('a late response cannot change the settled timeout result',async()=>{
  let resolve;await mockFetch(()=>new Promise(r=>{resolve=r;}),async()=>{
    await assert.rejects(fetchCareJson({},15),e=>e.kind==='timeout');resolve(Response.json({ok:true}));
  });
});
test('already canceled requests do not reach fetch',()=>mockFetch(()=>{throw Error('must not send');},async()=>{
  const c=new AbortController();c.abort();await assert.rejects(fetchCareJson({signal:c.signal},100),e=>e.kind==='canceled');
}));
test('parent cancellation settles even if fetch ignores abort',()=>mockFetch(()=>new Promise(()=>{}),async()=>{
  const c=new AbortController(),request=fetchCareJson({signal:c.signal},1000);c.abort();await assert.rejects(request,e=>e.kind==='canceled');
}));
test('invalid response remains distinguishable from successful processing',()=>mockFetch(async()=>new Response('<html>network gateway</html>',{status:502}),async()=>{
  const result=await fetchCareJson({},100);assert.equal(result.response.status,502);assert.equal(result.body,null);
}));
test('valid Korean business error survives, unknown diagnostics do not',()=>{
  assert.equal(careClientError(Error('로그인이 필요해요.')),'로그인이 필요해요.');
  assert.doesNotMatch(careClientError(Error('SQL/internal/failure')),/SQL|internal/);
});
const claim={match_id:'match-1',order_id:'order-1',status:'pending',used_at:null,used_match_id:null};
const status={claim,payments:[],matches:[],manual_history:[]};
test('application reconciliation needs the same match, order and submitted state',()=>{
  const attempt={action:'apply',matchId:'match-1',orderId:'order-1'};
  assert.equal(careAttemptRecorded(status,attempt),true);
  for(const change of [{match_id:'other'},{order_id:'other'},{status:'needs_info'},{status:'rejected'}])assert.equal(careAttemptRecorded({...status,claim:{...claim,...change}},attempt),false);
  assert.equal(careAttemptRecorded({...status,claim:null},attempt),false);
});
test('redemption reconciliation requires authoritative used history for the exact target and voucher kind',()=>{
  const used={...status,claim:{...claim,used_at:'2026-10-29T01:00:00Z',used_match_id:'match-2'},manual_history:[{used_match_id:'match-3',used_at:'2026-10-29T01:00:00Z'}]};
  assert.equal(careAttemptRecorded(used,{action:'redeem',matchId:'match-2'}),true);
  assert.equal(careAttemptRecorded(used,{action:'redeem_manual',matchId:'match-3'}),true);
  assert.equal(careAttemptRecorded(used,{action:'redeem_manual',matchId:'match-2'}),false);
  assert.equal(careAttemptRecorded(used,{action:'redeem',matchId:'match-3'}),false);
  assert.equal(careAttemptRecorded(status,{action:'redeem',matchId:'match-1'}),false);
});
test('mobile attachment snapshot keeps exact bytes, type, Korean filename and modification time',async()=>{
  const bytes=Buffer.from([255,216,255,224,1,2,3,255,217]);
  const original=new File([bytes],'대화 캡처.jpg',{type:'image/jpeg',lastModified:1234});
  const [copy]=await snapshotCareEvidence([original]);assert.notEqual(copy,original);assert.equal(copy.name,original.name);assert.equal(copy.type,original.type);assert.equal(copy.lastModified,1234);assert.deepEqual(Buffer.from(await copy.arrayBuffer()),bytes);
  original.arrayBuffer=()=>Promise.reject(Error('mobile file no longer available'));
  assert.deepEqual(Buffer.from(await copy.arrayBuffer()),bytes);
});
for(const files of [Array.from({length:4},()=>new File(['x'],'a.png',{type:'image/png'})),[new File([new Uint8Array(3000001)],'a.jpg',{type:'image/jpeg'})],[new File(['x'],'a.heic',{type:'image/heic'})],[new File([],'a.jpg',{type:'image/jpeg'})]])test('invalid evidence cannot be queued for upload: '+files.length+' / '+files[0].type+' / '+files[0].size,async()=>{
  await assert.rejects(snapshotCareEvidence(files),/합계 3MB/);
});
test('unreadable, changed and stalled file handles fail before an upload with actionable Korean copy',async()=>{
  for(const arrayBuffer of [async()=>{throw Error('NotReadableError');},async()=>new ArrayBuffer(0),()=>new Promise(()=>{})]){
    await assert.rejects(snapshotCareEvidence([{size:1,type:'image/jpeg',name:'a.jpg',arrayBuffer}],15),/휴대폰에 저장한 뒤 다시 선택/);
  }
  assert.deepEqual(await snapshotCareEvidence([]),[]);
});
