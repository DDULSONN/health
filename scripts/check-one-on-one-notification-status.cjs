/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated production-code tests. No real accounts, providers, or database writes.
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'), read=p=>fs.readFileSync(path.join(root,p),'utf8');
function load(file,deps={}) {
  const mod={exports:{}};
  const code=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',code)(id=>{
    if(Object.hasOwn(deps,id))return deps[id];
    if(id.startsWith('@/'))return load(id.slice(2)+'.ts',deps);
    throw Error('Unexpected dependency '+id);
  },mod,mod.exports); return mod.exports;
}
const status=load('lib/dating-1on1-notification-status.ts');
const matchId='00000000-0000-4000-8000-000000000001';
const viewer='00000000-0000-4000-8000-000000000002',peer='00000000-0000-4000-8000-000000000003';
const ownMatch={id:matchId,source_user_id:peer,candidate_user_id:viewer,state:'source_selected',contact_exchange_status:'none'};
const notice=(reason)=>({user_id:viewer,meta_json:{match_id:matchId,notification_end_reason:reason,notification_end_role:'candidate'}});
function fixture(options={}) {
  const calls=[];
  const db={from(table){
    const call={table,filters:[]};calls.push(call);
    let rows=table==='notifications'?options.notices??[]:options.matches??[];
    const q={select(){return q;},eq(key,value){call.filters.push([key,value]);rows=rows.filter(r=>(key==='meta_json->>match_id'?r.meta_json?.match_id:r[key])===value);return q;},
      or(expression){assert.equal(expression,`source_user_id.eq.${viewer},candidate_user_id.eq.${viewer}`);rows=rows.filter(r=>r.source_user_id===viewer||r.candidate_user_id===viewer);return q;},
      order(){return q;},limit(n){assert.equal(n,1);rows=rows.slice(0,n);return q;},
      async maybeSingle(){return {data:options.fail===table?null:rows[0]??null,error:options.fail===table?{code:'offline'}:null};}};return q;
  }};
  const api=load('app/api/dating/1on1/matches/[id]/status/route.ts',{
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/supabase/request':{getRequestAuthContext:async()=>({user:options.anonymous?null:{id:viewer}})},
    '@/lib/supabase/server':{createAdminClient:()=>db},
  });
  return {calls,db,get:async(id=matchId)=>{const res=await api.GET(new Request('https://example.invalid/status'),{params:Promise.resolve({id})});return {res,body:await res.json()};}};
}
for(const [reason,word] of [['source_skipped','철회'],['candidate_rejected','거절'],['source_declined','최종 수락'],['admin_canceled','취소'],['account_deleted','탈퇴'],['profile_deleted','프로필'],['removed','정확한 삭제 사유']]) {
  test('honest and UTF-8 ending explanation: '+reason,async()=>{
    const f=fixture({notices:[notice(reason)]}),{res,body}=await f.get();
    assert.equal(res.status,200);assert.match(body.notice.body,new RegExp(word));
    assert.equal(res.headers.get('cache-control'),'private, no-store');
    const serialized=JSON.stringify(body);assert.equal(Buffer.from(serialized).toString(),serialized);
    assert.doesNotMatch(serialized,/�|phone|source_user_id|candidate_user_id/);
  });
}
test('old missing match does not infer withdrawal from a null actor or invent a reason',async()=>{
  const {body}=await fixture({notices:[{...notice(),actor_id:null}]}).get();
  assert.match(body.notice.body,/정확한 삭제 사유를 확인할 수 없어요/);assert.doesNotMatch(body.notice.title,/탈퇴|거절/);
});
test('anonymous and malformed ids cannot query data',async()=>{
  const anon=fixture({anonymous:true});assert.equal((await anon.get()).res.status,401);assert.equal(anon.calls.length,0);
  const bad=fixture();assert.equal((await bad.get('../other')).res.status,400);assert.equal(bad.calls.length,0);
});
test('foreign and nonexistent matches have indistinguishable owner-scoped responses',async()=>{
  const a=await fixture({matches:[{...ownMatch,source_user_id:peer,candidate_user_id:peer}],notices:[{...notice('account_deleted'),user_id:peer}]}).get();
  const b=await fixture().get();assert.equal(a.res.status,404);assert.deepEqual(a.body,b.body);
});
for(const table of ['notifications','dating_1on1_match_proposals'])test('lookup failure is retryable, never deletion: '+table,async()=>{
  const {res,body}=await fixture({fail:table,notices:[notice('account_deleted')]}).get();assert.equal(res.status,503);
  assert.match(body.notice.body,/취소되거나 삭제됐다는 뜻은 아니/);
});
for(const [state,word] of [['source_skipped','철회'],['candidate_rejected','거절'],['source_declined','최종 수락'],['admin_canceled','취소'],['mutual_accepted','서로 수락'],['candidate_accepted','최종 수락']])test('live owner state overrides stale deletion metadata: '+state,async()=>{
  const {body}=await fixture({matches:[{...ownMatch,state}],notices:[notice('account_deleted')]}).get();
  assert.match(JSON.stringify(body.notice),new RegExp(word));assert.doesNotMatch(body.notice.title,/탈퇴/);
});
test('only confirmed states provide an ending; unknown states stay neutral',()=>{
  assert.equal(status.oneOnOneEndedNotice('made_up'),null);assert.equal(status.oneOnOneCurrentNotice({state:'source_selected'},'candidate'),null);
});
const guard=load('lib/dating-1on1-notification-guard.ts');
for(const state of ['source_selected','mutual_accepted','source_skipped','candidate_rejected','admin_canceled'])test('send-time guard: '+state,async()=>{
  const f=fixture({matches:[{...ownMatch,state}]});
  assert.equal(await guard.isCurrentOneOnOneNotification(f.db,matchId,'dating_1on1_selection_received',viewer,peer),state==='source_selected');
  assert.equal(await guard.isCurrentOneOnOneNotification(f.db,matchId,'dating_1on1_match_accepted',viewer),state==='mutual_accepted');
});
test('missing, wrong recipient/source and failed lookups suppress stale messages',async()=>{
  for(const options of [{},{fail:'dating_1on1_match_proposals'}]) assert.equal(await guard.isCurrentOneOnOneNotification(fixture(options).db,matchId,'dating_1on1_selection_received',viewer),false);
  const f=fixture({matches:[ownMatch]});
  assert.equal(await guard.isCurrentOneOnOneNotification(f.db,matchId,'dating_1on1_selection_received',peer),false);
  assert.equal(await guard.isCurrentOneOnOneNotification(f.db,matchId,'dating_1on1_selection_received',viewer,viewer),false);
});
test('email templates link the exact match and warn that state can change',()=>{
  const templates=load('lib/dating-email-templates.ts');
  for(const n of [templates.buildOneOnOneSelectionReceivedNotification('테스트','내 카드',matchId),templates.buildOneOnOneAcceptedNotification('테스트',matchId)]) {
    assert.match(n.emailText,new RegExp('matchId='+matchId));assert.match(n.emailText,/발송 후 취소·탈퇴/);
    assert.equal(Buffer.from(n.emailText).toString(),n.emailText);
  }
  assert.doesNotMatch(templates.buildOneOnOneAcceptedNotification('이름','javascript:evil').emailText,/javascript:/);
});
test('SMS short route redirects safely and never queries private data',async()=>{
  const api=load('app/m/[id]/route.ts',{'next/server':{NextResponse:{redirect:(url,status)=>Response.redirect(url,status)}}});
  const r=await api.GET(new Request('https://helchang.com/m/'+matchId),{params:Promise.resolve({id:matchId})});
  assert.equal(r.status,307);assert.match(r.headers.get('location'),new RegExp('matchId='+matchId));
  const bad=await api.GET(new Request('https://helchang.com/m/x'),{params:Promise.resolve({id:'https://evil.invalid'})});
  assert.equal(bad.headers.get('location'),'https://helchang.com/community/dating/cards?tab=one_on_one');
});
for(const timing of ['before-insert','after-insert','still-active'])test('real notification helper rechecks before storage and push: '+timing,async()=>{
  let state=timing==='before-insert'?'source_skipped':'source_selected',inserts=0,pushes=0;
  const db={from(table){
    if(table==='notifications')return {async insert(){inserts++;if(timing==='after-insert')state='source_skipped';return {error:null};}};
    return fixture({matches:[{...ownMatch,state}]}).db.from(table);
  }};
  const api=load('lib/dating-notifications.ts',{'@/lib/expo-push':{sendExpoPushToUser:async()=>{pushes++;return {sent:true};}}});
  const result=await api.notifyDatingUser(db,{userId:viewer,actorId:peer,type:'dating_1on1_selection_received',title:'새 요청',body:'한글 안내',route:'/dating/1on1',meta:{match_id:matchId}});
  assert.equal(inserts,timing==='before-insert'?0:1);assert.equal(pushes,timing==='still-active'?1:0);
  assert.equal(result.stored,inserts===1);assert.equal(result.pushed,pushes===1);
});

// Evaluate the real email sender and sanitizers with an isolated provider/env.
// Neither secrets nor the actual network are accessible to this test.
function mailFixture(retry=false) {
  const file='lib/dating-swipe.ts',ast=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true);
  const names=['sendDatingEmailToAddressDetailed','sanitizeOutgoingEmailCopy','looksLikeBrokenKoreanCopy','normalizeIdempotencyKey'];
  const source=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='MOJIBAKE_MARKERS')).map(n=>n.getText(ast)).join('\n');
  const mod={exports:{}},payloads=[];
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('module','exports','process','fetch','delay',code)(mod,mod.exports,
    {env:{RESEND_API_KEY:'synthetic-test',NOTIFY_FROM_EMAIL:'test@example.invalid'}},
    async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');payloads.push(JSON.parse(options.body));return new Response('',{status:retry?503:200});},async()=>{});
  return {payloads,send:options=>mod.exports.sendDatingEmailToAddressDetailed('recipient@example.invalid','1:1 요청 안내',
    '<img src=x onerror="bad">\nhttps://helchang.com/community/dating/cards?tab=one_on_one&matchId='+matchId+'#selected-one-on-one-match\nhttps://outside.invalid',options)};
}
for(const failure of ['false','throw'])test('email guard prevents provider calls on '+failure,async()=>{
  const f=mailFixture(),result=await f.send({beforeSend:async()=>{if(failure==='throw')throw Error('offline');return false;}});
  assert.equal(result.ok,false);assert.equal(f.payloads.length,0);
});
test('email rechecks cancellation before a provider retry',async()=>{
  const f=mailFixture(true);let checks=0;
  const result=await f.send({beforeSend:async()=>++checks===1});
  assert.equal(checks,2);assert.equal(f.payloads.length,1);assert.equal(result.error,'MATCH_NO_LONGER_CURRENT');
});
test('normal email stays UTF-8, escapes user HTML and links only the exact first-party match',async()=>{
  const f=mailFixture(),result=await f.send();assert.equal(result.ok,true);assert.equal(f.payloads.length,1);
  const payload=f.payloads[0];assert.equal(payload.subject,'1:1 요청 안내');
  assert.equal(Buffer.from(JSON.stringify(payload),'utf8').toString('utf8'),JSON.stringify(payload));
  assert.match(payload.html,/charset="utf-8"/);assert.match(payload.html,/&amp;matchId=/);
  assert.match(payload.html,/>매칭 상태 확인<\/a>/);assert.doesNotMatch(payload.html,/<img|href="https:\/\/outside/);
});

test('PostgreSQL: capture truthful cascade reasons, preserve deletion, scope recipients and reinstall safely',async()=>{
  const {PGlite}=require('@electric-sql/pglite'),db=new PGlite({onNotice: notice=>{if(notice.severity==='WARNING')console.log('Local SQL warning:',notice.message);}});
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create table dating_1on1_cards(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
      create table dating_1on1_match_proposals(id uuid primary key,source_user_id uuid references auth.users(id) on delete cascade,candidate_user_id uuid references auth.users(id) on delete cascade,
        source_card_id uuid references dating_1on1_cards(id) on delete cascade,candidate_card_id uuid references dating_1on1_cards(id) on delete cascade,state text);
      create table notifications(user_id uuid references auth.users(id) on delete cascade,actor_id uuid references auth.users(id) on delete set null,meta_json jsonb);`);
    const sql=read('supabase/sql/dating_1on1_notification_endings.sql');await db.exec(sql);await db.exec(sql);
    for(const role of ['source','candidate'])for(const [op,expected,state] of [['account','account_deleted','mutual_accepted'],['card','profile_deleted','mutual_accepted'],['direct','removed','mutual_accepted'],['account','source_skipped','source_skipped']]) {
      const source=role==='source'?viewer:peer,candidate=role==='source'?peer:viewer;
      await db.exec('begin');
      await db.exec(`insert into auth.users values('${viewer}'),('${peer}'),('00000000-0000-4000-8000-000000000004');
        insert into dating_1on1_cards values('${viewer}','${viewer}'),('${peer}','${peer}');
        insert into dating_1on1_match_proposals values('${matchId}','${source}','${candidate}','${source}','${candidate}','${state}');
        insert into notifications values('${viewer}','${peer}','{"match_id":"${matchId}","notification_body":"old name"}'),
          ('${peer}','${viewer}','{"match_id":"${matchId}"}'),
          ('00000000-0000-4000-8000-000000000004',null,'{"match_id":"${matchId}"}');`);
      await db.exec(op==='account'?`delete from auth.users where id='${peer}'`:op==='card'?`delete from dating_1on1_cards where id='${peer}'`:`delete from dating_1on1_match_proposals where id='${matchId}'`);
      const own=await db.query('select meta_json from notifications where user_id=$1',[viewer]);
      assert.equal(own.rows[0].meta_json.notification_end_reason,expected,JSON.stringify({op,own:own.rows,remaining:(await db.query('select id from dating_1on1_match_proposals')).rows}));
      assert.equal(own.rows[0].meta_json.notification_end_role,role);
      const foreign=await db.query("select meta_json from notifications where user_id='00000000-0000-4000-8000-000000000004'");
      assert.equal(foreign.rows[0].meta_json.notification_end_reason,undefined);
      assert.equal((await db.query('select * from dating_1on1_match_proposals')).rows.length,0);
      await db.exec('rollback');
    }
    // Deliberate failure in auxiliary notification storage must not break withdrawal.
    await db.exec(`insert into auth.users values('${viewer}'),('${peer}');
      insert into dating_1on1_cards values('${viewer}','${viewer}'),('${peer}','${peer}');
      insert into dating_1on1_match_proposals values('${matchId}','${peer}','${viewer}','${peer}','${viewer}','mutual_accepted');
      insert into notifications values('${viewer}','${peer}','{"match_id":"${matchId}"}');
      alter table notifications add constraint synthetic_failure check(not (meta_json ? 'notification_end_reason'));
      delete from auth.users where id='${peer}';`);
    assert.equal((await db.query('select * from dating_1on1_match_proposals')).rows.length,0);
    assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,1);
  } finally { await db.close(); }
});
