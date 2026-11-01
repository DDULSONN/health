/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,id,load,read}=require('./fixtures/admin-voucher-db.cjs');
const logic=load('lib/contact-care-grants.ts');
const input={requestId:id(101),userId:id(1),expectedNickname:'검증회원',quantity:1,reason:'고객 문의 확인 후 지급',confirmed:true};
test('admin panel is additive; every existing mypage action and condition is unchanged',()=>{
 const source=read('app/mypage/page.tsx').replace(/\r\n/g,'\n');
 const restored=source.replace(/^const AdminContactVoucherPanel = dynamic\([^\n]*\);\n/m,'')
  .replace(/^ +\{adminUserActivityResult.user \? <AdminContactVoucherPanel userId=\{adminUserActivityResult.user.id\} \/> : null\}\n/m,'');
 assert.notEqual(restored,source);
 assert.equal(require('./check-site-button-tone.cjs').contract(restored),'8aedfb0cf2df6dfd367a2aacc0b3fcd90f9e73fc366bb2686577702b8bc190f2');
});
test('strict grant input / Korean / no caller-selected admin',()=>{
 assert.deepEqual(logic.parseContactVoucherGrant({...input,admin:id(9)}),input);
 for(const quantity of [0,-1,11,1.1,'1',null,NaN,Infinity])assert.equal(logic.parseContactVoucherGrant({...input,quantity}),null);
 for(const patch of [{confirmed:false},{confirmed:'true'},{userId:'bad'},{requestId:'bad'},{reason:'짧다'},{reason:'가'.repeat(301)},{expectedNickname:''}])assert.equal(logic.parseContactVoucherGrant({...input,...patch}),null);
 assert.equal(logic.parseContactVoucherGrant({...input,quantity:10}).quantity,10);
});
const check=(name,fn)=>test(name,async()=>{const f=await fixture();try{await fn(f);}finally{await f.db.close();}});
check('1 and 10 vouchers, replay, migration rerun; orders/phones/claims unchanged',async f=>{
 const before=await f.state();const first=await f.grant();assert.equal(first.remaining,2);assert.equal(first.alreadyGranted,false);
 for(let n=0;n<4;n++)assert.equal((await f.grant()).alreadyGranted,true);
 assert.equal(await f.count(),1);await f.db.exec(f.migration);assert.equal(await f.count(),1);
 assert.equal((await f.grant({request:id(102),quantity:10})).remaining,12);assert.equal(await f.count(),11);
 assert.equal(await f.state(),before);
});
check('same request never refills spent or revoked vouchers',async f=>{
 await f.grant({quantity:2});await f.q("update contact_care_manual_vouchers set used_at=now(),used_match_id=$1 where grant_index=1",[id(90)]);
 await f.q('update contact_care_manual_vouchers set revoked_at=now() where grant_index=2');
 const v=await f.grant({quantity:2});assert.equal(v.alreadyGranted,true);assert.equal(v.remaining,1);assert.equal(await f.count(),2);
});
check('immutable request recipient/quantity/reason/nickname/admin binding',async f=>{
 await f.grant();for(const patch of [{user:id(2)},{quantity:2},{reason:'다른 사유 확인'},{nickname:'다른이름'}])await assert.rejects(f.grant(patch),/CARE_GRANT_CONFLICT/);
 assert.equal(await f.count(),1);
});
for(const [name,sql] of [['banned','update profiles set is_banned=true where user_id=$1'],['unverified','update profiles set phone_verified=false where user_id=$1'],['renamed',"update profiles set nickname='변경회원' where user_id=$1"],['deleted','update auth.users set deleted_at=now() where id=$1'],['auth banned',"update auth.users set banned_until=now()+interval '1 day' where id=$1"]])check(name+' recipient cannot be granted',async f=>{
 await f.q(sql,[id(1)]);await assert.rejects(f.grant(),/CARE_GRANT_MEMBER_CHANGED/);assert.equal(await f.count(),0);
});
check('nonadmin/banned/deleted administrator denied',async f=>{
 await assert.rejects(f.grant({admin:id(1)}),/CARE_GRANT_ADMIN/);
 await f.q('update profiles set is_banned=true where user_id=$1',[id(4)]);await assert.rejects(f.grant(),/CARE_GRANT_ADMIN/);
 assert.equal(await f.count(),0);
});
check('SQL range validation and atomic rollback on collision',async f=>{
 for(const quantity of [null,0,11])await assert.rejects(f.grant({quantity}),/CARE_GRANT_INPUT/);
 await f.q("insert into contact_care_manual_vouchers(user_id,grant_reference,grant_index,reason) values($1,$2,1,'기존 교환권 보존')",[id(1),'admin-ui:'+id(101)]);
 await assert.rejects(f.grant(),/duplicate key/);assert.equal((await f.q('select * from contact_care_admin_grants')).rows.length,0);assert.equal(await f.count(),1);
});
check('anonymous/authenticated cannot issue; service cannot directly insert; service RPC succeeds',async f=>{
 for(const role of ['anon','authenticated']){
  await f.db.exec(`set role ${role}`);try{await assert.rejects(f.grant(),/permission denied/);}finally{await f.db.exec('reset role');}
 }
 await f.db.exec('set role service_role');try{
  await assert.rejects(f.q('delete from contact_care_manual_vouchers'),/permission denied/);
  await assert.rejects(f.q('delete from contact_care_admin_grants'),/permission denied/);
  assert.equal((await f.grant()).remaining,2);
 }finally{await f.db.exec('reset role');}
});
check('API to SQL: authentication, origin, validation, replay and balance',async f=>{
 let authStatus=0,calls=0;
 const api=load('app/api/admin/contact-care/vouchers/route.ts',{
  '@/lib/admin-route':{requireAdminRoute:async()=>authStatus?{ok:false,response:Response.json({error:'denied'},{status:authStatus})}:{ok:true,user:{id:id(4)},admin:{rpc:async(name,p)=>{calls++;assert.equal(name,'grant_contact_care_manual');try{return{data:await f.grant({admin:p.p_admin,user:p.p_user,request:p.p_request,quantity:p.p_quantity,reason:p.p_reason,nickname:p.p_expected_nickname})};}catch(e){return{error:e};}}}}},
  '@/lib/contact-care-server':{careJson:(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'private, no-store'}}),readCareJson:async r=>{const text=await r.text();if(Buffer.byteLength(text)>3000)throw Error('LARGE');return JSON.parse(text);}},
 });
 const post=(body=input,origin='http://local.invalid')=>api.POST(new Request('http://local.invalid/api/admin/contact-care/vouchers',{method:'POST',headers:{host:'local.invalid',origin,'content-type':'application/json'},body:JSON.stringify(body)}));
 for(const status of [401,403]){authStatus=status;assert.equal((await post()).status,status);}authStatus=0;
 assert.equal((await post(input,'https://evil.invalid')).status,403);assert.equal((await post({...input,quantity:11})).status,400);
 assert.equal((await post({...input,reason:'한'.repeat(1500)})).status,400);assert.equal(calls,0);
 const first=await post({...input,admin:id(9)});assert.equal(first.status,200);assert.match(first.headers.get('cache-control'),/no-store/);assert.equal((await first.json()).remaining,2);
 assert.equal((await(await post()).json()).alreadyGranted,true);assert.equal(await f.count(),1);
 await f.q("update profiles set nickname='변경' where user_id=$1",[id(1)]);
 const rejected=await post({...input,requestId:id(102)});assert.equal(rejected.status,409);assert.equal((await rejected.json()).resetRequest,true);assert.equal(await f.count(),1);
});
test('GET projection is member-scoped, bounded, no-store; missing migration disables issuance',async()=>{
 let installed=true,memberBanned=false,authStatus=0;const queries=[];
 const from=table=>{const filters=[];const q={select(cols,opts){queries.push({table,cols,opts,filters});return q;},eq(k,v){filters.push([k,v]);return q;},is(k,v){filters.push([k,v]);return q;},order(){return q;},limit(n){assert(n<=20);return q;},maybeSingle(){return Promise.resolve({data:{user_id:id(1),nickname:'검증회원',phone_verified:true,is_banned:memberBanned}});},then(resolve,reject){const r=table==='contact_care_admin_grants'&&!installed?{error:{code:'42P01'}}:table==='contact_care_claims'?{count:1}:table==='contact_care_manual_vouchers'?{count:2,data:[]}:{data:[]};return Promise.resolve(r).then(resolve,reject);}};return q;};
 const api=load('app/api/admin/contact-care/vouchers/route.ts',{
  '@/lib/admin-route':{requireAdminRoute:async()=>authStatus?{ok:false,response:Response.json({}, {status:authStatus})}:{
   ok:true,user:{id:id(4)},admin:{from,auth:{admin:{getUserById:async uid=>{
    assert.equal(uid,id(1));return{data:{user:{id:uid}}};
   }}}}
  }},
  '@/lib/contact-care-server':{careJson:(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'private, no-store'}})},
 });
 const get=(uid=id(1))=>api.GET(new Request('http://local.invalid/api?userId='+uid));
 for(const status of [401,403]){authStatus=status;assert.equal((await get()).status,status);}authStatus=0;
 assert.equal((await get('bad')).status,400);assert.equal(queries.length,0);
 const response=await get(),body=await response.json();assert.match(response.headers.get('cache-control'),/no-store/);
 assert.equal(body.remaining,3);assert.equal(body.member.canGrant,true);assert(logic.isContactVoucherAdminSnapshot(body,id(1)));
 for(const q of queries)assert(q.filters.some(([k,v])=>k==='user_id'&&v===id(1)));
 installed=false;assert.equal((await(await get()).json()).installed,false);
 memberBanned=true;assert.equal((await(await get()).json()).member.canGrant,false);
 assert.equal(logic.isContactVoucherAdminSnapshot({...body,remaining:4},id(1)),false);
 assert.equal(logic.isContactVoucherAdminSnapshot(body,id(2)),false);
});
