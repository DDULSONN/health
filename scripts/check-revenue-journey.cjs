/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic users and local PostgreSQL only. No provider calls or real messages.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, deps = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('module', 'exports', 'require', code)(mod, mod.exports, name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (name.startsWith('@/')) {
      const target = name.slice(2);
      return load(target + (fs.existsSync(path.join(root, target + '.ts')) ? '.ts' : '.tsx'), deps);
    }
    return require(name);
  });
  return mod.exports;
}

test('only a confirmed new database policy permits immediate sending; errors retain 24h', async () => {
  const { loadOneOnOneContactNudgeDelayHours: delay } = load('lib/dating-1on1-contact-nudge-policy.ts');
  for (const [data, error, expected] of [[0,null,0], [24,null,24], [null,null,24], ['0',null,24], [0,{code:'PGRST202'},24]]) {
    assert.equal(await delay({ rpc(name) { assert.equal(name,'dating_1on1_contact_nudge_delay_hours'); return { abortSignal(signal) { assert.equal(signal.aborted,false); return Promise.resolve({data,error}); } }; } }),expected);
  }
  assert.equal(await delay({rpc(){throw Error('network');}}),24);
});

test('contextual Plus excludes active plans, remaining/bonus quota, and uncertain usage', () => {
  const { shouldOfferOneOnOnePlus: show } = load('lib/dating-1on1-refresh-copy.ts');
  const exhausted = {refresh_limit:1,refresh_remaining:0,can_refresh:false,refresh_bonus_remaining:0};
  assert.equal(show(exhausted,false),true);
  for (const usage of [null,{}, {...exhausted,refresh_limit:2}, {...exhausted,refresh_remaining:1}, {...exhausted,can_refresh:true}, {...exhausted,refresh_bonus_remaining:1}, {...exhausted,refresh_remaining:undefined}]) assert.equal(show(usage,false),false);
  assert.equal(show(exhausted,true),false);
});

test('top contact offers only mount for actionable participant records and preserve source order', () => {
  const Link = ({children,href,...props}) => React.createElement('a',{href,...props},children);
  const Steps = load('components/dating/OneOnOneNextSteps.tsx', {'next/link':{default:Link}}).default;
  const matches = ['approved','awaiting_applicant_payment','paid','none','canceled'].map((status,index)=>({id:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,state:'mutual_accepted',contact_exchange_status:status,counterparty_card:{name:'상대'+index,photo_signed_urls:['/api/image/test']}}));
  const before = JSON.stringify(matches), mounted=[];
  const html=renderToStaticMarkup(React.createElement(Steps,{matches,renderContact:match=>{mounted.push(match.id);return React.createElement('button',null,'기존 교환 버튼');}}));
  assert.deepEqual(mounted,[matches[1].id,matches[3].id]);assert.equal(JSON.stringify(matches),before);
  assert.equal((html.match(/기존 교환 버튼/g)||[]).length,2);assert.match(html,/프로필 보기/);
  assert.doesNotMatch(html,/상대0|상대2|상대4/);
});

test('new entry points reuse existing locks, authority and contact callbacks', () => {
  const home=read('components/dating/OneOnOneHomePanel.tsx'),my=read('app/mypage/page.tsx');
  assert.match(home,/OneOnOneNextSteps matches=\{activeMatches\} renderContact=/);
  assert.match(home,/onExchange=\{onContactCheckout\} onNudge=\{onContactNudge\}/);
  assert.match(my,/processing=\{processingOneOnOneContactExchangeIds.includes\(match.id\)\}/);
  assert.match(my,/onExchange=\{\(id, offerId\) => void handleRequestOneOnOneContactExchange\(id, offerId\)\}/);
  assert.match(my,/oneOnOneContactCheckoutLocksRef.current.has\(matchId\)/);
  assert.match(read('app/community/dating/cards/page.tsx'),/oneOnOneContactCheckoutLocksRef.current.has\(matchId\)/);
  const landing = read('app/landing/page.tsx');
  assert.match(landing,/마음에 드는 사람에게 먼저/);
  assert.doesNotMatch(landing,/무료|20,000|결제/);
  assert.ok(landing.indexOf('className={styles.reviewSection}') < landing.indexOf('className={styles.heroBody}'));
  assert.equal((landing.match(/className=\{styles.reviewSection\}/g) || []).length, 1);
  assert.match(home,/프로필이 준비됐어요\. 마음에 드는 후보에게 먼저 요청해 보세요\./);
  assert.doesNotMatch(home,/프로필이 준비됐어요\.[^<]*(?:무료|결제)/);
});

test('immediate SQL upgrade is idempotent, private, and preserves existing sends and matching data', async () => {
  const {PGlite}=require(process.env.PRIVACY_TEST_PGLITE_PATH || process.env.CONTACT_NUDGE_PGLITE_PATH || '@electric-sql/pglite');
  const db=new PGlite(), id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const send=(n,sender=1,recipient=2)=>db.query("insert into dating_1on1_contact_nudges(match_id,sender_user_id,recipient_user_id,preset_key,message_text) values ($1,$2,$3,'want_to_exchange','저는 연락처를 교환하고 싶어요 🙂')",[id(n),id(sender),id(recipient)]);
  try {
    await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role;
      create table auth.users(id uuid primary key); insert into auth.users values ('${id(1)}'),('${id(2)}'),('${id(3)}');
      create table dating_1on1_match_proposals(id uuid primary key,source_user_id uuid,candidate_user_id uuid,state text,contact_exchange_status text,contact_exchange_paid_at timestamptz,contact_exchange_paid_by_user_id uuid,source_final_responded_at timestamptz,updated_at timestamptz,created_at timestamptz);`);
    await db.exec(read('supabase/sql/dating_1on1_contact_nudges.sql'));
    const pair=async(n,age='0 seconds',patch='')=>db.exec(`insert into dating_1on1_match_proposals values ('${id(n)}','${id(1)}','${id(2)}','mutual_accepted','awaiting_applicant_payment',null,null,clock_timestamp()-interval '${age}',now(),now()); ${patch}`);
    await pair(10,'48 hours');await send(10);
    await pair(11);await assert.rejects(send(11),/NUDGE_NOT_ELIGIBLE/);
    const snapshot=(await db.query('select * from dating_1on1_match_proposals order by id')).rows;
    const sql=read('supabase/sql/dating_1on1_contact_nudge_immediate.sql');await db.exec(sql);await db.exec(sql);
    assert.deepEqual((await db.query('select * from dating_1on1_match_proposals order by id')).rows,snapshot);
    assert.equal((await db.query('select count(*)::int n from dating_1on1_contact_nudges')).rows[0].n,1);
    await send(11);await assert.rejects(send(11),/sender_once/);await send(11,2,1);
    await assert.rejects(send(10),/sender_once/);await assert.rejects(send(11,3,1),/NUDGE_PARTICIPANT_MISMATCH/);
    await assert.rejects(send(999),/NUDGE_MATCH_NOT_FOUND/);
    for(const [n,patch] of [[12,"state='candidate_accepted'"],[13,"state=null"],[14,"contact_exchange_status='approved'"],[15,"contact_exchange_status='paid'"],[16,"contact_exchange_status='canceled'"],[17,"contact_exchange_status=null"],[18,"contact_exchange_paid_at=now()"],[19,`contact_exchange_paid_by_user_id='${id(1)}'`],[20,"source_final_responded_at=now()+interval '1 hour'"]]){
      await pair(n,'0 seconds',`update dating_1on1_match_proposals set ${patch} where id='${id(n)}';`);await assert.rejects(send(n),/NUDGE_NOT_ELIGIBLE/);
    }
    for(const role of ['anon','authenticated']) {
      assert.equal((await db.query("select has_function_privilege($1,'dating_1on1_contact_nudge_delay_hours()','EXECUTE') allowed",[role])).rows[0].allowed,false);
      assert.equal((await db.query("select has_table_privilege($1,'dating_1on1_contact_nudges','INSERT') allowed",[role])).rows[0].allowed,false);
    }
    await db.exec('set role service_role');assert.equal((await db.query('select dating_1on1_contact_nudge_delay_hours() hours')).rows[0].hours,0);await db.exec('reset role');
    await db.exec('alter table dating_1on1_contact_nudges disable trigger trg_validate_dating_1on1_contact_nudge');
    await assert.rejects(db.exec(sql),/enabled validation trigger first/);await db.exec('rollback');
  } finally {await db.close();}
});
