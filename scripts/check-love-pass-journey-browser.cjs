/* eslint-disable @typescript-eslint/no-require-imports */
// Real purchase/return screens and handlers, PGlite grants, fake payment provider only.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const webpack = require('webpack');
const { chromium, webkit } = require('playwright');
const { PGlite } = require('@electric-sql/pglite');
const { read, load, id } = require('./fixtures/contact-checkout-runtime.cjs');
const { setup } = require('./check-love-pass-db.cjs');

const root = path.resolve(__dirname, '..');
const sku = 'dating_love_pass_30d';
const member = id(12), waiting = id(13), ordinary = id(14), unreviewed = id(15);
const ownCard = id(112), waitingCard = id(113), ordinaryCard = id(114), unreviewedCard = id(115);
const purchaseBody = { productType: sku, offerPlacement: 'dating_love_pass' };
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>짐툴 연애 패스 검증</title><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js" defer></script></html>';
const regions = ['서울', '경기'];
const missing = dep => new Proxy({}, {get: (_, name) => name === '__esModule' ? true : () => { throw Error(`Unexpected ${dep}.${String(name)}`); }});

async function buildAssets() {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'gymtools-love-pass-journey-'));
  const adapter = path.join(__dirname, 'fixtures/recommendation-refresh-adapters.tsx');
  const output = path.join(out, 'fixture.js');
  try {
    await new Promise((resolve, reject) => {
      const compiler = webpack({
        mode: 'development', devtool: false,
        entry: path.join(__dirname, 'fixtures/love-pass-journey-browser.tsx'),
        output: {path: out, filename: 'fixture.js'},
        resolve: { extensions: ['.tsx','.ts','.js'], alias: {'next/link': adapter, 'next/navigation': adapter, '@': root} },
        module: {rules: [{test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs')}]},
      });
      compiler.run((e, stats) => compiler.close(closeError => {
        const failed = e || closeError || (stats?.hasErrors() && new Error(stats.toString({all:false, errors:true})));
        if (failed) reject(failed); else resolve();
      }));
    });
    // Build actual production classes, independent of .next or any running dev server.
    const from = path.join(root, 'app/globals.css');
    const input = read('app/globals.css').replace('@import "tailwindcss";', `@import "tailwindcss" source(none);
      @source "./dating/love-pass/page.tsx";
      @source "./payments/success/page.tsx";`);
    const css = await postcss([tailwind({base: root})]).process(input, {from});
    return {js: await fs.readFile(output), css: css.css};
  } finally {
    if (existsSync(output)) await fs.unlink(output);
    await fs.rmdir(out);
  }
}

async function makeHarness() {
  const db = new PGlite();
  await db.exec(setup);
  await db.exec(`alter table public.profiles add column swipe_profile_visible boolean default true;
    alter table public.dating_cards add column display_nickname text;
    alter table public.toss_test_payment_orders add column product_ref_id text;
    create function auth.uid() returns uuid language sql stable as 'select null::uuid';`);
  const sql = (query, args = []) => db.query(query, args);
  for (const fixture of [
    [member, ownCard,'male','서울 서초구','내 오픈카드','pending', true],
    [waiting, waitingCard,'female','서울 마포구','검수 완료 대기 프로필','pending', true],
    [ordinary, ordinaryCard,'female','경기 성남시','경기 공개 프로필','public', true],
    [unreviewed, unreviewedCard,'female','서울 양천구','검수 전 비노출 프로필','pending', false],
  ]) {
    const [userId, cardId, sex, region, name, status, reviewed] = fixture;
    await sql('insert into auth.users(id) values($1)', [userId]);
    await sql('insert into public.profiles (user_id,phone_verified,is_banned) values ($1,true,false)', [userId]);
    await sql(`insert into public.dating_cards(id,owner_user_id,sex,region,display_nickname,status,expires_at)
      values($1,$2,$3,$4,$5,$6,case when $6='public' then now()+interval '24 hours' else null end)`, [cardId,userId,sex,region,name,status]);
    if (reviewed) await sql(`insert into public.dating_profile_review_jobs(card_id,source_type,user_id,payload,state,resolution,result)
      select c.id,'open_card',c.owner_user_id,public.dating_profile_review_payload('open_card',to_jsonb(c)),'complete','cleared','{}'
      from public.dating_cards c where c.id=$1`, [cardId]);
  }
  for (const file of ['dating_card_swipe_matches.sql', 'dating_love_pass.sql', 'dating_love_pass_swipe.sql']) await db.exec(read(`supabase/sql/${file}`));

  const dbCalls = [], providerCalls = [], payments = new Map(), diagnostics = [], unexpected = [];
  const faults = { nearbyLimited: false, nearbyUnavailable: false, lookupUnavailable: false };
  const allowedRpcs = new Set([
    'dating_love_pass_ready', 'dating_love_pass_status', 'get_dating_love_pass_purchase_eligible', 'reserve_dating_love_pass_order',
    'activate_dating_love_pass', 'close_dating_love_pass_order', 'set_dating_love_pass_areas',
    'get_dating_love_pass_reviewable_cards', 'publish_dating_love_pass_card', 'dating_love_pass_card_review_ok',
  ]);
  const column = v => { assert.match(v, /^[a-z_][a-z_0-9]*$/); return v; };
  const reply = data => ({data, error: null});
  const fail = e => ({data: null, error: {code: e.code, message:e.message}});
  const admin = {
    async rpc(name, args = {}) {
      assert.ok(allowedRpcs.has(name), `Unexpected RPC ${name}`);
      dbCalls.push({rpc: name, args});
      if (name === 'get_dating_love_pass_reviewable_cards' && faults.nearbyUnavailable) return fail({code: 'FIXTURE_UNAVAILABLE'});
      try { const keys = Object.keys(args).map(column); const call = keys.map((k,i) => `${k}=>$${i+1}`).join(',');
        return reply((await sql(`select public.${name}(${call}) val`, Object.values(args))).rows[0].val);
      } catch (e) { diagnostics.push(`${name}: ${e.message}`); return fail(e); }
    },
    from(table) {
      assert.ok(['toss_test_payment_orders','profiles','dating_cards'].includes(table), `Unexpected table ${table}`);
      let fields = '*', single = false, limit, offset;
      const filters = [], sort = [];
      const q = {
        select(value) { fields=value.split(',').map(s=>column(s.trim())).join(',');return q; },
        eq(name,value) { filters.push([name,'=',value]);return q; },
        gt(name,value) { filters.push([name,'>',value]);return q; },
        in(name,value) { filters.push([name,'in',value]);return q; },
        order(name,{ascending=true}={}) { sort.push(column(name)+(ascending?' asc':' desc'));return q; },
        limit(size) { limit=size;return q; }, range(start,end) { offset=start;limit=end-start+1;return q; },
        maybeSingle() { single=true;return q; },
        then(ok,bad) { return (async()=>{
          const args=[],bind=value=>{ args.push(value);return '$'+args.length; };
          const conditions=filters.map(([name,op,value])=>op==='in'?`${column(name)} in (${value.map(bind).join(',')||'null'})`:`${column(name)}${op}${bind(value)}`);
          try { const r=await sql(`select ${fields} from public.${table}${conditions.length?' where '+conditions.join(' and '):''}${sort.length?' order by '+sort.join(', '):''}${limit!==undefined?' limit '+Number(limit):''}${offset?' offset '+Number(offset):''}`,args);
            const rows=JSON.parse(JSON.stringify(r.rows));return reply(single?rows[0]??null:rows);
          } catch(e) { diagnostics.push(`${table}: ${e.message}`); return fail(e); }
        })().then(ok,bad); },
      };return q;
    },
  };
  const provider = {
    isTossConfigured:()=>true, getMissingTossConfigKeys:()=>[], getTossCheckoutMode:()=>'DEFAULT', getTossCheckoutOptions:()=>({flowMode:'DEFAULT'}),
    async createTossPayment(params,opts) {
      assert.equal(params.amount,30_000);
      assert.equal(opts.idempotencyKey,`love-pass:${params.orderId}`);
      assert.equal(params.orderName,'짐툴 연애 패스');
      const entry = { orderId: params.orderId, paymentKey: `fixt_${params.orderId}`, totalAmount: params.amount, status:'READY',
        checkout:{url:`https://api.tosspayments.com/checkout/${params.orderId}`}, success: params.successUrl };
      payments.set(params.orderId,entry);providerCalls.push('create');return entry;
    },
    async confirmTossPayment(body) {
      providerCalls.push('confirm');
      const entry=payments.get(body.orderId);
      assert.ok(entry);assert.equal(body.amount,entry.totalAmount);assert.equal(body.paymentKey,entry.paymentKey);
      assert.equal(entry.status,'READY');assert.equal(entry.authorized,true);
      Object.assign(entry,{status:'DONE',approvedAt:new Date().toISOString(),method:'카드'});
      const { authorized, success, ...receipt } = entry;
      assert.ok(authorized && success);
      return receipt;
    },
    async getTossPaymentByOrderId(orderId) {
      providerCalls.push('lookup-order');
      if (faults.lookupUnavailable) throw new TypeError('Synthetic provider connection error');
      if (!payments.has(orderId)) throw Error('{"code":"NOT_FOUND_PAYMENT"}');
      return payments.get(orderId);
    },
    async getTossPayment(key) { providerCalls.push('lookup-key');return [...payments.values()].find(p=>p.paymentKey===key)??null; },
  };
  const globals = {process:{env:{}},fetch:()=>{throw Error('Fixture prohibits upstream network');},console:{...console,warn:message=>diagnostics.push(message),error:message=>diagnostics.push(message)}};
  const deps = {
    '@/lib/toss-payments':provider,
    '@/lib/supabase/server':{createAdminClient:()=>admin},
    '@/lib/supabase/request':{getRequestAuthContext:async()=>({user:{id:member}})},
    '@/lib/request-rate-limit':{checkRouteRateLimit:async({scope})=>({allowed:scope !== 'dating-love-pass-nearby' || !faults.nearbyLimited}),extractClientIp:()=> 'test-limit'},
    '@/lib/dating-blocks':{getDatingBlockedUserIds:async()=>new Set(),hasDatingBlockBetween:async()=>false},
    '@/lib/dating-contact-blocks':{filterDatingCardsByContactBlocks:async(_admin,_user,rows)=>rows,hasDatingContactBlockBetween:async()=>false},
    '@/lib/contact-intro-offer-server':{ContactIntroError:class extends Error{}},
    '@/lib/all-pass-profile-offer-server':{AllPassOfferError:class extends Error{}},
    '@/lib/dating-private-contact-server':missing('private contacts'), '@/lib/dating-purchase-fulfillment':missing('other products'),
    '@/lib/dating-1on1-plus':{}, '@/lib/dating-swipe':{}, '@/lib/dating-more-view':{}, '@/lib/admin':{},
    '@/lib/open-card-repost':{}, '@/lib/contact-payment-recovery':{}, '@/lib/payment-guidance':{},
  };
  const route = {
    pass:load('app/api/dating/love-pass/route.ts',deps,globals),
    create:load('app/api/payments/toss/create/route.ts',deps,globals).POST,
    confirm:load('app/api/payments/toss/confirm/route.ts',deps,globals).POST,
  };
  const sale = enabled => sql(`insert into public.site_settings values('dating_love_pass_sale',$1::jsonb)
    on conflict(key) do update set value_json=excluded.value_json`, [{enabled}]);
  return {db,sql,sale,route,dbCalls,providerCalls,payments,diagnostics,unexpected,faults};
}

async function startServer(assets, h) {
  let origin;
  const requests = [];
  const errors = [];
  const server = http.createServer(async (incoming,res)=>{
    try {
      assert.equal(incoming.headers.host,new URL(origin).host);
      const url=new URL(incoming.url,origin);
      const verb=incoming.method;
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
      res.setHeader('Cache-Control','no-store');
      const end=(status,type,body)=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
      if (verb==='GET'&&url.pathname==='/fixture.js') {end(200,'text/javascript',assets.js);return;}
      if (verb==='GET'&&url.pathname==='/fixture.css') {end(200,'text/css',assets.css);return;}
      if (verb==='GET'&&['/dating/love-pass','/payments/success'].includes(url.pathname)) {end(200,'text/html; charset=utf-8',html);return;}
      const localCheckout=url.pathname.match(/^\/fixture-checkout\/([a-f0-9]{32})(\/approve)?$/);
      if (localCheckout&&verb==='GET') {
        const [,orderId,approve]=localCheckout;const payment=h.payments.get(orderId);assert.ok(payment);
        if (!approve) {end(200,'text/html; charset=utf-8',`<!doctype html><html lang="ko"><meta charset="utf-8"><h1>가상 결제창</h1><p>30,000원 · 실제 결제 없음</p><a href="/fixture-checkout/${orderId}/approve">가상 결제 승인</a></html>`);return;}
        payment.authorized=true;
        const callback=new URL(payment.success);assert.equal(callback.origin,origin);assert.equal(callback.pathname,'/payments/success');
        callback.searchParams.set('orderId',orderId);callback.searchParams.set('paymentKey',payment.paymentKey);callback.searchParams.set('amount',String(payment.totalAmount));
        res.writeHead(303,{Location:callback.href});res.end();return;
      }
      const pathName=url.pathname;
      const handler=pathName==='/api/dating/love-pass' ? h.route.pass[verb] : verb==='POST'&&pathName==='/api/payments/toss/create' ? h.route.create
        : verb==='POST'&&pathName==='/api/payments/toss/confirm' ? h.route.confirm : null;
      if (!handler) {h.unexpected.push(`${verb} ${pathName}`);end(404,'text/plain','Unexpected fixture path');return;}
      let body='';for await(const chunk of incoming) body+=chunk;
      const headers={};for(const [key,value] of Object.entries(incoming.headers)) if(typeof value==='string') headers[key]=value;
      requests.push({verb, path:pathName, search:url.search, body:body?JSON.parse(body):null});
      const response=await handler(new Request(url,{method:verb,headers,...(body?{body}:{})}));
      const json=await response.json();
      if (pathName==='/api/payments/toss/create'&&json.checkoutUrl) {
        // The real handler has already validated the provider HTTPS URL. Swap
        // only the wire redirect at the fixture transport; never visit Toss.
        assert.equal(json.checkoutUrl,`https://api.tosspayments.com/checkout/${json.orderId}`);
        json.checkoutUrl=`${origin}/fixture-checkout/${json.orderId}`;
      }
      end(response.status,'application/json; charset=utf-8',JSON.stringify(json));
    } catch (e) {
      errors.push(e.stack||e.message);
      if (!res.headersSent) res.writeHead(500,{'Content-Type':'application/json'});
      res.end('{"error":"Synthetic fixture failed"}');
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,requests,errors,close:()=>new Promise(resolve=>server.close(resolve))};
}

async function check(browser, assets, width) {
  const h=await makeHarness();
  const server=await startServer(assets,h);
  const context=await browser.newContext({viewport:{width,height:680},serviceWorkers:'block'});
  const page=await context.newPage();page.setDefaultTimeout(8_000);
  const outbound=[],browserErrors=[];
  page.on('pageerror',e=>browserErrors.push(e.message));
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!==server.origin) {outbound.push(url.origin);await route.abort();return;}await route.continue();
  });
  const offer=`${server.origin}/dating/love-pass`;
  const btn=name=>page.getByRole('button',{name,exact:true});
  const text=name=>page.getByText(name,{exact:true});
  try {
    await h.sale(false);
    await page.goto(offer);
    await page.getByText('지금은 판매를 준비 중이에요.',{exact:false}).waitFor();
    assert.equal(await page.getByRole('link',{name:'내 결제 내역',exact:true}).getAttribute('href'),'/mypage?section=payment');
    assert.equal(await btn('연애 패스 구매하기').count(),0);
    assert.deepEqual(h.providerCalls,[]);
    await h.sale(true);await page.reload();
    await text('30,000원').waitFor();
    await btn('연애 패스 구매하기').click();
    await page.getByRole('heading',{name:'가상 결제창',exact:true}).waitFor();
    assert.deepEqual(server.requests.filter(r=>r.path==='/api/payments/toss/create').map(r=>r.body),[purchaseBody]);
    assert.deepEqual(h.providerCalls,['create']);
    assert.equal((await h.sql('select count(*)::int n from public.dating_love_passes')).rows[0].n,0);
    await h.sale(false); // pause must not block already-started checkout fulfillment
    await page.getByRole('link',{name:'가상 결제 승인',exact:true}).click();
    await page.getByRole('heading',{name:'결제가 완료됐어요',exact:true}).waitFor();
    await text('연애 패스 혜택 적용 완료').waitFor();
    const callback=page.url();
    const payment=[...h.payments.values()][0];
    assert.deepEqual(server.requests.filter(r=>r.path==='/api/payments/toss/confirm').map(r=>r.body),[{orderId:payment.orderId,paymentKey:payment.paymentKey,amount:'30000'}]);
    const [order,pass]=await Promise.all([h.sql('select status,amount from public.toss_test_payment_orders'),h.sql('select credits_remaining,starts_at,expires_at from public.dating_love_passes')]);
    assert.deepEqual(order.rows,[{status:'paid',amount:30_000}]);
    assert.equal(pass.rows.length,1);assert.equal(pass.rows[0].credits_remaining,40);
    assert.equal(Number(pass.rows[0].expires_at)-Number(pass.rows[0].starts_at),30*24*60*60*1000);
    await page.getByRole('link',{name:'연애 패스 혜택 보기',exact:true}).click();
    await text('추가 지원권 40장').waitFor();
    await text('바로 공개 4회 남음').waitFor();
    assert.equal(await btn('연애 패스 구매하기').count(),0);
    assert.equal(await text('검수 완료 대기 프로필').count(),0);
    for(const name of regions) {await btn(name).click();await page.waitForFunction(n=>Array.from(document.querySelectorAll('button[aria-pressed="true"]')).some(b=>b.textContent===n),name);}
    const nearby=page.getByRole('region',{name:'근처 오픈카드',exact:true});
    await nearby.getByRole('heading',{name:'검수 완료 대기 프로필',exact:true}).waitFor();
    await nearby.getByRole('heading',{name:'경기 공개 프로필',exact:true}).waitFor();
    assert.equal(await nearby.getByRole('article').first().getByRole('heading').textContent(),'검수 완료 대기 프로필');
    assert.equal(await nearby.getByRole('article').first().getByRole('link').getAttribute('href'),`/community/dating/cards/${waitingCard}?from=love-pass`);
    assert.equal(await text('검수 전 비노출 프로필').count(),0);
    assert.equal(await btn('대구').isDisabled(),true);

    h.faults.nearbyUnavailable=true;
    await page.reload();
    await text('추가 지원권 40장').waitFor();
    await text('바로 공개 4회 남음').waitFor();
    await nearby.getByText('근처 오픈카드를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.',{exact:true}).waitFor();
    assert.equal(await nearby.getByRole('article').count(),0);
    assert.equal(await btn('연애 패스 구매하기').count(),0);
    assert.equal(await text('지금은 선택한 지역에 볼 수 있는 카드가 없어요.').count(),0);
    const beforeRetry=server.requests.length;
    h.faults.nearbyUnavailable=false;h.faults.nearbyLimited=true;
    await btn('근처 카드 다시 확인').click();
    await nearby.getByText('잠시 후 지역 카드를 다시 확인해 주세요.',{exact:true}).waitFor();
    assert.deepEqual(server.requests.slice(beforeRetry).map(r=>r.search),['?nearby=1']);
    await text('바로 공개 4회 남음').waitFor();
    await btn('지금 공개').click();
    await page.getByRole('status').getByText('내 오픈카드를 공개했어요.',{exact:true}).waitFor();
    await text('바로 공개 3회 남음').waitFor();
    assert.equal(await btn('지금 공개').count(),0);
    await btn('근처 카드 다시 확인').waitFor();
    h.faults.nearbyLimited=false;
    await btn('근처 카드 다시 확인').click();
    await nearby.getByRole('heading',{name:'검수 완료 대기 프로필',exact:true}).waitFor();
    const updates=server.requests.filter(r=>r.verb==='POST'&&r.path==='/api/dating/love-pass').map(r=>r.body);
    assert.deepEqual(updates,[{action:'areas',areas:['서울']},{action:'areas',areas:regions},{action:'publish',cardId:ownCard}]);
    const publication=await h.sql('select card_id from public.dating_love_pass_publications');
    assert.deepEqual(publication.rows,[{card_id:ownCard}]);
    h.faults.nearbyLimited=true;
    await page.goto(callback);await text('연애 패스 혜택 적용 완료').waitFor();
    assert.deepEqual(h.providerCalls,['create','confirm']);
    await page.getByRole('link',{name:'연애 패스 혜택 보기',exact:true}).click();
    await text('바로 공개 3회 남음').waitFor();
    await text('추가 지원권 40장').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);

    // A fresh scoped request rechecks eligibility; an old view doesn't keep
    // private cards or purchase controls around after verification is revoked.
    await btn('근처 카드 다시 확인').waitFor();
    await h.sql('update public.profiles set phone_verified=false where user_id=$1',[member]);
    await btn('근처 카드 다시 확인').click();
    await page.getByRole('alert').filter({hasText:'연애 패스 이용 상태가 바뀌었어요. 다시 확인해 주세요.'}).waitFor();
    assert.equal(await nearby.getByRole('article').count(),0);
    assert.equal(await btn('연애 패스 구매하기').count(),0);
    await btn('상태 다시 확인').click();
    await page.getByText('휴대폰 인증을 확인해 주세요.',{exact:false}).waitFor();
    assert.deepEqual(outbound,[]);assert.deepEqual(h.unexpected,[]);assert.deepEqual(h.diagnostics,[]);assert.deepEqual(server.errors,[]);assert.deepEqual(browserErrors,[]);
    assert.equal((await h.sql('select count(*)::int n from public.dating_love_passes')).rows[0].n,1);
  } catch (e) {
    console.error(JSON.stringify({requests:server.requests, sql:h.diagnostics,unexpected:h.unexpected,server:server.errors,browser:browserErrors}));
    throw e;
  } finally {await context.close();await server.close();await h.db.close();}
}

async function checkPausedRecovery() {
  const h=await makeHarness();
  const endpoint='http://localhost/api/payments/toss/create';
  const request=async (resumedFromOrderId) => {
    const resp=await h.route.create(new Request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...purchaseBody,resumedFromOrderId})}));
    return {status:resp.status,...await resp.json()};
  };
  const grants=async()=> (await h.sql('select count(*)::int n from public.dating_love_passes')).rows[0].n;
  try {
    await h.sale(true);
    const started=await request();
    assert.equal(started.status,200);
    const order=(await h.sql('select id from public.toss_test_payment_orders where toss_order_id=$1',[started.orderId])).rows[0];
    await h.sale(false);
    assert.equal((await request()).code,'LOVE_PASS_NOT_ON_SALE');
    assert.equal((await request(id(987))).code,'LOVE_PASS_ORDER_NOT_FOUND');
    await h.sql('update public.toss_test_payment_orders set user_id=$1 where id=$2',[waiting,order.id]);
    assert.equal((await request(order.id)).code,'LOVE_PASS_ORDER_NOT_FOUND');
    await h.sql("update public.toss_test_payment_orders set user_id=$1,product_type='apply_credits' where id=$2",[member,order.id]);
    assert.equal((await request(order.id)).code,'LOVE_PASS_ORDER_NOT_FOUND');
    await h.sql('update public.toss_test_payment_orders set product_type=$1 where id=$2',[sku,order.id]);
    assert.deepEqual(h.providerCalls,['create']);

    // An existing open Toss checkout is not returned while new sales are paused.
    assert.equal((await request(order.id)).code,'LOVE_PASS_ORDER_NOT_APPROVED');
    const payment=h.payments.get(started.orderId);
    Object.assign(payment,{status:'DONE',approvedAt:new Date().toISOString()});
    h.faults.lookupUnavailable=true;
    assert.equal((await request(order.id)).code,'LOVE_PASS_PAYMENT_UNRESOLVED');
    h.faults.lookupUnavailable=false;
    payment.totalAmount=29_000;
    assert.equal((await request(order.id)).code,'LOVE_PASS_PAYMENT_UNRESOLVED');
    assert.equal(await grants(),0);
    payment.totalAmount=30_000;

    const fulfilled=await request(order.id);
    assert.equal(fulfilled.status,200);
    assert.equal(fulfilled.alreadyActive,true);
    assert.equal(fulfilled.checkoutUrl,undefined);
    assert.equal((await request(order.id)).alreadyActive,true);
    assert.equal(await grants(),1);
    assert.equal(h.providerCalls.filter(call=>call==='create').length,1);
    assert.equal(h.providerCalls.includes('confirm'),false);
    assert.deepEqual((await h.sql('select status, amount from public.toss_test_payment_orders')).rows,[{status:'paid',amount:30_000}]);
    console.log('PASS paused sale recovery: owned approved order only; no new checkout, one verified grant');
  } finally { await h.db.close(); }
}

(async()=>{
  await checkPausedRecovery();
  const assets=await buildAssets();
  const channel=process.env.TEST_BROWSER_CHANNEL||(process.platform==='win32'&&!existsSync(chromium.executablePath())?'chrome':undefined);
  for(const [label,engine,channelName] of [['Chromium',chromium,channel],['WebKit',webkit]]) {
    const browser=await engine.launch({headless:true,...(channelName?{channel:channelName}:{})});
    try {for(const width of [320,390]){await check(browser,assets,width);console.log(`PASS ${label} ${width}px: checkout, grant, areas, scoped nearby retry, publish and sale pause`);}}
    finally {await browser.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
