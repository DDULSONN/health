/* eslint-disable @typescript-eslint/no-require-imports -- Transpile the real TypeScript module without a test runtime dependency. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const fixedNow = Date.parse("2026-09-20T12:00:00.000Z");
class Clock extends Date {
  constructor(...args) { if (args.length) super(...args); else super(fixedNow); }
  static now() { return fixedNow; }
}

const filename = path.resolve(__dirname, "../lib/dating-1on1-contact-nudge.ts");
const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loadedModule = { exports: {} };
new Function("require", "module", "exports", "Date", output)(require, loadedModule, loadedModule.exports, Clock);

const { getOneOnOneContactNudgeSenderDisplayName } = loadedModule.exports;

test("stored 1:1 sender name has highest priority", () => {
  assert.equal(
    getOneOnOneContactNudgeSenderDisplayName({
      storedSenderName: "저장된 매칭 이름",
      oneOnOneCardName: "현재 매칭 이름",
      actorNickname: "사이트 닉네임",
    }),
    "저장된 매칭 이름",
  );
});

test("1:1 card name is used instead of the site nickname for legacy alarms", () => {
  assert.equal(
    getOneOnOneContactNudgeSenderDisplayName({
      storedSenderName: null,
      oneOnOneCardName: "1대1 신청서 이름",
      actorNickname: "사이트 닉네임",
    }),
    "1대1 신청서 이름",
  );
});

test("site nickname is only the last fallback", () => {
  assert.equal(
    getOneOnOneContactNudgeSenderDisplayName({
      storedSenderName: "",
      oneOnOneCardName: null,
      actorNickname: "사이트 닉네임",
    }),
    "사이트 닉네임",
  );
});

test("sender names cannot inject line breaks into an alarm", () => {
  assert.equal(
    getOneOnOneContactNudgeSenderDisplayName({ oneOnOneCardName: "첫 줄\r\n둘째 줄" }),
    "첫 줄 둘째 줄",
  );
});

const helpers = loadedModule.exports;
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const hour = 3600000;
const match = (overrides = {}) => ({
  id: "match", source_user_id: "source", candidate_user_id: "candidate",
  source_card_id: "source-card", candidate_card_id: "candidate-card",
  state: "mutual_accepted", contact_exchange_status: "awaiting_applicant_payment",
  contact_exchange_paid_at: null, contact_exchange_paid_by_user_id: null,
  source_final_responded_at: new Date(fixedNow - 24 * hour).toISOString(),
  updated_at: new Date(fixedNow - 12 * hour).toISOString(),
  created_at: new Date(fixedNow - 72 * hour).toISOString(), ...overrides,
});

test("24-hour threshold opens at the exact boundary, never at 23:59:59.999", () => {
  assert.equal(helpers.ONE_ON_ONE_CONTACT_NUDGE_DELAY_HOURS, 24);
  assert.equal(helpers.ONE_ON_ONE_CONTACT_NUDGE_DELAY_MS, 24 * hour);
  for (const elapsed of [24 * hour - 1, 24 * hour, 24 * hour + 1, 30 * hour, 48 * hour]) {
    const result = helpers.getOneOnOneContactNudgeEligibility(match({source_final_responded_at: new Date(fixedNow-elapsed).toISOString()}));
    assert.equal(result.eligible, elapsed >= 24 * hour);
    assert.equal(result.eligibleAt, new Date(fixedNow-elapsed+24*hour).toISOString());
  }
});

for (const changes of [
  {state:"source_selected"}, {state:"candidate_accepted"}, {state:"admin_canceled"},
  {contact_exchange_status:"approved"}, {contact_exchange_status:"canceled"},
  {contact_exchange_paid_at:new Date(fixedNow).toISOString()}, {contact_exchange_paid_by_user_id:"source"},
  {source_final_responded_at:"invalid"}, {source_final_responded_at:null,updated_at:null,created_at:null},
]) test(`ineligible match stays blocked: ${JSON.stringify(changes)}`, () => {
  assert.equal(helpers.getOneOnOneContactNudgeEligibility(match(changes)).eligible, false);
});

test("legacy timestamp fallback and Korean preset/email contents remain intact", () => {
  assert.equal(helpers.getOneOnOneContactNudgeEligibility(match({source_final_responded_at:null,updated_at:new Date(fixedNow-30*hour).toISOString()})).eligible,true);
  assert.equal(helpers.getOneOnOneContactNudgeEligibility(match({source_final_responded_at:null,updated_at:null})).eligible,true);
  const preset=helpers.getOneOnOneContactNudgeMessage("coffee_on_me");
  assert.equal(preset.message,"연락처 교환해 주시면 첫 커피는 제가 살게요 ☕");
  const email=helpers.buildOneOnOneContactNudgeEmail(preset.message,"매칭 이름");
  assert.match(email.subject,/매칭 이름님이/);
  assert.ok(email.text.includes(preset.message));
  assert.doesNotMatch(email.subject+email.text,/\uFFFD/);
});

function loadFile(file, overrides) {
  const code=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const mod={exports:{}};
  new Function("require","module","exports","Date",code)(name=>{
    if(Object.hasOwn(overrides,name))return overrides[name];
    if(name.startsWith("@/"))throw Error("Unmocked dependency: "+name);
    return require(name);
  },mod,mod.exports,Clock);
  return mod.exports;
}

for (const scenario of ["before24", "at24", "after30", "blocked", "paid", "canceled", "stranger", "anonymous", "duplicate", "databaseRace"]) {
  test(`actual send API: ${scenario}`,async()=>{
    let inserts=0,notifications=0,emails=0;
    const row=match(scenario==="before24"?{source_final_responded_at:new Date(fixedNow-24*hour+1).toISOString()}:scenario==="after30"?{source_final_responded_at:new Date(fixedNow-30*hour).toISOString()}:scenario==="paid"?{contact_exchange_paid_at:new Date(fixedNow).toISOString()}:scenario==="canceled"?{state:"admin_canceled"}:{});
    const db={from(table){let patch;const q={select(){return q;},eq(){return q;},maybeSingle(){return q;},single(){return q;},insert(value){patch=value;inserts++;return q;},then(ok,bad){return Promise.resolve().then(()=>{
      if(table==="dating_1on1_match_proposals")return {data:row,error:null};
      if(table==="dating_1on1_cards")return {data:{name:"매칭 이름"},error:null};
      assert.equal(table,"dating_1on1_contact_nudges");
      if(scenario==="duplicate")return {data:null,error:{code:"23505",message:"duplicate"}};
      if(scenario==="databaseRace")return {data:null,error:{code:"23514",message:"NUDGE_NOT_ELIGIBLE"}};
      assert.equal(patch.recipient_user_id,"candidate");
      return {data:patch,error:null};
    }).then(ok,bad);}};return q;}};
    const route=loadFile("app/api/dating/1on1/matches/[id]/nudge/route.ts",{
      "@/lib/dating-1on1-contact-nudge":helpers,
      "@/lib/dating-blocks":{hasDatingBlockBetween:async()=>scenario==="blocked"},
      "@/lib/dating-contact-blocks":{hasDatingContactPhoneBlockBetween:async()=>false},
      "@/lib/dating-notifications":{notifyDatingUser:async(_db,payload)=>{notifications++;assert.match(payload.title,/매칭 이름님이/);assert.equal(payload.meta.match_id,"match");}},
      "@/lib/request-origin":{ensureAllowedMutationOrigin:()=>null},
      "@/lib/supabase/server":{createAdminClient:()=>db},
      "@/lib/supabase/request":{getRequestAuthContext:async()=>({user:scenario==="anonymous"?null:{id:scenario==="stranger"?"other":"source"}})},
      "@/lib/user-ban-guard":{getUserBanResponse:async()=>null},
      "@/lib/dating-swipe":{sendDatingEmailNotification:async(_db,id,subject,text)=>{emails++;assert.equal(id,"candidate");assert.match(subject,/매칭 이름님이/);assert.ok(text.includes("첫 커피는 제가 살게요 ☕"));return true;}},
    });
    const res=await route.POST(new Request("https://example.test/nudge",{method:"POST",body:JSON.stringify({presetKey:"coffee_on_me"})}),{params:Promise.resolve({id:"match"})});
    const success=["at24","after30"].includes(scenario);
    assert.equal(res.status,success?200:scenario==="stranger"?403:scenario==="anonymous"?401:409);
    assert.equal(notifications,success?1:0);assert.equal(emails,success?1:0);
    assert.equal(inserts,success||["duplicate","databaseRace"].includes(scenario)?1:0);
    if(scenario==="before24")assert.match((await res.json()).error,/24시간/);
  });
}

for(const scenario of ["before24","at24","after30","alreadySent","approved","schemaMissing","blocked"]){
  test(`actual matching list response: ${scenario}`,async()=>{
    const row=match(scenario==="before24"?{source_final_responded_at:new Date(fixedNow-24*hour+1).toISOString()}:scenario==="after30"?{source_final_responded_at:new Date(fixedNow-30*hour).toISOString()}:scenario==="approved"?{contact_exchange_status:"approved",contact_exchange_approved_at:new Date(fixedNow-47*hour).toISOString()}:{});
    const sent={match_id:"match",sender_user_id:"source",recipient_user_id:"candidate",preset_key:"coffee_on_me",message_text:"기존 한마디 ☕",created_at:new Date(fixedNow-2*hour).toISOString()};
    const db={from(table){let states;const q={select(){return q;},or(){return q;},order(){return q;},range(){return q;},in(key,values){if(key==="state")states=values;return q;},then(ok,bad){return Promise.resolve().then(()=>{
      if(table==="dating_1on1_match_proposals")return {data:states.includes(row.state)?[row]:[],error:null};
      assert.equal(table,"dating_1on1_contact_nudges");
      return scenario==="schemaMissing"?{data:null,error:{code:"PGRST205"}}:{data:scenario==="alreadySent"?[sent]:[],error:null};
    }).then(ok,bad);}};return q;}};
    const route=loadFile("app/api/dating/1on1/matches/my/route.ts",{
      "@/lib/dating-1on1-contact-nudge":helpers,
      "@/lib/dating-1on1":{getDatingOneOnOneCardsByIds:async()=>new Map([["source-card",{name:"본인"}],["candidate-card",{name:"상대"}]]),getDatingOneOnOneCardPhonesByIds:async(_db,ids)=>{if(scenario!=="approved")assert.deepEqual(ids,[]);return new Map();}},
      "@/lib/supabase/server":{createAdminClient:()=>db},
      "@/lib/supabase/request":{getRequestAuthContext:async()=>({user:{id:"source"}})},
      "@/lib/dating-blocks":{getDatingBlockedUserIds:async()=>new Set(scenario==="blocked"?["candidate"]:[])},
      "@/lib/dating-contact-blocks":{getDatingContactBlockMapForUsers:async()=>new Map(),getDatingProfilePhoneMapForUsers:async()=>new Map([["source","+821000000001"],["candidate","+821000000002"]]),isDatingContactPhoneBlockedPair:()=>false,normalizeDatingContactPhone:value=>value},
    });
    const res=await route.GET(new Request("https://example.test/matches/my"));assert.equal(res.status,200);
    const {items}=await res.json();
    if(scenario==="blocked"){assert.deepEqual(items,[]);return;}
    assert.equal(items[0].contact_nudge.can_send,["at24","after30"].includes(scenario));
    assert.equal(items[0].counterparty_phone,scenario==="approved"?"01000000002":null);
    if(scenario==="alreadySent")assert.equal(items[0].contact_nudge.sent_by_me.message_text,sent.message_text);
  });
}

test("shared UI uses 24 hours; paid/sent/hidden summaries do not reopen the send button",()=>{
  const React=require("react"),{renderToStaticMarkup}=require("react-dom/server");
  const Component=loadFile("components/dating/OneOnOneContactNudge.tsx",{"@/lib/dating-1on1-contact-nudge":helpers}).default;
  const render=nudge=>renderToStaticMarkup(React.createElement(Component,{matchId:"match",nudge,processing:false,onSend(){throw Error("Must not send while rendering");}}));
  const visible=render({available:true,can_send:true});
  assert.match(visible,/24시간/);assert.doesNotMatch(visible,/48시간/);assert.match(visible,/한마디 보내기/);
  assert.equal(render({available:true,can_send:false}),"");
  assert.equal(render({available:false,can_send:true}),"");
  assert.doesNotMatch(render({available:true,can_send:false,sent_by_me:{message_text:"이미 보낸 문구"}}),/한마디 보내기/);
});

const pglitePath=process.env.CONTACT_NUDGE_PGLITE_PATH||process.env.PRIVACY_TEST_PGLITE_PATH;
test("PostgreSQL 48→24 upgrade is repeatable, preserves messages and guards recipients/payment/duplicates",{skip:!pglitePath},async()=>{
  const {PGlite}=require(pglitePath),db=new PGlite();
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const canonical=read("supabase/sql/dating_1on1_contact_nudges.sql");
  const migration=read("supabase/sql/dating_1on1_contact_nudge_24h.sql");
  const functionText=sql=>sql.match(/create or replace function[\s\S]*?\$\$;/)[0].replace(/\r\n/g,"\n");
  assert.equal(functionText(canonical),functionText(migration));
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;
      insert into auth.users values ('${id(1)}'),('${id(2)}'),('${id(3)}');
      create table public.dating_1on1_match_proposals(id uuid primary key,source_user_id uuid,candidate_user_id uuid,state text,contact_exchange_status text,contact_exchange_paid_at timestamptz,contact_exchange_paid_by_user_id uuid,source_final_responded_at timestamptz,updated_at timestamptz,created_at timestamptz);`);
    await db.exec(canonical.replace("interval '24 hours'","interval '48 hours'"));
    const createPair=async(n,hours,extra="")=>db.exec(`insert into public.dating_1on1_match_proposals(id,source_user_id,candidate_user_id,state,contact_exchange_status,source_final_responded_at,updated_at,created_at) values ('${id(n)}','${id(1)}','${id(2)}','mutual_accepted','awaiting_applicant_payment',now()-interval '${hours} hours',now(),now()-interval '72 hours'); ${extra}`);
    const send=(n,sender=1,recipient=2)=>db.query("insert into public.dating_1on1_contact_nudges(match_id,sender_user_id,recipient_user_id,preset_key,message_text) values ($1,$2,$3,'coffee_on_me',$4)",[id(n),id(sender),id(recipient),helpers.getOneOnOneContactNudgeMessage("coffee_on_me").message]);
    await createPair(10,49);await send(10);
    await createPair(11,30);await assert.rejects(send(11),/NUDGE_NOT_ELIGIBLE/);
    await db.exec(migration);await db.exec(migration);
    assert.equal((await db.query("select count(*)::int n from public.dating_1on1_contact_nudges")).rows[0].n,1);
    await send(11);
    await db.exec("begin");
    const denied=async(fn,pattern)=>{await db.exec("savepoint test_guard");await assert.rejects(fn(),pattern);await db.exec("rollback to savepoint test_guard; release savepoint test_guard;");};
    await createPair(12,24);await send(12);await denied(()=>send(12),/dating_1on1_contact_nudges_sender_once/);await send(12,2,1);
    await createPair(13,24,`update public.dating_1on1_match_proposals set source_final_responded_at=source_final_responded_at+interval '1 millisecond' where id='${id(13)}';`);
    await denied(()=>send(13),/NUDGE_NOT_ELIGIBLE/);
    for(const [n,patch] of [[14,"state='candidate_accepted'"],[15,"contact_exchange_status='approved'"],[16,"contact_exchange_status='canceled'"],[17,"contact_exchange_paid_at=now()"],[18,`contact_exchange_paid_by_user_id='${id(1)}'`]]){
      await createPair(n,30,`update public.dating_1on1_match_proposals set ${patch} where id='${id(n)}';`);await denied(()=>send(n),/NUDGE_NOT_ELIGIBLE/);
    }
    await denied(()=>send(12,3,1),/NUDGE_PARTICIPANT_MISMATCH/);
    await denied(()=>send(999),/NUDGE_MATCH_NOT_FOUND/);
    await db.exec("commit");
    const privileges=(await db.query("select has_table_privilege('anon','public.dating_1on1_contact_nudges','INSERT') a,has_table_privilege('authenticated','public.dating_1on1_contact_nudges','INSERT') u,has_function_privilege('authenticated','public.validate_dating_1on1_contact_nudge()','EXECUTE') f")).rows[0];
    assert.deepEqual(privileges,{a:false,u:false,f:false});
  }finally{await db.close();}
});
