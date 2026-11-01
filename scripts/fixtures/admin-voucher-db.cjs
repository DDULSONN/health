/* eslint-disable @typescript-eslint/no-require-imports */
// Offline only: synthetic members, no environment files or production services.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function load(f,stubs={}){const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(read(f),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>n in stubs?stubs[n]:n.startsWith('@/')?load(n.slice(2)+'.ts',stubs):require(n),mod,mod.exports);return mod.exports;}
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
 create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
 create table profiles(user_id uuid primary key,nickname text,role text default 'user',phone_verified boolean default true,is_banned boolean default false);
 create table contact_care_claims(id uuid primary key,user_id uuid,status text,used_at timestamptz);
 create table dating_1on1_match_proposals(id uuid primary key,state text,contact_exchange_status text);
 create table toss_test_payment_orders(id uuid primary key,status text,amount int);
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
 // Same production table/constraints; redemption is covered by check-contact-care.cjs.
 await db.exec(read('supabase/sql/contact_care_manual_vouchers.sql').split('-- Uses exactly')[0]+'commit;');
 const migration=read('supabase/sql/contact_care_admin_grants.sql');await db.exec(migration);
 const q=(s,a=[])=>db.query(s,a);
 for(let n=1;n<=4;n++) {await q('insert into auth.users(id) values($1)',[id(n)]);await q('insert into profiles(user_id,nickname,role) values($1,$2,$3)',[id(n),n===1?'검증회원':'회원'+n,n===4?'admin':'user']);}
 await q("insert into contact_care_claims values($1,$2,'approved',null)",[id(20),id(1)]);
 await q("insert into dating_1on1_match_proposals values($1,'mutual_accepted','awaiting_applicant_payment')",[id(30)]);
 await q("insert into toss_test_payment_orders values($1,'paid',18000)",[id(40)]);
 const grant=async(o={})=>{const a={admin:id(4),user:id(1),request:id(101),quantity:1,reason:'고객 문의 확인 후 지급',nickname:'검증회원',...o};return(await q('select grant_contact_care_manual($1,$2,$3,$4,$5,$6) v',Object.values(a))).rows[0].v;};
 const state=async()=>JSON.stringify(await Promise.all(['dating_1on1_match_proposals','toss_test_payment_orders','contact_care_claims'].map(t=>q(`select * from ${t} order by id`))));
 const count=async()=>Number((await q('select count(*) n from contact_care_manual_vouchers')).rows[0].n);
 return{db,q,grant,state,count,migration};
}
module.exports={fixture,id,read,load,root};
