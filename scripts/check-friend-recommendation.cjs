/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,loader,id}=require('./fixtures/friend-recommendation-store.cjs');
const {PGlite}=require('@electric-sql/pglite');
const contract=loader()('@/lib/friend-recommendation');
const senderClient=loader()('@/lib/friend-recommendation-client');
const senderBody={requestKey:id(90),prompt:'fit',items:[{kind:'open_card',cardId:id(12)}]};
const senderLink=()=>({path:'/s/'+'a'.repeat(43),expiresAt:new Date(Date.now()+3600000).toISOString()});
test('sender validates local link paths and expiry including exact deadline',()=>{
  const now=Date.now(),link=senderLink();
  assert.equal(senderClient.isFriendLinkCurrent(link,now),true);
  for(const bad of [null,{...link,path:'https://evil.invalid'},{...link,path:'//evil.invalid'},{...link,expiresAt:'bad'},{...link,expiresAt:new Date(now).toISOString()}])assert.equal(senderClient.isFriendLinkCurrent(bad,now),false);
});
for(const stage of ['fetch','body'])test('sender timeout bounds '+stage+' and aborts without changing the retry key',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let request;
  t.mock.method(globalThis,'fetch',async(_url,init)=>{request=init;return stage==='fetch'?new Promise(()=>{}):{ok:true,json:()=>new Promise(()=>{})};});
  const pending=senderClient.requestFriendLink(senderBody,new AbortController().signal);
  const rejected=assert.rejects(pending,/응답이 늦어지고 있어요/);
  t.mock.timers.tick(senderClient.FRIEND_SHARE_REQUEST_TIMEOUT_MS);await rejected;
  assert.equal(request.signal.aborted,true);assert.equal(JSON.parse(request.body).requestKey,id(90));
});
test('sender close aborts an otherwise unresponsive request; pre-aborted calls never fetch',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;return new Promise(()=>{});});
  const abort=new AbortController(),pending=senderClient.requestFriendLink(senderBody,abort.signal);
  const rejected=assert.rejects(pending,/취소/);abort.abort();await rejected;
  await assert.rejects(senderClient.requestFriendLink(senderBody,abort.signal),/취소/);assert.equal(calls,1);
});
test('sender rejects malformed, foreign and expired successful responses',async t=>{
  let value;t.mock.method(globalThis,'fetch',async()=>Response.json(value));
  for(const bad of [null,{}, {...senderLink(),path:'https://evil.invalid'}, {...senderLink(),expiresAt:null}, {...senderLink(),expiresAt:'invalid'}]){
    value=bad;await assert.rejects(senderClient.requestFriendLink(senderBody,new AbortController().signal),/추천 링크를 확인하지 못했어요/);
  }
  value={...senderLink(),expiresAt:'2020-01-01T00:00:00Z'};
  await assert.rejects(senderClient.requestFriendLink(senderBody,new AbortController().signal),e=>e.status===410);
  value=senderLink();assert.deepEqual(await senderClient.requestFriendLink(senderBody,new AbortController().signal),value);
});
test('sender preserves server safety and rate-limit errors; no automatic creation retry',async t=>{
  for(const status of [401,403,409,410,429,503]){
    let calls=0;const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:'추천할 수 없어요.'},{status});});
    await assert.rejects(senderClient.requestFriendLink(senderBody,new AbortController().signal),e=>e.status===status&&e.message==='추천할 수 없어요.');
    assert.equal(calls,1);mock.mock.restore();
  }
});
async function share(f){const service=f.load('@/lib/friend-recommendation-server');return service.createFriendLink(f.admin,id(1),id(90),'fit',[{kind:'open_card',cardId:id(12)}]);}

test('own links expose only bounded saved labels, never private item data or recipient actions',async()=>{
  const f=fixture(),link=await share(f),route=f.load('@/app/api/dating/friend-shares/route');
  f.tables.dating_friend_shares.push({...link,id:id(81),user_id:id(3)}, {...link,id:id(82),revoked_at:new Date().toISOString()}, {...link,id:id(83),expires_at:'2020-01-01'});
  const response=await route.GET(f.request('/'));assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.links.length,1);
  assert.deepEqual(Object.keys(data.links[0]).sort(),['id','token','created_at','expires_at','candidates'].sort());
  assert.deepEqual(data.links[0].candidates,[{kind:'open_card',label:'추천회원'}]);
  assert.doesNotMatch(JSON.stringify(data),/card_id|user_id|revision|phone|ticket|signup|recipient|view_count/);
  assert.match(response.headers.get('cache-control'),/no-store/);
  assert.ok(f.state.calls.some(c=>c.table==='dating_friend_shares'&&c.limit===10));
  assert.ok(f.state.calls.every(c=>!c.write));assert.equal(f.state.matchCalls,0);
  f.state.viewer=null;assert.equal((await route.GET(f.request('/'))).status,401);
});

test('own link labels tolerate malformed historical items without exposing raw data',async()=>{
  const f=fixture(),route=f.load('@/app/api/dating/friend-shares/route');await share(f);
  for(const items of [null,{},[null,{kind:'unknown',label:'bad'},{kind:'one_on_one',label:'가'.repeat(90),user_id:id(8)}]]){
    f.tables.dating_friend_shares[0].items=items;const data=await (await route.GET(f.request('/'))).json();
    assert.deepEqual(data.links[0].candidates,Array.isArray(items)?[{kind:'one_on_one',label:'가'.repeat(30)}]:[]);
  }
});

test('own link settings parser is bounded, legacy-compatible and excludes unsolicited fields',()=>{
  const row={id:id(90),token:'a'.repeat(43),created_at:'2026-10-01T00:00:00Z',expires_at:'2026-10-02T00:00:00Z'};
  assert.deepEqual(senderClient.parseFriendShareSettings({enabled:true,links:[row]}),{enabled:true,links:[{...row,candidates:[]}]});
  const clean=senderClient.parseFriendShareSettings({enabled:false,links:[{...row,secret:'no',candidates:[{kind:'open_card',label:'가'.repeat(50),phone:'no'},null,{kind:'invalid',label:'no'}]}]});
  assert.deepEqual(clean.links[0].candidates,[{kind:'open_card',label:'가'.repeat(30)}]);assert.equal(clean.links[0].secret,undefined);
  for(const data of [null,{}, {enabled:'true',links:[]},{enabled:true,links:Array(11).fill(row)}, ...[{id:'bad'},{token:'../'},{expires_at:'bad'},{created_at:null}].map(bad=>({enabled:true,links:[{...row,...bad}]}))])assert.throws(()=>senderClient.parseFriendShareSettings(data),/확인하지 못했어요/);
});

test('remaining time handles exact expiry, invalid dates and minute boundaries',()=>{
  const now=Date.parse('2026-10-29T00:00:00Z'),remaining=ms=>contract.friendLinkRemaining(new Date(now+ms).toISOString(),now);
  assert.equal(remaining(0),'만료됨');assert.equal(remaining(-1),'만료됨');assert.equal(contract.friendLinkRemaining('bad',now),'만료됨');
  assert.equal(remaining(1),'1분 남음');assert.equal(remaining(60001),'2분 남음');assert.match(remaining(3600001),/1시간 1분 남음/);
});

for(const action of [null,{action:'revoke',id:id(90)},{action:'preference',enabled:false}])for(const stage of ['fetch','body'])test(`settings bounds ${action?.action||'read'} ${stage} without replay`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let calls=0,request;
  t.mock.method(globalThis,'fetch',async(_url,init)=>{calls++;request=init;return stage==='fetch'?new Promise(()=>{}):{ok:true,json:()=>new Promise(()=>{})};});
  const pending=senderClient.requestFriendShareSettings(action,new AbortController().signal),rejected=assert.rejects(pending,action?/처리 결과를 확인하지 못했어요/:/응답이 늦어지고 있어요/);
  t.mock.timers.tick(senderClient.FRIEND_SHARE_REQUEST_TIMEOUT_MS);await rejected;assert.equal(calls,1);assert.equal(request.signal.aborted,true);assert.equal(request.cache,'no-store');
});

test('settings explicit abort, network failure and failed writes are never retried',async t=>{
  let calls=0;const abort=new AbortController();t.mock.method(globalThis,'fetch',async()=>{calls++;throw TypeError('Failed to fetch');});
  await assert.rejects(senderClient.requestFriendShareSettings(null,abort.signal),/연결을 확인/);
  await assert.rejects(senderClient.requestFriendShareSettings({action:'preference',enabled:false},abort.signal),/처리 결과/);
  abort.abort();await assert.rejects(senderClient.requestFriendShareSettings(null,abort.signal),/취소/);assert.equal(calls,2);
});
test('contract rejects external return paths, malformed IDs, duplicate/four selections',()=>{
  for(const value of ['https://evil.invalid','//evil','/s/'+ 'a'.repeat(43)+'?next=//evil',null])assert.equal(contract.friendReturnPath(value),null);
  assert.equal(contract.friendReturnPath('/s/'+'a'.repeat(43)),'/s/'+'a'.repeat(43));
  const item={kind:'open_card',cardId:id(12)};for(const value of [null,[],[item,item],[item,item,item,item],[{...item,cardId:'../'}]])assert.equal(contract.friendSelections(value),null);
  assert.equal(contract.friendSelections([item]).length,1);
});
test('candidate focus survives return paths but arbitrary fragments/queries remain forbidden',()=>{
  const token='a'.repeat(43),back=`/s/${token}#candidate-${id(71)}`;
  assert.equal(contract.friendReturnPath(back),back);
  assert.equal(contract.friendCandidateReturnPath(token,id(71)),back);
  const href=new URL(contract.friendProfileWriteHref(token,id(71)),'https://local.invalid');
  assert.equal(href.pathname,'/onboarding/dating');assert.equal(href.searchParams.get('target'),'one_on_one');assert.equal(href.searchParams.get('share_return'),back);
  for(const suffix of ['#','#other','#candidate-nope','#candidate-'+id(71)+'#other','#candidate-'+id(71)+'?next=//evil','?x=1#candidate-'+id(71),'#candidate-%2f%2fevil'])assert.equal(contract.friendReturnPath('/s/'+token+suffix),null);
  const safe=loader()('@/lib/safe-internal-path').safeInternalPath;
  assert.equal(safe(back),back);assert.equal(new URL('https://local.invalid'+safe('/phone-verification?next='+encodeURIComponent(back))).searchParams.get('next'),back);
});
for(const status of [null,'hidden','rejected','submitted','reviewing','approved'])test('recipient profile hint matches request eligibility: '+status,async()=>{
  const f=fixture(),s=f.load('@/lib/friend-recommendation-server');
  f.tables.dating_1on1_cards.push({id:id(22),user_id:id(2),name:'추천이름',sex:'male',birth_year:1996,status:'approved',region:'서울',photo_paths:[]});
  const link=await s.createFriendLink(f.admin,id(1),id(90),'fit',[{kind:'one_on_one',cardId:id(22),ticket:`ticket:${id(1)}:${id(22)}`}]);
  if(status)f.tables.dating_1on1_cards.push({id:id(33),user_id:id(3),status});
  f.state.viewer=id(3);const response=await f.load('@/app/api/dating/friend-shares/[token]/route').GET(f.request('/'),{params:Promise.resolve({token:link.token})});
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.oneOnOneProfile,['submitted','reviewing','approved'].includes(status)?'ready':'needed');
  assert.equal(f.state.matchCalls,0);assert.ok(f.state.calls.every(c=>!c.write));assert.doesNotMatch(JSON.stringify(data),new RegExp(id(33)));
  f.state.viewer=null;const guest=await f.load('@/app/api/dating/friend-shares/[token]/route').GET(f.request('/'),{params:Promise.resolve({token:link.token})});assert.equal((await guest.json()).oneOnOneProfile,undefined);
});
test('open-card link does not query or require a recipient one-on-one profile',async()=>{
  const f=fixture(),link=await share(f);f.state.viewer=id(3);f.state.failTable='dating_1on1_cards';
  const response=await f.load('@/app/api/dating/friend-shares/[token]/route').GET(f.request('/'),{params:Promise.resolve({token:link.token})});
  assert.equal(response.status,200);assert.equal((await response.json()).oneOnOneProfile,undefined);assert.equal(f.state.matchCalls,0);
});
test('guest projection has no identity, introduction, contact, storage path or exact region',async()=>{const f=fixture(),link=await share(f);f.state.viewer=null;const route=f.load('@/app/api/dating/friend-shares/[token]/route');const response=await route.GET(f.request('/'),{params:Promise.resolve({token:link.token})});assert.equal(response.status,200);const data=await response.json();assert.equal(data.access,'guest');assert.deepEqual(Object.keys(data.items[0]).sort(),['id','kind','ageBand','area','photos'].sort());assert.equal(data.items[0].area,'서울');assert.doesNotMatch(JSON.stringify(data),/추천회원|강남|profile.jpg|private_handle|산책|phone_e164|user_id/);assert.match(response.headers.get('cache-control'),/no-store/);});
test('only verified member sees detail; unverified member still gets guest fields',async()=>{const f=fixture(),link=await share(f),s=f.load('@/lib/friend-recommendation-server');let page=await s.readFriendLink(f.admin,link.token,id(3));assert.equal(page.detailed,true);assert.equal(s.projectFriendItem(link.token,page.items[0].item,page.items[0].card,true).detail.name,'추천회원');f.tables.profiles[2].phone_verified=false;page=await s.readFriendLink(f.admin,link.token,id(3));assert.equal(page.detailed,false);});
for(const mode of ['off','off-on','revoked','expired','deleted-profile','banned','deleted-auth','auth-ban','internal','hidden-card','expired-card','policy-off'])test('link gate: '+mode,async()=>{const f=fixture(),link=await share(f),s=f.load('@/lib/friend-recommendation-server');
  if(mode.startsWith('off')){await f.admin.rpc('set_dating_friend_share_preference',{p_user:id(2),p_enabled:false});if(mode==='off-on')await f.admin.rpc('set_dating_friend_share_preference',{p_user:id(2),p_enabled:true});}
  if(mode==='revoked')f.tables.dating_friend_shares[0].revoked_at=new Date().toISOString();if(mode==='expired')f.tables.dating_friend_shares[0].expires_at='2020-01-01';
  if(mode==='deleted-profile')f.tables.profiles.splice(1,1);if(mode==='banned')f.tables.profiles[1].is_banned=true;if(mode==='deleted-auth')f.state.authMissing.add(id(2));if(mode==='auth-ban')f.state.authBanned.add(id(2));if(mode==='internal')f.state.internal.add(id(2));
  if(mode==='hidden-card')f.tables.dating_cards[0].status='hidden';if(mode==='expired-card')f.tables.dating_cards[0].expires_at='2020-01-01';if(mode==='policy-off')f.tables.dating_friend_share_policy[0].enabled=false;
  await assert.rejects(s.readFriendLink(f.admin,link.token,id(3)));
});
for(const table of ['dating_user_blocks','dating_1on1_admin_user_blocks','dating_1on1_phone_blocks','dating_contact_blocks'])test('safety lookup failure denies rather than treating blocks as empty: '+table,async()=>{const f=fixture(),link=await share(f);f.state.failTable=table;await assert.rejects(f.load('@/lib/friend-recommendation-server').readFriendLink(f.admin,link.token,id(3)));});
for(const pair of [[1,2],[2,1],[3,2],[2,3],[3,1]])test('both directions blocked: '+pair,async()=>{const f=fixture(),link=await share(f);f.tables.dating_user_blocks.push({id:id(80),blocker_user_id:id(pair[0]),blocked_user_id:id(pair[1])});await assert.rejects(f.load('@/lib/friend-recommendation-server').readFriendLink(f.admin,link.token,id(3)));});
test('create requires auth/origin, cannot revoke another sender link, refuses guessed private candidate',async()=>{const f=fixture(),route=f.load('@/app/api/dating/friend-shares/route');f.state.viewer=null;assert.equal((await route.POST(f.request('/',{items:[]}))).status,401);f.state.viewer=id(1);assert.equal((await route.POST(f.request('/',{},'https://evil.invalid'))).status,403);const link=await share(f);f.state.viewer=id(3);assert.equal((await route.POST(f.request('/',{action:'revoke',id:link.id}))).status,200);assert.equal(f.tables.dating_friend_shares[0].revoked_at,null);await assert.rejects(f.load('@/lib/friend-recommendation-server').createFriendLink(f.admin,id(1),id(91),'fit',[{kind:'one_on_one',cardId:id(22)}]),/후보 목록/);});
test('admin only, bounded page, no bearer token in monitoring',async()=>{const f=fixture(),link=await share(f),route=f.load('@/app/api/admin/friend-shares/route');assert.equal((await route.GET(f.request('/'))).status,403);f.state.admin=true;const res=await route.GET(f.request('/'));const data=await res.json();assert.equal(data.items[0].nickname,'보낸회원');assert.equal(data.items[0].items[0].nickname,'추천회원 (계정: 추천회원)');assert.doesNotMatch(JSON.stringify(data),new RegExp(link.token));assert.ok(f.state.calls.some(c=>c.table==='dating_friend_shares'&&c.limit===21));assert.equal((await route.POST(f.request('/',{id:link.id,note:'운영 확인'}))).status,200);assert.ok(f.tables.dating_friend_shares[0].revoked_at);});
test('opening link never sends request; only explicit verified request delegates to existing matching endpoint',async()=>{const f=fixture(),link=await share(f),route=f.load('@/app/api/dating/friend-shares/[token]/request/route');f.state.viewer=id(3);const context={params:Promise.resolve({token:link.token})};assert.equal(f.state.matchCalls,0);const open=await route.POST(f.request('/',{itemId:link.items[0].id}),context);assert.equal(open.status,200);assert.match((await open.json()).href,/\/apply$/);assert.equal(f.state.matchCalls,0);});
test('real photo route returns raster blur for guests; revoked links cannot reload pixels',async()=>{const f=fixture(),link=await share(f),route=f.load('@/app/api/dating/friend-shares/[token]/photos/[itemId]/[index]/route');f.state.viewer=null;const context={params:Promise.resolve({token:link.token,itemId:link.items[0].id,index:'0'})};const response=await route.GET(f.request('/'),context);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');const metadata=await require('sharp')(Buffer.from(await response.arrayBuffer())).metadata();assert.ok(metadata.width<=120);f.tables.dating_friend_shares[0].revoked_at=new Date().toISOString();assert.equal((await route.GET(f.request('/'),context)).status,410);});
async function sqlFixture(run){const db=new PGlite();try{await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table profiles(user_id uuid,phone_verified bool,is_banned bool);alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);await db.query('insert into auth.users values($1),($2)',[id(1),id(2)]);await db.query('insert into profiles values($1,true,false),($2,true,false)',[id(1),id(2)]);const sql=fs.readFileSync(path.join(__dirname,'../supabase/sql/friend_recommendations.sql'),'utf8');await db.exec(sql);await db.exec(sql);const items=[{id:id(70),kind:'open_card',card_id:id(12),user_id:id(2),revision:0,label:'후보'}];const create=(key=id(90),selection=items)=>db.query('select (create_dating_friend_share($1,$2,$3,$4,$5)).*',[id(1),key,'a'.repeat(31)+key.slice(-12),'fit',JSON.stringify(selection)]);await run({db,create,items});}finally{await db.close();}}

test('one-on-one share needs own profile only for explicit request, preserves recipient return',async()=>{
  const f=fixture(),s=f.load('@/lib/friend-recommendation-server');
  f.tables.dating_1on1_cards.push({id:id(22),user_id:id(2),name:'추천이름',sex:'male',birth_year:1996,status:'approved',phone:'+821012340002',region:'서울',photo_paths:[]});
  const link=await s.createFriendLink(f.admin,id(1),id(90),'fit',[{kind:'one_on_one',cardId:id(22),ticket:`ticket:${id(1)}:${id(22)}`}]);
  assert.equal((await s.readFriendLink(f.admin,link.token,id(3))).detailed,true);
  f.state.viewer=id(3);const route=f.load('@/app/api/dating/friend-shares/[token]/request/route'),context={params:Promise.resolve({token:link.token})},body={itemId:link.items[0].id};
  const missing=await route.POST(f.request('/',body),context);assert.equal(missing.status,409);assert.equal(new URL((await missing.json()).profileHref,'https://local.invalid').searchParams.get('share_return'),'/s/'+link.token+'#candidate-'+link.items[0].id);assert.equal(f.state.matchCalls,0);
  f.tables.dating_1on1_cards.push({id:id(33),user_id:id(3),status:'approved'});
  assert.equal((await route.POST(f.request('/',body),context)).status,400);assert.equal(f.state.matchCalls,0);
  assert.equal((await route.POST(f.request('/',{...body,confirm:true}),context)).status,200);assert.equal(f.state.matchCalls,1);assert.deepEqual(f.state.lastMatch,{source_card_id:id(33),candidate_card_id:id(22)});
  f.tables.dating_user_blocks.push({id:id(99),blocker_user_id:id(2),blocked_user_id:id(3)});
  assert.equal((await route.POST(f.request('/',{...body,confirm:true}),context)).status,410);assert.equal(f.state.matchCalls,1);
});

test('link creation accepts PostgREST composite object or one-row array without malformed success',async()=>{
  for(const array of [false,true]){const f=fixture(),rpc=f.admin.rpc;f.admin.rpc=async(name,args)=>{const result=await rpc(name,args);return name==='create_dating_friend_share'&&array?{...result,data:[result.data]}:result;};assert.ok((await share(f)).token);}
  const f=fixture();f.admin.rpc=async()=>({data:null,error:null});await assert.rejects(share(f),/추천 링크를 확인하지 못했어요/);
});

test('paid-card sharing follows existing registration apply route, without charging or applying',async()=>{
  const f=fixture(),s=f.load('@/lib/friend-recommendation-server');f.tables.dating_paid_cards.push({...f.tables.dating_cards[0],id:id(23),user_id:id(2),status:'approved',nickname:'유료후보',gender:'male'});
  const link=await s.createFriendLink(f.admin,id(1),id(90),'hello',[{kind:'paid_card',cardId:id(23)}]);f.state.viewer=id(3);
  const response=await f.load('@/app/api/dating/friend-shares/[token]/request/route').POST(f.request('/',{itemId:link.items[0].id}),{params:Promise.resolve({token:link.token})});
  assert.equal((await response.json()).href,`/dating/paid/${id(23)}/apply`);assert.equal(f.state.matchCalls,0);
});

for(const direction of ['forward','reverse'])test('Instagram contact block works '+direction,async()=>{
  const f=fixture(),link=await share(f);f.tables.dating_cards.push({...f.tables.dating_cards[0],id:id(13),owner_user_id:id(3),instagram_id:'recipient_handle'});
  const hash=f.load('@/lib/dating-contact-blocks').hashDatingContactBlockValue;
  f.tables.dating_contact_blocks.push({id:id(80),user_id:id(direction==='forward'?3:2),block_type:'instagram',value_hash:hash('instagram',direction==='forward'?'private_handle':'recipient_handle')});
  await assert.rejects(f.load('@/lib/friend-recommendation-server').readFriendLink(f.admin,link.token,id(3)));
});

test('photo proxy rejects another owner path and invalid traversal without downloading',async()=>{
  const f=fixture(),link=await share(f),route=f.load('@/app/api/dating/friend-shares/[token]/photos/[itemId]/[index]/route');let downloads=0;f.admin.storage.from=()=>({download:async()=>{downloads++;throw Error('must not download');}});
  for(const path of [`cards/${id(4)}/private.webp`,`cards/${id(2)}/../private.webp`,`cards/${id(2)}/%2e%2e/private.webp`]){
    f.tables.dating_cards[0].photo_paths=[path];const res=await route.GET(f.request('/'),{params:Promise.resolve({token:link.token,itemId:link.items[0].id,index:'0'})});assert.equal(res.status,404);
  }assert.equal(downloads,0);
});

test('photo blur changes during download deny stale clear image',async()=>{
  const f=fixture(),link=await share(f),route=f.load('@/app/api/dating/friend-shares/[token]/photos/[itemId]/[index]/route'),original=f.admin.storage.from;
  f.admin.storage.from=(bucket)=>({download:async path=>{const file=await original(bucket).download(path);f.tables.dating_cards[0].photo_visibility='blur';return file;}});
  f.state.viewer=id(3);assert.equal((await route.GET(f.request('/'),{params:Promise.resolve({token:link.token,itemId:link.items[0].id,index:'0'})})).status,410);
});

test('shared details redact common direct-contact forms, not only separate contact fields',async()=>{
  const f=fixture(),link=await share(f),s=f.load('@/lib/friend-recommendation-server');f.tables.dating_cards[0].strengths_text='메일 member@example.com / 010.1234.5678 / @handle.name';
  const result=await s.readFriendLink(f.admin,link.token,id(3));const projected=s.projectFriendItem(link.token,result.items[0].item,result.items[0].card,true);
  assert.doesNotMatch(projected.detail.strengths,/member|example|1234|handle/);
});

test('private return path survives safe authentication and nested phone redirects',()=>{
  const safe=loader()('@/lib/safe-internal-path').safeInternalPath,back='/s/'+'z'.repeat(43);
  assert.equal(safe(back),back);const phone='/phone-verification?next='+encodeURIComponent(back);assert.equal(new URL('https://example.invalid'+safe(phone)).searchParams.get('next'),back);
  const signup=fs.readFileSync(path.join(__dirname,'../app/signup/page.tsx'),'utf8'),onboarding=fs.readFileSync(path.join(__dirname,'../app/onboarding/dating/page.tsx'),'utf8');
  assert.match(signup,/buildCanonicalCallbackUrl\(signupNext/);assert.match(onboarding,/router.replace\(friendReturnPath/);
  const layout=fs.readFileSync(path.join(__dirname,'../app/layout.tsx'),'utf8');assert.match(layout,/decodeURIComponent\(privateLocation\)/);assert.match(layout,/ga-disable-/);
});
test('SQL disabled on install, private client grants, activation and duplicate retry',()=>sqlFixture(async({db,create,items})=>{await assert.rejects(create(),/unavailable/);for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from dating_friend_shares'),/permission denied/);await assert.rejects(create(),/permission denied/);await db.exec('reset role');}await db.exec('update dating_friend_share_policy set enabled=true');const first=await create();const again=await create(undefined,[{...items[0],id:id(71)}]);assert.equal(first.rows[0].id,again.rows[0].id);assert.equal((await db.query('select count(*)::int n from dating_friend_shares')).rows[0].n,1);await assert.rejects(create(undefined,[{...items[0],card_id:id(13)}]),/request conflict/);}));
test('SQL OFF bumps revision once, ON cannot revive links, stale creation fails',()=>sqlFixture(async({db,create,items})=>{await db.exec('update dating_friend_share_policy set enabled=true');await create();await db.query('select set_dating_friend_share_preference($1,false)',[id(2)]);await db.query('select set_dating_friend_share_preference($1,false)',[id(2)]);await assert.rejects(create(id(91)),/profile unavailable/);await db.query('select set_dating_friend_share_preference($1,true)',[id(2)]);assert.equal(Number((await db.query('select revision from dating_friend_share_preferences')).rows[0].revision),1);await assert.rejects(create(id(91)),/profile changed/);await create(id(91),[{...items[0],revision:1}]);}));
test('SQL active-link limit holds, retry does not consume another link',()=>sqlFixture(async({db,create})=>{await db.exec('update dating_friend_share_policy set enabled=true');for(let n=90;n<100;n++)await create(id(n));await create(id(90));await assert.rejects(create(id(100)),/share limit/);}));
