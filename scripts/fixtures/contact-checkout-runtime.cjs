/* eslint-disable @typescript-eslint/no-require-imports */
// Actual checkout/confirmation/disclosure handlers against isolated PostgreSQL.
// Authentication and optional products are fixtures; no production DB can be used.
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function load(file, deps = {}, globals = {}) {
  const mod = {exports: {}};
  const code = ts.transpileModule(read(file), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', deps, globals);
    return require(name);
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const unavailable = name => new Proxy({}, {get: (_, method) => { if (method === '__esModule') return true; return () => {throw Error(`Unexpected optional dependency ${name}.${String(method)}`);}; }});
function providerFixture() {
  const payments = new Map(), calls = [], flags = {confirmAfterApprovedError: false, failure: false};
  return {payments, calls, flags,
    isTossConfigured: () => true, getMissingTossConfigKeys: () => [], getTossCheckoutMode: () => 'DEFAULT', getTossCheckoutOptions: () => ({flowMode:'DEFAULT'}),
    async createTossPayment(params) {
      calls.push({type:'create', amount:params.amount});
      if (flags.failure) throw Error('TEST_PROVIDER_UNAVAILABLE');
      const payment = {paymentKey:'test_' + params.orderId, orderId:params.orderId, totalAmount:params.amount,
        status:'READY', checkout:{url:'https://api.tosspayments.com/checkout/' + params.orderId}};
      payments.set(params.orderId, payment); return payment;
    },
    async confirmTossPayment(input) {
      calls.push({type:'confirm', amount:input.amount});
      const p = payments.get(input.orderId);
      if (!p || p.paymentKey !== input.paymentKey || p.totalAmount !== input.amount) throw Error('TEST_PROVIDER_MISMATCH');
      if (p.status === 'DONE') throw Error('ALREADY_PROCESSED_PAYMENT');
      if (flags.failure) throw Error('TEST_PROVIDER_UNAVAILABLE');
      Object.assign(p, {status:'DONE', approvedAt:new Date().toISOString(), method:'카드'});
      if (flags.confirmAfterApprovedError) throw Error('TEST_CONNECTION_DROPPED_AFTER_APPROVAL');
      return p;
    },
    async getTossPayment(key) {calls.push({type:'get'});return [...payments.values()].find(p => p.paymentKey === key) || null;},
    async getTossPaymentByOrderId(key) {calls.push({type:'getOrder'});return payments.get(key) || null;},
  };
}
async function runtime({provider = providerFixture()} = {}) {
  const {PGlite} = require('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create table profiles(user_id uuid primary key,is_banned boolean default false,phone_e164 text);
    create table dating_1on1_cards(id uuid primary key,user_id uuid,birth_year int,status text default 'approved',name text,region text,phone text);
    create table dating_1on1_match_proposals(
      id uuid primary key,source_card_id uuid,candidate_card_id uuid,source_user_id uuid,candidate_user_id uuid,
      state text,contact_exchange_status text,contact_exchange_requested_at timestamptz,contact_exchange_paid_at timestamptz,
      contact_exchange_paid_by_user_id uuid,contact_exchange_approved_at timestamptz,contact_exchange_approved_by_user_id uuid,
      contact_exchange_note text,source_phone_share_consented_at timestamptz,candidate_phone_share_consented_at timestamptz,
      admin_sent_by_user_id uuid,source_selected_at timestamptz,candidate_responded_at timestamptz,
      source_final_responded_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table dating_1on1_contact_nudges(id uuid,match_id uuid,sender_user_id uuid,recipient_user_id uuid,preset_key text,message_text text,created_at timestamptz,read_at timestamptz);
    insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}');
    insert into profiles(user_id,phone_e164) values('${id(1)}','+821000000001'),('${id(2)}','+821000000002'),('${id(3)}','+821000000003');
    insert into dating_1on1_cards(id,user_id,birth_year,name,region,phone) values
      ('${id(20)}','${id(1)}',1995,'테스트회원A','서울','010****0001'),('${id(21)}','${id(2)}',1996,'테스트회원B','서울','010****0002');
    insert into dating_1on1_match_proposals(id,source_card_id,candidate_card_id,source_user_id,candidate_user_id,state,contact_exchange_status)
      values('${id(10)}','${id(20)}','${id(21)}','${id(1)}','${id(2)}','mutual_accepted','awaiting_applicant_payment');`);
  const definition = read('supabase/sql/toss_test_payment_orders.sql').match(/create table if not exists public\.toss_test_payment_orders \([\s\S]*?\n\);/)[0];
  await db.exec(definition);
  await db.exec("alter table toss_test_payment_orders drop constraint toss_test_payment_orders_product_type_check; alter table toss_test_payment_orders add check(product_type='one_on_one_contact_exchange')");
  const calls = [], flags = {failPaidWriteOnce:false, failFulfillmentOnce:false, blocked:false};
  const tables = new Set(['profiles','dating_1on1_cards','dating_1on1_match_proposals','dating_1on1_contact_nudges','toss_test_payment_orders']);
  const col = key => {if (key==='*' || /^[a-z_]+$/.test(key)) return key; if (key === 'product_meta->>profileAllPassOfferKey') return "product_meta->>'profileAllPassOfferKey'"; throw Error('Unexpected column');};
  const admin = {from(table) {
    if (!tables.has(table)) throw Error('Unexpected table: ' + table);
    let fields='*', single=false, operation='select', payload, limit, offset, sorting, pairUser;
    const filters=[];
    const q={select(v){fields=v;return q;},eq(k,v){filters.push([k,'=',v]);return q;},in(k,v){filters.push([k,'in',v]);return q;},
      is(k,v){if(v!==null)throw Error('Unexpected filter');filters.push([k,'is',v]);return q;},
      or(v){pairUser=v.match(/^source_user_id.eq.([0-9a-f-]+),candidate_user_id.eq.\1$/)?.[1];if(!pairUser)throw Error('Unexpected pair filter');return q;},
      order(k,o={}){sorting=col(k)+(o.ascending===false?' desc':' asc');return q;},limit(v){limit=v;return q;},range(a,b){offset=a;limit=b-a+1;return q;},
      maybeSingle(){single=true;return q;},single(){single=true;return q;},insert(v){operation='insert';payload=v;return q;},update(v){operation='update';payload=v;return q;},
      then(ok,bad){return (async()=>{
        calls.push({table,operation});
        if (operation==='update' && table==='toss_test_payment_orders' && payload.status==='paid' && flags.failPaidWriteOnce) {
          flags.failPaidWriteOnce=false;return {data:null,error:{code:'TEST_WRITE_FAILURE',message:'synthetic payment write failure'}};
        }
        if (operation==='update' && table==='dating_1on1_match_proposals' && flags.failFulfillmentOnce) {
          flags.failFulfillmentOnce=false;return {data:null,error:{code:'TEST_WRITE_FAILURE',message:'synthetic fulfillment failure'}};
        }
        const args=[], bind=v=>{args.push(v);return '$'+args.length;};
        const changes=operation==='update'?Object.entries(payload).map(([k,v])=>`${col(k)}=${bind(v)}`).join(','):'';
        const conditions=filters.map(([k,op,v])=>op==='in'?`${col(k)} in (${v.map(bind).join(',')||'null'})`:op==='is'?`${col(k)} is null`:`${col(k)}=${bind(v)}`);
        if(pairUser){const p=bind(pairUser);conditions.push(`(source_user_id=${p} or candidate_user_id=${p})`);}
        const where=conditions.length?' where '+conditions.join(' and '):'';
        const selected=fields.split(',').map(col).join(',');
        let sql;
        if(operation==='insert'){const entries=Object.entries(payload);sql=`insert into ${table}(${entries.map(([k])=>col(k)).join(',')}) values(${entries.map(([,v])=>bind(v)).join(',')}) returning ${selected}`;}
        else if(operation==='update')sql=`update ${table} set ${changes}${where} returning ${selected}`;
        else sql=`select ${selected} from ${table}${where}${sorting?' order by '+sorting:''}${limit!==undefined?' limit '+Number(limit):''}${offset?' offset '+Number(offset):''}`;
        try {const result=await db.query(sql,args);const rows=JSON.parse(JSON.stringify(result.rows));return {data:single?rows[0]||null:rows,error:null};}
        catch(e){return {data:null,error:{code:e.code,message:e.message}};}
      })().then(ok,bad);}};return q;
  }};
  // Real normalization, phone selection, age eligibility, recovery, mutation-origin
  // checks and all three API route handlers. Profiles are entirely synthetic.
  const normalize = load('lib/dating-contact-blocks.ts', {}, {process:{env:{}}}).normalizeDatingContactPhone;
  const cardDeps={'@/lib/images':unavailable('images'),'@/lib/dating-contact-blocks':{normalizeDatingContactPhone:normalize}};
  const cardPhoneReader=load('lib/dating-1on1.ts',cardDeps).getDatingOneOnOneCardPhonesByIds;
  const contactBlocks={
    normalizeDatingContactPhone:normalize,hasDatingContactPhoneBlockBetween:async()=>flags.blocked,
    getDatingContactBlockMapForUsers:async()=>new Map(),isDatingContactPhoneBlockedPair:()=>flags.blocked,
    getDatingProfilePhoneMapForUsers:async(_admin,ids)=>new Map((await db.query('select user_id,phone_e164 from profiles where user_id=any($1::uuid[])',[ids])).rows.map(r=>[r.user_id,r.phone_e164])),
  };
  class OfferError extends Error {}
  const deps={
    '@/lib/supabase/server':{createAdminClient:()=>admin},
    '@/lib/toss-payments':provider,
    '@/lib/dating-purchase-fulfillment':unavailable('fulfillment'),
    '@/lib/dating-1on1-plus':{getActiveOneOnOnePlus:async()=>null},
    '@/lib/dating-swipe':unavailable('swipe'), '@/lib/admin':{isAllowedAdminUser:()=>false},
    '@/lib/contact-intro-offer-server':{ContactIntroError:OfferError,readContactIntroOffer:async()=>null},
    '@/lib/all-pass-profile-offer-server':{AllPassOfferError:OfferError},
    '@/lib/open-card-repost':unavailable('repost'),
    '@/lib/dating-blocks':{hasDatingBlockBetween:async()=>flags.blocked,getDatingBlockedUserIds:async()=>new Set(flags.blocked?[id(1),id(2)]:[])},
    '@/lib/dating-contact-blocks':contactBlocks,
    '@/lib/dating-1on1-contact-nudge-policy':{loadOneOnOneContactNudgeDelayHours:async()=>24},
    '@/lib/dating-1on1':{
      getDatingOneOnOneCardPhonesByIds:cardPhoneReader,
      getDatingOneOnOneCardsByIds:async(_admin,ids)=>new Map((await db.query('select id,user_id,birth_year,status,name,region from dating_1on1_cards where id=any($1::uuid[])',[ids])).rows.map(r=>[r.id,{...r,age:2026-r.birth_year,photo_signed_urls:[]}]))},
  };
  const quietConsole={...console,error:(message)=>calls.push({diagnostic:message})};
  function routes(userId=id(1)) {
    const d={...deps,'@/lib/supabase/request':{getRequestAuthContext:async()=>({user:userId?{id:userId}:null})}};
    const globals={process:{env:{}},console:quietConsole};
    return {
      create:load('app/api/payments/toss/create/route.ts',d,globals).POST,
      confirm:load('app/api/payments/toss/confirm/route.ts',d,globals).POST,
      mine:load('app/api/dating/1on1/matches/my/route.ts',d,globals).GET,
      recovery:order=>load('lib/contact-payment-recovery.ts',d,globals).getContactPaymentRecovery(admin,userId,order),
    };
  }
  const request=(body={},pathname='/api/payments/toss/create',origin='http://127.0.0.1:3161')=>new Request(origin+pathname,{method:'POST',headers:{origin,host:new URL(origin).host,'content-type':'application/json'},body:JSON.stringify(body)});
  return {db,admin,routes,request,provider,calls,flags,id};
}
module.exports={runtime,providerFixture,load,id,read};
