/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const home = read('app/community/dating/cards/page.tsx');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(p, context = {}) {
  const exports = {};
  vm.runInNewContext(compile(read(p)), { exports, module: { exports }, console, ...context });
  return exports;
}
function callback(name, ctx) {
  const ast = ts.createSourceFile('home.tsx', home, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) fn = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(fn, name);
  return vm.runInNewContext(compile('const run = ' + fn + '; run;'), ctx);
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(r => setImmediate(r));

for (const page of ['app/dating/paid/[id]/page.tsx', 'app/dating/paid/[id]/apply/page.tsx']) {
  test(`paid card free-application hint is compact and only appears after the card loads: ${page}`, () => {
    const source = read(page);
    const hint = '<p className="mt-2 text-xs leading-5 text-neutral-500">지원권 소모 없이 지원할 수 있어요.</p>';
    assert.equal(source.split(hint).length - 1, 1);
    assert.ok(source.indexOf(hint) > source.indexOf('if (loading'));
    assert.ok(source.indexOf(hint) < source.lastIndexOf('지원하기'));
    assert.doesNotMatch(source, /alert\([^)]*지원권 소모 없이/);
  });
}

function context(extra = {}) {
  const state = {};
  const ctx = { console, viewerLoggedIn: true, homeFeatureTabRef: { current: 'open_cards' }, activeSexRef: { current: 'male' }, secondaryCardsRequestRef: { current: 0 }, profilePresenceRequestRef: { current: 0 }, ...extra };
  for (const key of ['PaidItems','PaidCardsError','PaidCardsLoading','QueueStats','MoreViewStatus','MoreViewMale','MoreViewFemale','MyOpenCards','HomeProfilePresenceReady','OpenCardPresenceReady','OpenCardPresenceError','HasActiveOneOnOneProfile']) ctx['set'+key] = value => { state[key] = value; };
  return { ctx, state };
}

test('JSON read rejects network, HTTP and malformed responses rather than pretending empty success', async () => {
  for (const fetch of [async()=>{throw Error('offline');}, async()=>new Response('{}',{status:500}), async()=>new Response('broken'), async()=>new Response('null'), async()=>new Response('[]')]) {
    assert.equal(await load('lib/dating-read-json.ts', { fetch }).readDatingJson('/test'), null);
  }
  const body = await load('lib/dating-read-json.ts', { fetch: async()=>new Response('{"items":[]}') }).readDatingJson('/test');
  assert.equal(body.items.length, 0);
});
test('paid cards appear before unrelated queue/more-view requests finish', async () => {
  const queue = deferred(), more = deferred();
  const {ctx,state} = context({ readDatingJson: url => url.includes('queue-stats') ? queue.promise : url.includes('more-view') ? more.promise : Promise.resolve({ items:[{id:'paid'}] }) });
  const pending = callback('refreshSecondary', ctx)('male'); await flush();
  assert.equal(state.PaidItems[0].id, 'paid'); assert.equal(state.PaidCardsLoading,false);
  queue.resolve(null); more.resolve(null); await pending;
  assert.equal(state.PaidItems[0].id, 'paid');
});
test('late opposite-sex response cannot overwrite latest paid cards or more-view cards', async () => {
  const old = deferred();
  const {ctx,state} = context({ readDatingJson: url => url.includes('paid/list?sex=female') ? old.promise : Promise.resolve(url.includes('paid/list') ? {items:[{id:'male-card'}]} : null) });
  const run = callback('refreshSecondary', ctx);
  const first = run('female'); await run('male'); old.resolve({items:[{id:'female-card'}]}); await first;
  assert.equal(state.PaidItems[0].id, 'male-card'); assert.equal(state.PaidCardsError,'');
});
test('paid list errors remain distinguishable from empty list, and retry recovers', async () => {
  let fail = true;
  const {ctx,state} = context({readDatingJson: async url => url.includes('paid/list') && !fail ? {items:[]} : null});
  const run = callback('refreshSecondary',ctx); await run(); assert.ok(state.PaidCardsError);
  fail=false; await run(); assert.equal(state.PaidCardsError,''); assert.equal(state.PaidItems.length,0);
});
test('open-card button readiness does not wait for or depend on 1:1 status', async () => {
  const one = deferred();
  const {ctx,state} = context({readDatingJson: url => url.includes('cards/my') ? Promise.resolve({items:[{id:'open',status:'pending'}]}) : one.promise});
  const pending = callback('reloadMyOpenCards',ctx)(); await flush();
  assert.equal(state.OpenCardPresenceReady,true); assert.equal(state.MyOpenCards[0].id,'open');
  one.resolve(null); await pending; assert.equal(state.OpenCardPresenceReady,true); assert.equal(state.HomeProfilePresenceReady,false);
});
test('profile failure is retryable and late results cannot restore a signed-out profile', async () => {
  const old = deferred(); const {ctx,state} = context({readDatingJson:()=>old.promise});
  const run=callback('reloadMyOpenCards',ctx), pending=run();
  ctx.viewerLoggedIn=false; await run(); old.resolve({items:[{id:'private'}]}); await pending;
  assert.equal(state.MyOpenCards.length,0); assert.equal(state.OpenCardPresenceReady,false);
  ctx.viewerLoggedIn=true; ctx.readDatingJson=async()=>null; await run(); assert.equal(state.OpenCardPresenceError,true);
});
test('instant entry accepts existing hidden/expired profiles without changing ordinary queue', () => {
  assert.match(home,/const showOpenCardManagement =[\s\S]*?openCardPresenceReady/);
  assert.match(home,/const instantOpenCardHref =[\s\S]*?openCardPresenceReady && hasAnyOpenCardProfile/);
  assert.match(home,/currentCount=\{activeCurrentCount \+ activePaidItems.length\}/);
  assert.match(home,/openCardPresenceReady && hasAnyOpenCardProfile \? \([\s\S]*?대기 없이 등록/);
  const source=read('app/api/dating/paid/create/route.ts');
  assert.match(source,/\.in\("status", \["pending", "public", "hidden", "expired"\]\)/);
  assert.doesNotMatch(source,/from\("dating_cards"\)[\s\S]{0,80}\.(update|delete)\(/);
});

function routeFixture({ adminUser=false, user={id:'viewer',email:'test@example.invalid'}, status='resolved', target='female', blocked=[], contactBlocked=[], banned=[] }={}) {
  const future=new Date(Date.now()+86400000).toISOString();
  const rows=['M','F'].flatMap(g=>['instant_public','priority_24h'].map(mode=>({ id:g+mode,user_id:g+mode,gender:g,display_mode:mode,status:'approved',expires_at:future,created_at:future,paid_at:future,photo_paths:[] })));
  rows.push({...rows[0],id:'expired',expires_at:'2000-01-01T00:00:00Z'}, {...rows[1],id:'pending',status:'pending'});
  const queries=[];
  const admin={from(table){
    let result=table==='profiles' ? rows.map(row=>({user_id:row.user_id,is_banned:banned.includes(row.user_id),phone_verified:true})) : [...rows];
    const q={select(){return q;},eq(k,v){queries.push([k,v]);result=result.filter(r=>r[k]===v);return q;},gt(k,v){result=result.filter(r=>r[k]>v);return q;},in(k,values){result=result.filter(r=>values.includes(r[k]));return q;},then(resolve){return Promise.resolve({data:result,error:null}).then(resolve);}};
    return q;
  }};
  const deps={
    '@/lib/supabase/request':{getRequestAuthContext:async()=>({user})}, '@/lib/supabase/server':{createAdminClient:()=>admin},
    '@/lib/admin':{isAllowedAdminUser:()=>adminUser}, '@/lib/dating-viewer-sex':{normalizeDatingSex:s=>['male','female'].includes(s)?s:null,resolveDatingViewerSex:async()=>({status,targetSex:target})},
    '@/lib/dating-blocks':{getDatingBlockedUserIds:async()=>new Set(blocked)}, '@/lib/dating-contact-blocks':{filterDatingCardsByContactBlocks:async(_a,_u,cards)=>cards.filter(c=>!contactBlocked.includes(c.user_id))},
    '@/lib/request-rate-limit':{extractClientIp:()=>'',checkRouteRateLimit:async()=>({allowed:true})}, '@/lib/throttled-task':{shouldRunAtMostEvery:async()=>false},
    '@/lib/images':{}, '@/lib/edge-kv':{}, '@/lib/dating-blur-thumb':{}, 'next/server':{NextResponse:{json:(body,{status})=>({status,body})}},
  };
  const route=load('app/api/dating/paid/list/route.ts',{require:name=>{assert.ok(deps[name],name);return deps[name];},crypto:require('node:crypto').webcrypto,URL, console:{log(){},error(){}}});
  return {run:sex=>route.GET(new Request('https://example.invalid/api/dating/paid/list?sex='+sex)),queries};
}
test('paid list includes instant cards, priority first, excluding unpaid and expired', async()=>{
  const result=await routeFixture({user:null}).run('male'); assert.equal(result.status,200);
  assert.deepEqual(Array.from(result.body.items,i=>i.id),['Mpriority_24h','Minstant_public']);
});
test('ordinary member cannot override opposite-sex visibility through query',async()=>{
  const result=await routeFixture().run('male'); assert.ok(result.body.items.every(i=>i.gender==='F')); assert.equal(result.body.items.length,2);
});
test('allowlisted admin can inspect either sex, without needing their own profile',async()=>{
  for(const sex of ['male','female']) { const result=await routeFixture({adminUser:true,status:'missing',target:null}).run(sex); assert.equal(result.body.items.length,2); assert.ok(result.body.items.every(i=>i.gender===(sex==='male'?'M':'F'))); }
});
test('missing or unavailable member sex still fails closed',async()=>{
  const missing=await routeFixture({status:'missing',target:null}).run('male'); assert.equal(missing.body.items.length,0);
  const unavailable=await routeFixture({status:'unavailable',target:null}).run('male'); assert.equal(unavailable.status,503);
});
test('ban and both block mechanisms remain effective for paid cards',async()=>{
  for(const rule of ['blocked','contactBlocked','banned']) { const result=await routeFixture({[rule]:['Finstant_public']}).run('female'); assert.equal(result.body.items.length,1); assert.equal(result.body.items[0].id,'Fpriority_24h'); }
});
test('same-page apply navigation reacts to search params; instant cards are not filtered out',()=>{
  const source=read('app/dating/paid/page.tsx');
  assert.match(source,/useSearchParams\(\)/); assert.match(source,/\[requestedEditId, shouldOpenForm, shouldReuseOpenCard\]/);
  assert.match(source,/if \(cancelled\) return;/); assert.doesNotMatch(source,/items\.filter\(\(item\) => item\.display_mode !== "instant_public"\)/);
  assert.match(source,/isEditMode \? "PATCH" : "POST"/); assert.match(source,/if \(isEditMode\) \{[\s\S]*?return;[\s\S]*?productType: "paid_card"/);
});

test('late initial list cannot switch the active tab back or start an obsolete paid read',async()=>{
  const old=deferred(), refreshed=[], values={};
  const ctx={console,initialCardsRequestRef:{current:0},secondaryCardsRequestRef:{current:0},activeSexRef:{current:'female'},loadedOpenCardSexesRef:{current:{male:false,female:false}},
    fetchBySex:sex=>sex==='female'?old.promise:Promise.resolve({items:[{id:'male'}],audience:{targetSex:'male',canSwitchSex:true}}),refreshSecondary:sex=>refreshed.push(sex)};
  for(const key of ['Loading','CardsAudience','ViewerSexError','ActiveSex','Males','Females','MaleHasMore','FemaleHasMore','MaleCursorCreatedAt','MaleCursorId','FemaleCursorCreatedAt','FemaleCursorId'])ctx['set'+key]=value=>{values[key]=value;};
  const run=callback('loadInitial',ctx), first=run({sex:'female'});await run({sex:'male'});old.resolve({items:[{id:'female'}],audience:{targetSex:'female',canSwitchSex:true}});await first;
  assert.equal(values.ActiveSex,'male');assert.equal(ctx.activeSexRef.current,'male');assert.deepEqual(refreshed,['male']);
});
test('existing fulfillment still approves once for 36 hours without touching ordinary cards',async()=>{
  const source=read('lib/dating-purchase-fulfillment.ts'), ast=ts.createSourceFile('fulfill.ts',source,ts.ScriptTarget.Latest,true);
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='approvePaidCard');assert.ok(fn);
  const approve=vm.runInNewContext(compile(fn.getText(ast).replace(/^export /,'')+';approvePaidCard;'),{Date,DATING_PAID_FIXED_MS:36*3600000,isMissingColumnError:()=>false});
  for(const displayMode of ['instant_public','priority_24h']) {
    const row={id:'paid',status:'pending',display_mode:displayMode};let mutations=0;
    const admin={from(table){assert.equal(table,'dating_paid_cards');let patch,filters=[];const q={update(p){patch=p;return q;},eq(k,v){filters.push([k,v]);return q;},select(){return q;},async maybeSingle(){if(!filters.every(([k,v])=>row[k]===v))return {data:null,error:null};Object.assign(row,patch);mutations++;return {data:{...row},error:null};}};return q;}};
    const result=await approve(admin,{paidCardId:'paid',displayMode});assert.equal(result.status,'approved');assert.equal(result.display_mode,displayMode);
    assert.equal(Date.parse(result.expires_at)-Date.parse(result.paid_at),36*3600000);
    assert.equal(await approve(admin,{paidCardId:'paid',displayMode}),null);assert.equal(mutations,1);
  }
});

test('paid submit locks synchronously before auth; early steps/loading never submit and failures unlock',async()=>{
  const source=read('app/dating/paid/page.tsx'),ast=ts.createSourceFile('paid.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let fn;const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='submitPaidRequest')fn=node.initializer.getText(ast);ts.forEachChild(node,visit);};visit(ast);assert.ok(fn);
  const pending=deferred();let calls=0;
  let error='';
  const ctx={submissionInFlightRef:{current:false},editLoading:false,sourcePrefillLoading:false,formStep:4,PAID_FORM_STEPS:[1,2,3,4],setError:value=>{error=value;},performPaidRequest:async()=>{calls++;await pending.promise;}};
  const run=vm.runInNewContext(compile('const run='+fn+';run;'),ctx);
  const first=run('kakaopay');await run('kakaopay');assert.equal(calls,1);pending.resolve();await first;assert.equal(ctx.submissionInFlightRef.current,false);
  for(const flag of ['editLoading','sourcePrefillLoading']){ctx[flag]=true;await run('manual');ctx[flag]=false;}ctx.formStep=3;await run('kakaopay');assert.equal(calls,1);
  ctx.formStep=4;ctx.performPaidRequest=async()=>{throw Error('auth unavailable');};await run('kakaopay');assert.ok(error);assert.equal(ctx.submissionInFlightRef.current,false);
  assert.match(source,/<button key="next-step" type="button"/);assert.match(source,/<button key="submit-request" type="submit"/);
});
