/* eslint-disable @typescript-eslint/no-require-imports */
// All writes, payment confirmations, emails and SMS in this file are isolated fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { test } = require('node:test');
const { NextResponse } = require('next/server');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function loader(overrides = {}) {
  const cache = new Map();
  return function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === 'server-only') return {};
    if (!name.startsWith('@/')) return require(name);
    if (cache.has(name)) return cache.get(name).exports;
    const mod = { exports: {} }; cache.set(name, mod);
    new Function('require','module','exports',compile(read(name.slice(2)+'.ts')))(load, mod, mod.exports);
    return mod.exports;
  };
}
// Execute the actual function body when isolating payment-provider boundaries.
function actualFunction(file, name, bindings) {
  const text = read(file), ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(declaration, name);
  const mod = { exports: {} };
  return new Function('module','exports', ...Object.keys(bindings), compile(declaration.getText(ast)) + `\nreturn ${name};`)(mod, mod.exports, ...Object.values(bindings));
}
const age = loader()('@/lib/dating-age');
const pairAge = loader()('@/lib/dating-1on1-age');
const year2026 = Date.parse('2026-09-20T00:00:00Z');
test('published 19+ birth-year boundary is KST-based, including year rollover', () => {
  assert.equal(age.getMaxDatingBirthYear(year2026), 2007);
  assert.equal(age.getMaxDatingBirthYear(Date.parse('2026-12-31T14:59:59Z')), 2007);
  assert.equal(age.getMaxDatingBirthYear(Date.parse('2026-12-31T15:00:00Z')), 2008);
  assert.equal(age.getMaxDatingBirthYear(Date.parse('2031-01-01T00:00:00Z')), 2012);
});
for (const input of [null, undefined, '', ' ', '20', '2008', 2008, 2010, 1959, 9999, 1996.1, '1996.0', '1.996e3', '0x7cc', true, {}, [], NaN, Infinity]) {
  test(`reject malformed/underage birth year: ${String(input)}`, () => assert.equal(age.parseDatingBirthYear(input, year2026), null));
}
test('valid existing adults and trimmed 4-digit strings retain eligibility', () => {
  for (const input of [1960, 1996, 2007, '1960', ' 2007 ']) assert.equal(age.parseDatingBirthYear(input, year2026), Number(input));
  assert.match(age.getDatingBirthYearErrorMessage(year2026), /만 19세.*1960~2007/);
  assert.doesNotMatch(age.getDatingBirthYearErrorMessage(year2026), /\uFFFD/);
});

function database(tables, fail = () => false) {
  const calls = [];
  return { calls, async rpc(name) { calls.push({ op:'rpc', name }); return { data: [{ allowed:true, used_count:1, remaining_count:0 }], error:null }; }, from(table) {
    const state = { table, op:'read', fields:'*', filters:[] }; const q = {};
    for (const method of ['eq','neq','in','is','gte','lte','gt','order','limit','range','or']) q[method] = (...args) => { state.filters.push([method,...args]); return q; };
    q.select = fields => { state.fields = fields; return q; };
    for (const op of ['insert','update','delete']) q[op] = patch => { state.op = op; state.patch = patch; return q; };
    q.single = q.maybeSingle = () => { state.single = true; return q; };
    q.then = (ok, bad) => Promise.resolve().then(() => {
      calls.push(structuredClone(state));
      if (fail(state)) return { data:null, error:{ code:'XX000', message:'fixture unavailable' } };
      let rows = (tables[table] ?? []).filter(row => state.filters.every(([op,k,v]) => op==='eq'||op==='is' ? row[k]===v : op==='neq' ? row[k]!==v : op==='in' ? v.includes(row[k]) : true));
      if (state.op==='update') rows.forEach(row => Object.assign(row,state.patch));
      if (state.op==='insert') { rows = [{ id:'new',...state.patch }]; (tables[table] ??= []).push(...rows); }
      return { data: state.single ? rows[0] ?? null : rows, error:null };
    }).then(ok,bad);
    return q;
  } };
}
const pair = { id:'match', source_card_id:'source', candidate_card_id:'candidate', source_user_id:'self', candidate_user_id:'other', state:'mutual_accepted', contact_exchange_status:'none' };
function fixture(year = 1996) { return {
  dating_1on1_cards: [{ id:'source',user_id:'self',birth_year:year,status:'submitted',admin_tags:[],photo_paths:['cards/self/a','cards/self/b'] }, {id:'candidate',user_id:'other',birth_year:1998,status:'submitted'}],
  dating_1on1_match_proposals:[{...pair}], profiles:[{user_id:'self',phone_verified:true,phone_e164:'+821000000001'}],
}; }
const writes = db => db.calls.filter(c => c.op !== 'read');
function apiLoader(db, userId = 'self') {
  return loader({
    '@/lib/supabase/server': { createAdminClient:()=>db, createClient: async()=>({auth:{getUser:async()=>({data:{user:{id:userId}}})}}) },
    '@/lib/supabase/request': {getRequestAuthContext:async()=>({user:userId?{id:userId}:null})},
    '@/lib/admin': {isAllowedAdminUser:()=>true},
    '@/lib/admin-route': {requireAdminRoute:async()=>({ok:true,admin:db,user:{id:userId}})},
    '@/lib/admin-audit': {recordAdminAuditEvent:async()=>{}},
    '@/lib/request-origin': {ensureAllowedMutationOrigin:()=>null},
    '@/lib/user-ban-guard': {getUserBanResponse:async()=>null},
    '@/lib/dating-1on1': { DATING_ONE_ON_ONE_ACTIVE_STATUSES:['submitted','reviewing','approved'],getDatingOneOnOneWriteStatus:async()=>'approved',getProfilePhoneVerification:async()=>({phoneVerified:true,phoneE164:'+821000000001'}),getDatingOneOnOneCardsByIds:async()=>new Map(),isDatingOneOnOneLegacyPhoneShareMatch:()=>false },
    '@/lib/dating-1on1-identity': {reconcileOneOnOnePhoneIdentity:async()=>({archivedCardCount:0,conflictingVerifiedOwner:false})},
    '@/lib/images': {extractStorageObjectPathFromBuckets:value=>value, buildSignedImageUrl:()=>''},
    '@/lib/dating-1on1-metrics': {recordOneOnOneMetricEvent:async()=>{}},
    '@/lib/dating-1on1-plus': {getActiveOneOnOnePlus:async()=>null,ONE_ON_ONE_FREE_REFRESH_LIMIT:1,ONE_ON_ONE_PLUS_REFRESH_LIMIT:2},
    '@/lib/dating-blocks': {hasDatingBlockBetween:async()=>false},
    '@/lib/dating-contact-blocks': {hasDatingContactPhoneBlockBetween:async()=>false,normalizeDatingContactPhone:value=>value},
    '@/lib/dating-notifications': {notifyDatingUser:async()=>{}},
    '@/lib/dating-swipe': {sendDatingEmailNotification:async()=>{}},
    '@/lib/dating-1on1-sms': {sendOneOnOneSelectionSms:async()=>{}},
    '@/lib/dating-email-templates': {buildOneOnOneSelectionReceivedNotification:()=>({}),buildOneOnOneAcceptedNotification:()=>({})},
  });
}
const request = (body, method='POST', url='http://localhost/api/test') => new Request(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const payload = year => ({ id:'source',expected_user_id:'self',sex:'male',name:'테스트',birth_year:year,height_cm:175,job:'직장인',region:'경기도 안양시',intro_text:'테스트 소개',strengths_text:'성실함',preferred_partner_text:'존중',smoking:'non_smoker',workout_frequency:'3_4',status:'submitted',photo_paths:['cards/self/a','cards/self/b'],consent_fake_info:true,consent_no_show:true,consent_fee:true,consent_privacy:true,consent_no_direct_contact:true });
const params = id => ({params:Promise.resolve({id})});

test('pair guard checks both ages, ownership, missing rows and read failure', async()=>{
  assert.equal(await pairAge.isOneOnOnePairAgeEligible(database(fixture()),pair),true);
  for (const side of [0,1]) { const tables=fixture();tables.dating_1on1_cards[side].birth_year=2010;assert.equal(await pairAge.isOneOnOnePairAgeEligible(database(tables),pair),false); }
  assert.equal(await pairAge.isOneOnOnePairAgeEligible(database({}),pair),false);
  assert.equal(await pairAge.isOneOnOnePairAgeEligible(database(fixture()),{...pair,source_user_id:'stranger'}),false);
  await assert.rejects(pairAge.isOneOnOnePairAgeEligible(database(fixture(),()=>true),pair));
});
for (const [name,file,method] of [['create','app/api/dating/1on1/cards/route','POST'],['edit','app/api/dating/1on1/my/route','PATCH'],['admin edit','app/api/admin/dating/1on1/cards/[id]/route','PATCH']]) {
  test(`${name}: actual route rejects underage and malformed input without mutation`,async()=>{
    for (const input of [2010,age.getMaxDatingBirthYear()+1,'1996.0',1996.4,null]) {
      const tables=fixture();if(name==='create') tables.dating_1on1_cards=[];
      const db=database(tables), route=apiLoader(db)('@/'+file);
      const res=await route[method](request(payload(input),method),params('source'));
      assert.equal(res.status,400,`${name}/${input}`);assert.equal(writes(db).length,0);
      if(name==='create') assert.equal(db.calls.length,0);
    }
  });
  test(`${name}: eligible boundary can still be saved`,async()=>{
    const tables=fixture();if(name==='create') tables.dating_1on1_cards=[];
    const db=database(tables),route=apiLoader(db)('@/'+file);
    const res=await route[method](request(payload(age.getMaxDatingBirthYear()),method),params('source'));
    assert.ok([200,201].includes(res.status),`${name}: ${res.status} ${JSON.stringify(await res.json())}`);
    assert.ok(writes(db).some(c=>c.patch.birth_year===age.getMaxDatingBirthYear()));
  });
}
test('restore and refresh reject old ineligible cards before identity changes or quota consumption',async()=>{
  for(const [file,method,body,url] of [['my','PUT',{},'http://localhost/api/test?id=source'],['recommendations/refresh','POST',{source_card_id:'source'},'http://localhost/api/test']]) {
    const db=database(fixture(2010)),route=apiLoader(db)('@/app/api/dating/1on1/'+file+'/route');
    const res=await route[method](request(body,method,url));assert.ok([403,409].includes(res.status));assert.equal(writes(db).length,0);
  }
});
test('new selection/acceptance of old proposals is blocked, but rejecting them still works',async()=>{
  for(const action of ['select_candidate','candidate_accept','source_accept','candidate_reject']) {
    const tables=fixture(2010);tables.dating_1on1_match_proposals[0].state=action==='select_candidate'?'proposed':action==='source_accept'?'candidate_accepted':'source_selected';
    const db=database(tables),route=apiLoader(db,action.startsWith('candidate')?'other':'self')('@/app/api/dating/1on1/matches/[id]/route');
    const res=await route.POST(request({action}),params('match'));
    assert.equal(res.status,action==='candidate_reject'?200:409,action);
    if(action!=='candidate_reject') assert.equal(writes(db).length,0);
  }
});
test('normal adult selection remains successful',async()=>{
  const tables=fixture();tables.dating_1on1_match_proposals[0].state='proposed';
  const db=database(tables),route=apiLoader(db)('@/app/api/dating/1on1/matches/[id]/route');
  assert.equal((await route.POST(request({action:'select_candidate'}),params('match'))).status,200);
  assert.equal(tables.dating_1on1_match_proposals[0].state,'source_selected');
});
for(const admin of [false,true]) test(`${admin?'admin':'member'} contact exchange checks ages before changing approval`,async()=>{
  for(const year of [1996,2010]) {
    const db=database(fixture(year)),route=apiLoader(db)(`@/app/api/${admin?'admin/':''}dating/1on1/matches/[id]/contact-exchange/route`);
    const res=await route.POST(request({action:'approve'}),params('match'));
    assert.equal(res.status,year===2010?409:200);
    if(year===2010) assert.equal(writes(db).length,0);
  }
});
for(const kind of ['toss','store/plus']) test(`${kind} fulfillment validates age but preserves approved retry idempotence`,async()=>{
  const fn=kind==='toss'?actualFunction('app/api/payments/toss/confirm/route.ts','ensureOneOnOneExchangeFulfilled',{...pairAge,...age}):actualFunction('lib/dating-purchase-fulfillment.ts','grantOneOnOneContactExchange',{...pairAge,...age});
  for(const year of [1996,2010]) {
    const db=database(fixture(year));
    const input=kind==='toss'?{product_ref_id:'match',user_id:'self',toss_order_id:'fixture-order'}:{matchId:'match',userId:'self'};
    if(year===2010) { await assert.rejects(fn(db,input),/연령/);assert.equal(writes(db).length,0); }
    else { await fn(db,input);assert.ok(writes(db).some(c=>c.patch?.contact_exchange_status==='approved')); }
    const tables=fixture(year);tables.dating_1on1_match_proposals[0].contact_exchange_status='approved';
    assert.equal((await fn(database(tables),input)).alreadyApproved,true);
  }
});
test('old ready Toss orders cannot reach provider confirmation when age is ineligible',async()=>{
  const fn=actualFunction('app/api/payments/toss/confirm/route.ts','POST',{
    ...pairAge,...age,ensureAllowedMutationOrigin:()=>null,getRequestAuthContext:async()=>({user:{id:'self'}}),isTossConfigured:()=>true,
    toAmount:Number,json:(status,body)=>NextResponse.json(body,{status}),
    createAdminClient:()=>{const tables=fixture(2010);tables.toss_test_payment_orders=[{id:'order',user_id:'self',product_type:'one_on_one_contact_exchange',product_ref_id:'match',toss_order_id:'order',amount:100,status:'ready'}];return database(tables);},
    confirmOrRecoverTossPayment:async()=>{throw Error('PROVIDER_MUST_NOT_BE_CALLED');},
  });
  const res=await fn(request({paymentKey:'fixture',orderId:'order',amount:100}));
  assert.equal(res.status,409);assert.equal((await res.json()).code,'DATING_AGE_INELIGIBLE');
});

for (const plus of [false,true]) test(`actual checkout route: age guard precedes ${plus?'Plus approval':'order creation'}, eligible adults still succeed`,async()=>{
  for (const year of [1996,2010]) {
    const db=database(fixture(year));let providerCalls=0;
    const fulfill=actualFunction('lib/dating-purchase-fulfillment.ts','grantOneOnOneContactExchange',{...pairAge,...age});
    const fn=actualFunction('app/api/payments/toss/create/route.ts','POST',{
      ...pairAge,...age,ensureAllowedMutationOrigin:()=>null,getRequestAuthContext:async()=>({user:{id:'self'}}),isTossConfigured:()=>true,
      json:(status,body)=>NextResponse.json(body,{status}),createAdminClient:()=>db,
      parseProductType:value=>value,PRODUCT_CONFIG:{one_on_one_contact_exchange:{amount:100,orderName:'테스트 번호 교환'}},
      getActiveOneOnOnePlus:async()=>plus?{contact_exchange_included:true,expires_at:'2099-01-01'}:null,
      grantOneOnOneContactExchange:fulfill,cancelReadyOrders:async(_admin,ids)=>assert.deepEqual(ids,[]),
      cleanText:value=>String(value??'').trim(),getBaseUrl:()=> 'http://localhost',getTossCheckoutOptions:()=>({}),getTossCheckoutMode:()=> 'fixture',
      createTossPayment:async()=>{providerCalls++;return {checkout:{url:'https://example.invalid/checkout'}};},
      TossApiError:class extends Error {},
    });
    const res=await fn(request({productType:'one_on_one_contact_exchange',matchId:'match'}));
    const body=await res.json();assert.equal(res.status,year===2010?409:200,JSON.stringify(body));
    if(year===2010) {assert.equal(body.code,'DATING_AGE_INELIGIBLE');assert.equal(writes(db).length,0);}
    else if(plus) {assert.equal(body.coveredByPlus,true);assert.ok(writes(db).some(c=>c.patch?.contact_exchange_status==='approved'));}
    else {assert.equal(body.amount,100);assert.equal(body.checkoutUrl,'https://example.invalid/checkout');assert.ok(writes(db).some(c=>c.table==='toss_test_payment_orders'&&c.op==='insert'));}
    assert.equal(providerCalls,year===1996&&!plus?1:0);
  }
});

test('normal adult payment confirmation and paid retry preserve approval and charge only once',async()=>{
  const tables=fixture();tables.toss_test_payment_orders=[{id:'order',user_id:'self',product_type:'one_on_one_contact_exchange',product_ref_id:'match',toss_order_id:'order',amount:100,status:'ready'}];
  const db=database(tables);let providerCalls=0;
  const fulfill=actualFunction('app/api/payments/toss/confirm/route.ts','ensureOneOnOneExchangeFulfilled',{...pairAge,...age});
  const fn=actualFunction('app/api/payments/toss/confirm/route.ts','POST',{
    ...pairAge,...age,ensureAllowedMutationOrigin:()=>null,getRequestAuthContext:async()=>({user:{id:'self'}}),isTossConfigured:()=>true,
    toAmount:Number,json:(status,body)=>NextResponse.json(body,{status}),createAdminClient:()=>db,
    confirmOrRecoverTossPayment:async()=>{providerCalls++;return {method:'CARD'};},
    ensureOrderFulfilled:async(admin,order)=>{await fulfill(admin,order);return {};},
    TossApiError:class extends Error {},
  });
  const body={paymentKey:'fixture',orderId:'order',amount:100};
  let res=await fn(request(body));assert.equal(res.status,200,JSON.stringify(await res.json()));
  assert.equal(tables.dating_1on1_match_proposals[0].contact_exchange_status,'approved');
  assert.equal(tables.toss_test_payment_orders[0].status,'paid');
  res=await fn(request(body));assert.equal(res.status,200);assert.equal((await res.json()).alreadyConfirmed,true);
  assert.equal(providerCalls,1);
});
