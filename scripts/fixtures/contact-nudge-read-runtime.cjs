/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic accounts and local PostgreSQL only; no live credentials/providers.
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function load(file, deps = {}) {
  const mod = {exports: {}};
  const code = ts.transpileModule(read(file), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (name.startsWith('@/')) {
      const target = name.slice(2);
      return load(target + (fs.existsSync(path.join(root, target + '.ts')) ? '.ts' : '.tsx'), deps);
    }
    return require(name);
  }, mod, mod.exports);
  return mod.exports;
}
async function runtime({migrated = true, names = {source:'보낸상대',candidate:'받은상대'}} = {}) {
  const {PGlite} = require('@electric-sql/pglite'), db = new PGlite();
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role;
    create table auth.users(id uuid primary key, deleted_at timestamptz, banned_until timestamptz);
    create table profiles(user_id uuid primary key, is_banned boolean default false);
    create table dating_user_blocks(blocker_user_id uuid, blocked_user_id uuid);
    create table dating_1on1_match_proposals(
      id uuid primary key,source_card_id uuid,candidate_card_id uuid,source_user_id uuid,candidate_user_id uuid,
      state text,contact_exchange_status text,contact_exchange_requested_at timestamptz,contact_exchange_paid_at timestamptz,
      contact_exchange_paid_by_user_id uuid,contact_exchange_approved_at timestamptz,contact_exchange_approved_by_user_id uuid,
      contact_exchange_note text,source_phone_share_consented_at timestamptz,candidate_phone_share_consented_at timestamptz,
      admin_sent_by_user_id uuid,source_selected_at timestamptz,candidate_responded_at timestamptz,
      source_final_responded_at timestamptz,created_at timestamptz,updated_at timestamptz);
    insert into auth.users(id) values('${id(1)}'),('${id(2)}'),('${id(3)}');
    insert into profiles(user_id) select id from auth.users;
    insert into dating_1on1_match_proposals(id,source_card_id,candidate_card_id,source_user_id,candidate_user_id,state,
      contact_exchange_status,source_final_responded_at,created_at,updated_at)
    values('${id(10)}','${id(20)}','${id(21)}','${id(1)}','${id(2)}','mutual_accepted','awaiting_applicant_payment',
      now()-interval '50 hours',now()-interval '60 hours',now()-interval '48 hours');`);
  await db.exec(read('supabase/sql/dating_1on1_contact_nudges.sql'));
  await db.exec('create table dating_1on1_cards(id uuid primary key,user_id uuid,name text)');
  await db.query('insert into dating_1on1_cards values($1,$2,$3),($4,$5,$6)',[id(20),id(1),names.source,id(21),id(2),names.candidate]);
  await db.query(`insert into dating_1on1_contact_nudges(id,match_id,sender_user_id,recipient_user_id,preset_key,message_text)
    values($1,$2,$3,$4,'coffee_on_me','연락처 교환해 주시면 첫 커피는 제가 살게요 ☕')`, [id(30), id(10), id(1), id(2)]);
  if (migrated) await db.exec(read('supabase/sql/dating_1on1_contact_nudge_read_receipts.sql'));
  const calls = [], flags = {blocked: false, contactBlocked: false, guardError: false, rpcError: null};
  const admin = {
    from(table) {
      if (!['dating_1on1_match_proposals', 'dating_1on1_contact_nudges', 'dating_1on1_contact_nudge_replies', 'dating_1on1_cards'].includes(table)) throw Error('Unexpected table: ' + table);
      let fields = '*', single = false, limit, offset, sorted = false, pairUser, insert;
      const filters = [];
      const q = {
        select(value) {fields = value; return q;}, eq(k,v) {filters.push([k, '=', v]); return q;},
        in(k,v) {filters.push([k, 'in', v]); return q;},
        or(value) {pairUser = value.match(/source_user_id.eq.([^,]+)/)?.[1]; return q;},
        order() {sorted = true; return q;}, range(from,to) {offset = from; limit = to-from+1; return q;},
        maybeSingle() {single = true; return q;},
        single() {single = true; return q;}, insert(value) {insert=value;return q;},
        abortSignal() {return q;},
        then(ok,bad) {return (async () => {
          calls.push({table, fields});
          const values = [], conditions = filters.map(([k,op,v]) => {
            if (op === 'in') return `${k} in (${v.map(value => {values.push(value);return '$'+values.length;}).join(',') || 'null'})`;
            values.push(v); return `${k}=$${values.length}`;
          });
          if (pairUser) {values.push(pairUser);conditions.push(`(source_user_id=$${values.length} or candidate_user_id=$${values.length})`);}
          try {
            const result = insert
              ? await db.query(`insert into ${table}(${Object.keys(insert).join(',')}) values(${Object.keys(insert).map((_,i)=>'$'+(i+1)).join(',')}) returning ${fields}`,Object.values(insert))
              : await db.query(`select ${fields} from ${table}${conditions.length?' where '+conditions.join(' and '):''}${sorted?' order by created_at desc':''}${limit?' limit '+limit:''}${offset?' offset '+offset:''}`, values);
            const rows = JSON.parse(JSON.stringify(result.rows));
            return {data: single ? rows[0] || null : rows, error: null};
          } catch (e) {return {data:null,error:{code:e.code,message:e.message}};}
        })().then(ok,bad);}
      };
      return q;
    },
    async rpc(name, args) {
      if (!['mark_dating_1on1_contact_nudge_read','reply_dating_1on1_contact_nudge'].includes(name)) throw Error('Unexpected RPC: ' + name);
      calls.push({rpc:name,args});
      if (flags.rpcError) return {data:null,error:flags.rpcError};
      try {
        if (name === 'reply_dating_1on1_contact_nudge') {
          const result = await db.query('select reply_dating_1on1_contact_nudge($1,$2,$3,$4) as reply', [args.p_match_id,args.p_nudge_id,args.p_recipient_user_id,args.p_preset_key]);
          return {data:result.rows[0].reply,error:null};
        }
        const result = await db.query('select mark_dating_1on1_contact_nudge_read($1,$2,$3) as read_at', [args.p_match_id,args.p_nudge_id,args.p_recipient_user_id]);
        const value = result.rows[0].read_at;
        return {data: value instanceof Date ? value.toISOString() : value, error:null};
      } catch (e) {return {data:null,error:{code:e.code,message:e.message}};}
    },
  };
  function routes(userId = id(2)) {
    const deps = {
      '@/lib/supabase/server': {createAdminClient: () => admin},
      '@/lib/supabase/request': {getRequestAuthContext: async () => ({user: userId ? {id:userId} : null})},
      '@/lib/dating-blocks': {
        hasDatingBlockBetween: async () => {if(flags.guardError)throw Error('guard offline');return flags.blocked;},
        getDatingBlockedUserIds: async () => new Set(flags.blocked ? [userId===id(1)?id(2):id(1)] : []),
      },
      '@/lib/dating-contact-blocks': {
        hasDatingContactPhoneBlockBetween: async () => flags.contactBlocked,
        getDatingContactBlockMapForUsers: async () => new Map(),
        getDatingProfilePhoneMapForUsers: async () => new Map([[id(1),'+821000000001'],[id(2),'+821000000002']]),
        isDatingContactPhoneBlockedPair: () => flags.contactBlocked, normalizeDatingContactPhone: value => value,
      },
      '@/lib/dating-1on1-contact-nudge-policy': {
        loadOneOnOneContactNudgeDelayHours: async () => 0,
        loadOneOnOneContactGreetingsAvailable: async () => {
          try {return (await db.query('select dating_1on1_contact_greetings_version() v')).rows[0].v===1;}catch{return false;}
        },
      },
      '@/lib/user-ban-guard': {getUserBanResponse: async () => null},
      '@/lib/dating-notifications': {notifyDatingUser: async (_admin,payload) => {calls.push({notification:payload});}},
      '@/lib/dating-swipe': {sendDatingEmailNotification: async (_admin,userId,subject,text) => {calls.push({email:{userId,subject,text}});return true;}},
      '@/lib/dating-1on1': {
        getDatingOneOnOneCardsByIds: async () => new Map([[id(20),{name:names.source}],[id(21),{name:names.candidate}]]),
        getDatingOneOnOneCardPhonesByIds: async () => new Map(),
      },
    };
    return {
      post: load('app/api/dating/1on1/matches/[id]/nudge/read/route.ts',deps).POST,
      send: load('app/api/dating/1on1/matches/[id]/nudge/route.ts',deps).POST,
      reply: load('app/api/dating/1on1/matches/[id]/nudge/reply/route.ts',deps).POST,
      get: load('app/api/dating/1on1/matches/my/route.ts',deps).GET,
    };
  }
  const request = (body = {nudgeId:id(30)}, origin = 'https://example.test') => new Request('https://example.test/read', {
    method:'POST',headers:{'content-type':'application/json',host:'example.test',origin},body:JSON.stringify(body),
  });
  return {db,admin,calls,flags,routes,request,params:{params:Promise.resolve({id:id(10)})}};
}
module.exports = {runtime, id, read, load};
