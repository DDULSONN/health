/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {test}=require('node:test'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const me=id(1),peer=id(2),other=id(3),swipe=id(4),stamp=new Date().toISOString();
const deleteRoute='app/api/dating/cards/my/incoming-swipes/[id]/route.ts',getRoute='app/api/dating/cards/my/swipe-status/route.ts';
function data() {return {
  dating_card_swipes:[{id:swipe,actor_user_id:peer,actor_card_id:id(5),target_user_id:me,target_card_id:id(6),action:'like',created_at:stamp}],
  dating_cards:[{id:id(5),owner_user_id:peer,sex:'male',display_nickname:'상대',age:30,photo_paths:[],blur_paths:[]}],
  profiles:[{user_id:peer,nickname:'상대',swipe_profile_visible:true}],
  dating_card_swipe_matches:[],dating_swipe_incoming_dismissals:[],
};}
function database(tables=data(),options={}) {
 const calls=[];
 return {tables,calls,admin:{from(table){
  const q={table,filters:[],fields:''},b={};
  for(const method of ['select','eq','in','or','order','delete','upsert'])b[method]=(...args)=>{
   if(method==='select')q.fields=args[0];else if(method==='upsert')q.upsert=args[0];else if(method==='delete')q.delete=true;
   else if(method!=='order')q.filters.push([method,...args]);return b;
  };
  b.maybeSingle=()=>{q.single=true;return b;};
  b.range=(from,to)=>{q.range=[from,to];return b;};
  b.then=(yes,no)=>Promise.resolve().then(()=>{
   calls.push(q);
   if(options.fail?.(q))return {data:null,error:options.fail(q)};
   const rows=(tables[table]||[]).filter(row=>q.filters.every(([op,k,v])=>op==='eq'?row[k]===v:op==='in'?v.includes(row[k]):k.split(',').some(c=>{const [f,,value]=c.split('.');return row[f]===value;})));
   if(q.upsert){assert.equal(table,'dating_swipe_incoming_dismissals');tables[table]??=[];
    const existing=tables[table].find(row=>row.user_id===q.upsert.user_id&&row.swipe_id===q.upsert.swipe_id&&row.swipe_created_at===q.upsert.swipe_created_at);
    if(existing)Object.assign(existing,q.upsert);else tables[table].push({...q.upsert});return {data:null,error:null};}
   if(q.delete){tables[table]=tables[table].filter(row=>!rows.includes(row));return {data:null,error:null};}
   const projected=rows.slice(q.range?.[0]||0,q.range?q.range[1]+1:undefined).map(row=>Object.fromEntries(q.fields.split(',').map(s=>s.trim()).map(k=>[k,row[k]])));
   return {data:q.single?projected[0]||null:projected,error:null};
  }).then(yes,no);
  return b;
 }}};
}
function load(file,db,options={}) {
 const cache=new Map(),mocks={
  'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
  '@/lib/supabase/request':{getRequestAuthContext:async()=>({user:options.anonymous?null:{id:options.user||me}})},
  '@/lib/supabase/server':{createAdminClient:()=>db.admin},
  '@/lib/dating-blocks':{getDatingBlockedUserIds:async()=>new Set(options.blocked||[])},
  '@/lib/dating-contact-blocks':{getDatingContactBlockedUserIdsForViewer:async()=>new Set(options.contactBlocked||[])},
  '@/lib/dating-swipe':{getSwipeLikeExpiresAtIso:()=>null,isSwipeLikeExpiryEligible:()=>false,pickPreviewImage:()=>null,SWIPE_LIKE_EXPIRY_HOURS:30},
 };
 function compile(f){
  if(cache.has(f))return cache.get(f);
  const m={exports:{}},code=ts.transpileModule(read(f),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',code)(n=>mocks[n]||(n.startsWith('@/')?compile(n.slice(2)+'.ts'):require(n)),m,m.exports);
  cache.set(f,m.exports);return m.exports;
 }
 return compile(file);
}
async function del(db,options={}) {
 const req=new Request('https://helchang.com/api/test',{method:'DELETE',headers:{host:'helchang.com',origin:options.origin||'https://helchang.com','Content-Type':'application/json'},
  body:options.raw||JSON.stringify({created_at:options.stamp||stamp,user_id:peer})});
 return load(deleteRoute,db,options).DELETE(req,{params:Promise.resolve({id:options.id||swipe})});
}
const status=async(db,options={})=>{const r=await load(getRoute,db,options).GET(new Request('https://helchang.com/api/test'));return {r,body:await r.json()};};
test('received like deletion persists only recipient list state, idempotently, without touching usage/matches',async()=>{
 const db=database(),original=structuredClone(db.tables.dating_card_swipes);
 assert.equal((await status(db)).body.incoming_likes.length,1);
 for(let n=0;n<2;n++){const r=await del(db);assert.equal(r.status,200);assert.equal((await r.json()).ok,true);}
 assert.equal(db.tables.dating_swipe_incoming_dismissals.length,1);
 assert.equal(db.tables.dating_swipe_incoming_dismissals[0].user_id,me,'ignore spoofed user in body');
 assert.deepEqual(db.tables.dating_card_swipes,original);
 const s=await status(db);assert.equal(s.body.incoming_likes.length,0);assert.equal(s.body.summary.incoming_pending,0);assert.equal(s.r.headers.get('cache-control'),'private, no-store');
 const sender=await status(db,{user:peer});assert.equal(sender.body.outgoing_likes.length,1,'sender history remains');
 assert.ok(!db.calls.some(q=>q.delete));
});
test('hidden or missing profile cannot be liked, but can be deleted',async()=>{
 for(const missing of [false,true]){
  const d=data();d.profiles[0].swipe_profile_visible=false;if(missing)d.dating_cards=[];
  const db=database(d),s=await status(db);
  assert.equal(s.body.can_dismiss_incoming,true);assert.equal(s.body.incoming_likes[0].can_like,false);
  assert.equal((await del(db)).status,200);
 }
});
test('only receiver can dismiss own like, not sender/third party/pass; auth and CSRF protected',async()=>{
 for(const options of [{anonymous:true},{user:peer},{user:other},{id:'bad'},{raw:'{'},{stamp:'not-a-date'},{origin:'https://evil.invalid'}]){
  const db=database(),r=await del(db,options);assert.ok([400,401,403,404].includes(r.status));assert.equal(db.tables.dating_swipe_incoming_dismissals.length,0);
 }
 const d=data();d.dating_card_swipes[0].action='pass';const db=database(d);assert.equal((await del(db)).status,404);
});
test('new version of same like is visible and stale delete cannot hide it',async()=>{
 const db=database();await del(db);db.tables.dating_card_swipes[0].created_at=new Date(Date.parse(stamp)+1000).toISOString();
 assert.equal((await status(db)).body.incoming_likes.length,1);assert.equal((await del(db)).status,404);
 assert.equal((await del(db,{stamp:db.tables.dating_card_swipes[0].created_at})).status,200);assert.equal((await status(db)).body.incoming_likes.length,0);
});
test('concurrent/existing mutual match is preserved, never canceled by list cleanup',async()=>{
 const d=data();d.dating_card_swipe_matches=[{id:id(99),user_a_id:peer,user_b_id:me,created_at:stamp}];
 const db=database(d);await del(db);assert.equal(db.tables.dating_card_swipe_matches.length,1);
 const s=await status(db);assert.equal(s.body.summary.mutual_matches,1);assert.equal(s.body.incoming_likes.length,0);
 assert.ok(!db.calls.some(q=>(q.upsert||q.delete)&&q.table!=='dating_swipe_incoming_dismissals'));
});
test('old schema keeps lists working and hides unsupported delete; real DB errors fail closed',async()=>{
 const fail=q=>q.table==='dating_swipe_incoming_dismissals'?{code:'42P01',message:'relation dating_swipe_incoming_dismissals does not exist'}:null;
 const db=database(data(),{fail});const s=await status(db);assert.equal(s.r.status,200);assert.equal(s.body.can_dismiss_incoming,false);assert.equal(s.body.incoming_likes.length,1);
 assert.equal((await del(db)).status,503);
 const down=database(data(),{fail:q=>q.table==='dating_swipe_incoming_dismissals'?{code:'XX000',message:'unavailable'}:null});
 assert.equal((await status(down)).r.status,500);assert.equal((await del(down)).status,500);
 const oldVisibility=database(data(),{fail:q=>q.fields.includes('swipe_profile_visible')?{code:'42703',message:'column swipe_profile_visible does not exist'}:null});
 assert.equal((await status(oldVisibility)).body.incoming_likes[0].can_like,true);
});
test('block filters and outbound history remain unaffected',async()=>{
 for(const options of [{blocked:[peer]},{contactBlocked:[peer]}])assert.equal((await status(database(),options)).body.incoming_likes.length,0);
});
test('late save of an older version cannot overwrite deletion of a newer received like',async()=>{
 const db=database();await del(db);
 const newer=new Date(Date.parse(stamp)+1000).toISOString();db.tables.dating_card_swipes[0].created_at=newer;
 await del(db,{stamp:newer});
 // Simulate an older request resuming after it has already read the original row.
 await db.admin.from('dating_swipe_incoming_dismissals').upsert({user_id:me,swipe_id:swipe,swipe_created_at:stamp});
 assert.equal((await status(db)).body.incoming_likes.length,0);
 assert.equal(db.tables.dating_swipe_incoming_dismissals.length,2);
});
test('bounded ID batches and pagination do not resurrect dismissed likes behind old history',async()=>{
 const d=data();
 for(let n=0;n<1500;n++)d.dating_swipe_incoming_dismissals.push({user_id:me,swipe_id:id(n+100),swipe_created_at:'old'});
 for(let n=0;n<600;n++)d.dating_swipe_incoming_dismissals.push({user_id:me,swipe_id:swipe,swipe_created_at:'old-'+n});
 d.dating_swipe_incoming_dismissals.push({user_id:me,swipe_id:swipe,swipe_created_at:stamp});
 const db=database(d);assert.equal((await status(db)).body.incoming_likes.length,0);
 const reads=db.calls.filter(q=>q.table==='dating_swipe_incoming_dismissals');
 assert.equal(reads.length,2);assert.ok(reads.every(q=>q.filters.some(([op,k,v])=>op==='in'&&k==='swipe_id'&&v.length<=100)));
});
test('SQL: private privileges, exact timestamp snapshot, re-apply and cascade cleanup',async()=>{
 const db=new PGlite();
 try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.dating_card_swipes(id uuid primary key,created_at timestamptz,action text);alter default privileges in schema public grant all on tables to anon,authenticated,service_role;");
  const sql=read('supabase/sql/dating_swipe_incoming_dismissals.sql');await db.exec(sql);await db.exec(sql);
  await db.query('insert into auth.users values($1)',[me]);await db.query("insert into dating_card_swipes values($1,'2026-10-03T00:00:00.123456Z','like')",[swipe]);
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);for(const q of ['select * from dating_swipe_incoming_dismissals','delete from dating_swipe_incoming_dismissals',`insert into dating_swipe_incoming_dismissals values('${me}','${swipe}',now())`])await assert.rejects(db.exec(q),/permission denied/);await db.exec('reset role');
  }
  await db.exec('set role service_role');
  for(const sql of ['update dating_swipe_incoming_dismissals set swipe_created_at=now()','delete from dating_swipe_incoming_dismissals'])await assert.rejects(db.exec(sql),/permission denied/);
  for(let n=0;n<2;n++)await db.query("insert into dating_swipe_incoming_dismissals values($1,$2,'2026-10-03T00:00:00.123456Z') on conflict(user_id,swipe_id,swipe_created_at) do nothing",[me,swipe]);
  await db.exec('reset role');
  assert.equal((await db.query("select (swipe_created_at=(select created_at from dating_card_swipes)) as same from dating_swipe_incoming_dismissals")).rows[0].same,true);
  await db.query('delete from dating_card_swipes where id=$1',[swipe]);assert.equal((await db.query('select count(*)::int n from dating_swipe_incoming_dismissals')).rows[0].n,0);
  await db.query("insert into dating_card_swipes values($1,now(),'like')",[swipe]);await db.query('insert into dating_swipe_incoming_dismissals values($1,$2,now())',[me,swipe]);
  await db.query('delete from auth.users where id=$1',[me]);assert.equal((await db.query('select count(*)::int n from dating_swipe_incoming_dismissals')).rows[0].n,0);
 }finally{await db.close();}
});
