/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const prefix = 'gymtools:growth:v1:';
// Exact LF-normalized baselines, also available in shallow/no-Git deployment builds.
// c2b090b except the reviewed open-card save guards covered by check-site-audit-fixes.cjs.
// Onboarding photo transport/diagnostics reviewed separately; actual failure/retry and
// post-success registration payloads are exercised by check-dating-photo-upload-browser.cjs.
const baselines = {
 'app/onboarding/dating/page.tsx': '66520ae237626657e432e818fffe3efab30e51ceada5c69d665a7e18110f7463',
 'app/dating/1on1/page.tsx': '4594d2f8d889979fc2a10ea59cf701a5ec5c67ad23900d68bb9ab77d298102bc',
 'app/community/dating/cards/new/page.tsx': '89363bb447feb8d0d0793b02cfafd67338b62e87473165c56ac38cfd44c63299',
 'app/api/dating/cards/my/route.ts': 'b832effc2aeb9fb3918b040bf8cf70e7e31c698c02e6ee14628543d3d9642412',
 'app/api/dating/1on1/cards/route.ts': '498240e6c2b59b9fcf2737c6cc756cbfc2f6cc003066e7fa0bf9bdd9dc24a846',
 'app/api/payments/toss/create/route.ts': 'a6d250de0ca3dbc374a988815f80622d0c9331382e5507746fd5ec2c52ced60a',
 'app/api/payments/toss/confirm/route.ts': '149d69aa46a589562084bd0c0f01e1c612c00211ea2cfed5e0c5bdcaf6cb0172',
 'app/api/mypage/phone-verification/verify/route.ts': '7c756c3da7120f347204e331be3d4f91e37927ab3e3a2e25c6cfec4f81f0e84c',
 'app/auth/callback/complete/route.ts': '93bbde005e7bf2805ee4f5357192906a6651e0f7ccaf8f437a12ad8cff5b6666',
 'supabase/sql/referral_rewards.sql': 'c2def45e4f69a930ca8c1ff5b3992e5cb4be3c1c6ecaa1ac4beaba3bbdbaf98f',
};
const hash = text => createHash('sha256').update(text).digest('hex');
function setup(shared = new Map()) {
  let now = 1900000000000;
  const events = [], emitted = [];
  const storage = { getItem:k=>shared.get(k)??null, setItem:(k,v)=>shared.set(k,v), removeItem:k=>shared.delete(k) };
  const win = { location:{ search:'', origin:'https://helchang.com' }, gtag:(...args)=>events.push(args), dispatchEvent:e=>emitted.push(e.type) };
  const context = { window:win, localStorage:storage, URLSearchParams, Event, Date:class extends Date { static now() { return now; } }, module:{exports:{}}, exports:{} };
  context.exports = context.module.exports;
  vm.runInNewContext(ts.transpileModule(read('lib/growth-analytics.ts'), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }).outputText, context);
  const api=context.module.exports;
  return { api, events, emitted, storage, shared, win, context, get now(){return now;}, advance:n=>now+=n, user:(id='a',extra={})=>({id,created_at:new Date(now).toISOString(),email_confirmed_at:new Date(now).toISOString(),...extra}) };
}
test('only registered UTM tuples are retained, no arbitrary URL/PII/form values',()=>{
 const s=setup();
 for(const q of ['?utm_campaign=person@example.com','?utm_campaign=ig_reel_a&utm_source=other&utm_medium=organic_social','?utm_campaign=__proto__','?utm_campaign=constructor']) s.api.captureGrowthCampaign(q);
 assert.equal(s.shared.size,0);
 s.api.captureGrowthCampaign('?utm_campaign=ig_reel_a&utm_source=instagram&utm_medium=organic_social&email=private@example.com&token=SECRET');
 s.api.trackInviteAction('credits_empty','open');
 assert.equal(s.events[0][2].growth_campaign,'ig_reel_a');
 assert.ok(!JSON.stringify([...s.shared,...s.events]).includes('private')); assert.ok(!JSON.stringify(s.events).includes('SECRET'));
 assert.equal(s.events[0][2].page_location,'https://helchang.com/');
 assert.equal(s.events[0][2].page_referrer,'');
});
test('campaign expiry and direct returns do not perpetually reset attribution',()=>{
 const s=setup(); s.api.captureGrowthCampaign('?utm_campaign=ig_creator_01&utm_source=instagram&utm_medium=creator');
 s.advance(29*86400000);s.api.captureGrowthCampaign('');s.api.captureGrowthCampaign('?utm_campaign=ig_creator_01&utm_source=instagram&utm_medium=creator');
 s.advance(2*86400000);s.api.trackInviteAction('mypage','copy');assert.equal(s.events[0][2].growth_campaign,'unattributed');
});
test('email signup request differs from verified signup; bound account and refresh dedupe',()=>{
 const s=setup(); s.api.beginGrowthSignup('email'); const user=s.user('private-id',{email_confirmed_at:null});
 s.api.recordGrowthEmailSignup(user);assert.deepEqual(s.events.map(x=>x[1]),['signup_started','signup_requested']);
 s.api.confirmGrowthSignup({...user,email_confirmed_at:new Date(s.now).toISOString()});s.api.confirmGrowthSignup({...user,email_confirmed_at:'yes'});
 assert.equal(s.events.filter(x=>x[1]==='sign_up').length,1); assert.ok(!JSON.stringify(s.events).includes('private-id'));
 const next=setup(s.shared);next.api.confirmGrowthSignup({...user,email_confirmed_at:'yes'});assert.equal(next.events.length,0);
});
test('existing OAuth accounts, stale and failed signup attempts never become new signups',()=>{
 for(const method of ['google','apple']) {
  const s=setup();s.api.beginGrowthSignup(method);s.api.confirmGrowthSignup(s.user('old',{created_at:new Date(s.now-86400000).toISOString()}));assert.equal(s.events.filter(x=>x[1]==='sign_up').length,0);
  s.api.beginGrowthSignup(method);s.advance(2*86400000);s.api.confirmGrowthSignup(s.user());assert.equal(s.events.filter(x=>x[1]==='sign_up').length,0);
  s.api.beginGrowthSignup(method);s.api.cancelGrowthSignup();s.api.confirmGrowthSignup(s.user());assert.equal(s.events.filter(x=>x[1]==='sign_up').length,0);
 }
 const s=setup();s.api.beginGrowthSignup('email');s.api.recordGrowthEmailSignup(s.user('old',{created_at:new Date(s.now-1000).toISOString()}));assert.equal(s.events.length,1);
});
test('new social signup confirmed after redirect; no auth network calls needed',()=>{
 for(const method of ['google','apple']) {
  const s=setup();s.api.beginGrowthSignup(method);const next=setup(s.shared);next.advance(1000);next.api.setGrowthUser(next.user());next.api.setGrowthUser(next.user());assert.equal(next.events.filter(x=>x[1]==='sign_up').length,1);
 }
});
test('profile events separate targets, dedupe per account; completion prompt has owner/expiry/close checks',()=>{
 const s=setup();s.api.setGrowthUser(s.user());
 for(const kind of ['open_card','one_on_one','one_on_one'])s.api.recordGrowthProfileCreated(kind,'a');
 assert.equal(s.events.length,2);assert.equal(s.api.shouldShowCompletionInvite('a'),true);assert.equal(s.api.shouldShowCompletionInvite('b'),false);
 s.api.recordGrowthProfileCreated('one_on_one','b');assert.equal(s.events.length,2);
 s.api.setGrowthUser(s.user('b'));assert.equal(s.api.shouldShowCompletionInvite('b'),false);
 s.api.recordGrowthProfileCreated('one_on_one','b');assert.equal(s.events.length,3);
 s.api.dismissCompletionInvite();assert.equal(s.api.shouldShowCompletionInvite('b'),false);
 s.api.recordGrowthProfileCreated('one_on_one','b');s.advance(86400000);assert.equal(s.api.shouldShowCompletionInvite('b'),false);
});
test('blocked storage, broken JSON, missing/throwing analytics never interrupt registration',()=>{
 const s=setup();s.shared.set(prefix+'events','{bad');
 s.context.localStorage={getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}};
 s.win.gtag=()=>{throw Error('analytics failed');};
 assert.doesNotThrow(()=>{s.api.beginGrowthSignup('email');s.api.recordGrowthEmailSignup(s.user());s.api.recordGrowthProfileCreated('one_on_one','a');s.api.cancelGrowthSignup();});
 assert.equal(s.api.shouldShowCompletionInvite('a'),true);
 delete s.win.gtag;s.api.trackInviteAction('mypage','copy');s.api.dismissCompletionInvite();assert.equal(s.api.shouldShowCompletionInvite('a'),false);
});
test('timestamps in future or malformed stored payloads fail closed',()=>{
 for(const payload of [null,[],{userId:'a',at:Infinity},{userId:'a',at:1900000000001},{userId:'a',at:'1900000000000'}]) {
  const s=setup();s.shared.set(prefix+'invite',JSON.stringify(payload));assert.equal(s.api.shouldShowCompletionInvite('a'),false);
 }
});
test('reviewed registration guards preserve post-success analytics; redirects/payments/auth APIs unchanged',()=>{
 for(const p of ['app/onboarding/dating/page.tsx','app/dating/1on1/page.tsx','app/community/dating/cards/new/page.tsx']){
  const normalized=read(p).replace(/^import \{ recordGrowthProfileCreated \} from "@\/lib\/growth-analytics";\n/m,'')
   .replace(/^\s*recordGrowthProfileCreated\([^\n]+\);\n/gm,'').replace(/^      if \(!isEditMode\) recordGrowthProfileCreated\([^\n]+\);\n/gm,'');
  assert.equal(hash(normalized),baselines[p],p);
 }
 for(const p of ['app/api/dating/cards/my/route.ts','app/api/dating/1on1/cards/route.ts','app/api/payments/toss/create/route.ts','app/api/payments/toss/confirm/route.ts','app/api/mypage/phone-verification/verify/route.ts','app/auth/callback/complete/route.ts','supabase/sql/referral_rewards.sql'])assert.equal(hash(read(p)),baselines[p],p);
 assert.match(read('app/community/dating/cards/[id]/apply/page.tsx'),/errorCode === "DAILY_APPLY_LIMIT"[\s\S]+placement="credits_empty"/);
 assert.ok(!/fetch\(|setInterval|auth\.getUser|auth\.getSession/.test(read('components/GrowthPrompts.tsx')));
});
