/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function load(file,mocks={},globals={}) {
  const code=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',...Object.keys(globals),code)(name=>Object.hasOwn(mocks,name)?mocks[name]:name.startsWith('@/')?load(name.slice(2)+'.ts',mocks,globals):require(name),mod,mod.exports,...Object.values(globals));
  return mod.exports;
}
const user='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const match='00000000-0000-4000-8000-000000000003',order='00000000-0000-4000-8000-000000000004';
const session='00000000-0000-4000-8000-000000000005:2026-10-15';
const body=(extra={})=>({eventName:'view_item',matchId:match,amount:20000,placement:'mypage_matching',sessionId:session,...extra});
const req=(data,path='/api/analytics/contact-exchange')=>new Request('https://helchang.com'+path,{method:'POST',body:JSON.stringify(data)});
async function database(){
  const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as 'select null::uuid';
    create table profiles(user_id uuid,role text); create table toss_test_payment_orders(id uuid primary key,user_id uuid,product_type text,toss_order_id text,status text,created_at timestamptz default now(),approved_at timestamptz);
    create table dating_1on1_match_proposals(id uuid primary key,source_user_id uuid,candidate_user_id uuid,state text,contact_exchange_status text);
    insert into auth.users values('${user}'),('${other}');
    insert into profiles values('${user}','user'),('${other}','user');
    insert into dating_1on1_match_proposals values('${match}','${user}','${other}','mutual_accepted','awaiting_applicant_payment');
    insert into toss_test_payment_orders(id,user_id,product_type,toss_order_id,status) values('${order}','${user}','one_on_one_contact_exchange','measurement_test_order','paid');`);
  await db.exec(read('supabase/sql/payment_funnel_events.sql'));
  await db.exec(read('supabase/sql/contact_exchange_funnel.sql'));
  await db.exec(read('supabase/sql/payment_checkout_failures.sql'));
  // Adapter for the actual API handlers; only SELECT + diagnostic INSERT allowed.
  const calls=[];
  const admin={from(table){const filters=[];let fields;const q={
    select(value){fields=value;return q;},eq(k,v){filters.push([k,'=',v]);return q;},gte(k,v){filters.push([k,'>=',v]);return q;},abortSignal(){return q;},
    async maybeSingle(){
      if(!['dating_1on1_match_proposals','toss_test_payment_orders'].includes(table))throw Error('Unexpected read');
      const result=await db.query(`select ${fields} from ${table} where ${filters.map(([k,op],i)=>`${k}${op}$${i+1}`).join(' and ')} limit 1`,filters.map(f=>f[2]));
      return {data:result.rows[0]||null,error:null};
    },
    upsert(row,options){if(!['payment_funnel_events','payment_checkout_failures'].includes(table))throw Error('Payment/match writes forbidden');calls.push({table,row});
      return {async abortSignal(){try{const keys=Object.keys(row);await db.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) on conflict(${options.onConflict}) do nothing`,Object.values(row));return {error:null};}catch(e){return {error:{code:e.code}};}}};
    },
  };return q;}};
  const auth={user:{id:user}};
  const mocks={'@/lib/supabase/request':{getRequestAuthContext:async()=>auth},'@/lib/supabase/server':{createAdminClient:()=>admin},'@/lib/request-origin':{ensureAllowedMutationOrigin:()=>null}};
  return {db,admin,calls,auth,contact:load('app/api/analytics/contact-exchange/route.ts',mocks),failure:load('app/api/payments/toss/failure/route.ts',mocks)};
}
module.exports={read,load,user,other,match,order,session,body,req,database};
