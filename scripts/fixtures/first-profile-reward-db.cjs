/* eslint-disable @typescript-eslint/no-require-imports */
// In-memory PostgreSQL only; no production credentials or network.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function createRewardDb(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,created_at timestamptz default now()-interval '1 day',deleted_at timestamptz,banned_until timestamptz);
 create table profiles(user_id uuid primary key references auth.users(id) on delete cascade,role text default 'user',is_banned boolean default false,phone_verified boolean default true);
 create table dating_1on1_metric_events(id uuid default gen_random_uuid(),user_id uuid,event_kind text);
 create table return_profile_reward_members(user_id uuid primary key);
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
 for(const[file,table]of[['dating_1on1_cards.sql','dating_1on1_cards'],['dating_apply_credits.sql','user_apply_credits'],['dating_apply_credits.sql','apply_credit_orders']]){
  const ddl=read('supabase/sql/'+file).match(new RegExp('create table if not exists public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];assert.ok(ddl);await db.exec(ddl);
 }
 await db.exec(read('supabase/sql/first_profile_reward.sql'));
 const member=async n=>{await db.query('insert into auth.users(id) values($1)',[id(n)]);await db.query('insert into profiles(user_id) values($1)',[id(n)]);};
 const card=async(n,status='submitted',photos=['a','b'],date=null)=>db.query(`insert into dating_1on1_cards(user_id,status,photo_paths,created_at,sex,name,birth_year,height_cm,job,region,phone,intro_text,strengths_text,preferred_partner_text,smoking,consent_fake_info,consent_no_show,consent_fee,consent_privacy)
 values($1,$2,$3::jsonb,coalesce($4::timestamptz,clock_timestamp()),'female','가상회원',1998,165,'직장인','서울','01000000000','소개','장점','이상형','non_smoker',true,true,true,true) returning id`,[id(n),status,JSON.stringify(photos.map(p=>'cards/'+id(n)+'/'+p)),date]);
 const status=async n=>(await db.query('select first_profile_reward_status($1) as v',[id(n)])).rows[0].v;
 const claim=async n=>(await db.query('select claim_first_profile_reward($1) as v',[id(n)])).rows[0].v;
 const credits=async n=>(await db.query('select credits from user_apply_credits where user_id=$1',[id(n)])).rows[0]?.credits||0;
 return {db,member,card,status,claim,credits,id,read};
}
module.exports={createRewardDb,id,read};
