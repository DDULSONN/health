/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated adapter for REAL server/route modules. No env loading or network.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function loader(overrides={}){const cache=new Map();return function load(name){
  if(Object.hasOwn(overrides,name))return overrides[name];if(!name.startsWith('@/'))return require(name);
  if(cache.has(name))return cache.get(name).exports;
  const module={exports:{}};cache.set(name,module);
  const code=ts.transpileModule(fs.readFileSync(path.join(root,name.slice(2)+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)(load,module,module.exports);return module.exports;
};}
function split(text){const parts=[];let depth=0,start=0;for(let i=0;i<text.length;i++){if(text[i]==='(')depth++;if(text[i]===')')depth--;if(text[i]===','&&!depth){parts.push(text.slice(start,i));start=i+1;}}return [...parts,text.slice(start)];}
function match(row,filter){if(filter.startsWith('and('))return split(filter.slice(4,-1)).every(x=>match(row,x));if(filter.startsWith('or('))return split(filter.slice(3,-1)).some(x=>match(row,x));const [key,op,...value]=filter.split('.');const v=value.join('.');return op==='eq'?String(row[key])===v:op==='lt'?row[key]<v:op==='gt'?row[key]>v:false;}
function fixture(){
  const tables={profiles:[1,2,3,4].map(n=>({user_id:id(n),nickname:['보낸회원','추천회원','받은친구','관리자'][n-1],phone_e164:`+82101234000${n}`,phone_verified:true,is_banned:false})),
    dating_friend_share_policy:[{id:true,enabled:true}],dating_friend_share_preferences:[],dating_friend_shares:[],
    dating_cards:[{id:id(12),owner_user_id:id(2),display_nickname:'추천회원',sex:'male',age:31,region:'서울 강남구',height_cm:180,job:'개발자',strengths_text:'산책을 좋아해요',ideal_type:'대화가 편한 분',photo_visibility:'public',photo_paths:[`cards/${id(2)}/profile.jpg`],status:'public',expires_at:new Date(Date.now()+86400000).toISOString(),instagram_id:'private_handle'}],
    dating_paid_cards:[],dating_1on1_cards:[],dating_user_blocks:[],dating_1on1_admin_user_blocks:[],dating_1on1_phone_blocks:[],dating_contact_blocks:[],dating_1on1_candidate_favorites:[]};
  const state={viewer:id(1),admin:false,failTable:null,authMissing:new Set(),authBanned:new Set(),internal:new Set(),calls:[],matchCalls:0};
  function from(table){let filters=[],fields='*',limit=1000,single=false,order=[],update=null;const query={
    select(value){fields=value;return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},is(k,v){filters.push(r=>(r[k]??null)===v);return this;},gt(k,v){filters.push(r=>r[k]>v);return this;},gte(k,v){filters.push(r=>r[k]>=v);return this;},in(k,v){filters.push(r=>v.includes(r[k]));return this;},or(value){filters.push(r=>split(value).some(f=>match(r,f)));return this;},
    ilike(k,v){const needle=v.replace(/^%|%$/g,'').replace(/\\/g,'');filters.push(r=>String(r[k]).includes(needle));return this;},
    limit(n){limit=n;return this;},order(k,o){order.push([k,o.ascending]);return this;},maybeSingle(){single=true;return this;},update(value){update=value;return this;},
    then(resolve,reject){return Promise.resolve().then(()=>{
      state.calls.push({table,fields,limit,write:!!update});if(state.failTable===table||!tables[table])return {data:null,error:{code:'42P01'}};
      let rows=tables[table].filter(r=>filters.every(f=>f(r)));for(const [key,asc]of order.reverse())rows.sort((a,b)=>String(a[key]).localeCompare(String(b[key]))*(asc?1:-1));rows=rows.slice(0,limit);
      if(update)rows.forEach(r=>Object.assign(r,update));const projected=rows.map(r=>fields==='*'?structuredClone(r):Object.fromEntries(fields.split(',').map(k=>[k,r[k]])));
      return {data:single?(projected[0]??null):projected,error:null};
    }).then(resolve,reject);}
  };return query;}
  const admin={from,auth:{admin:{getUserById:async user=>state.authMissing.has(user)?{data:{user:null},error:{status:404}}:{data:{user:{id:user,app_metadata:state.internal.has(user)?{internal_test_suite:'fixture'}:{},banned_until:state.authBanned.has(user)?new Date(Date.now()+86400000).toISOString():null}},error:null}}},
    storage:{from:()=>({download:async()=>({data:new Blob([await require('sharp')({create:{width:300,height:400,channels:3,background:'#b65a72'}}).jpeg().toBuffer()]),error:null})})},
    rpc:async(name,args)=>{if(name==='set_dating_friend_share_preference'){let pref=tables.dating_friend_share_preferences.find(p=>p.user_id===args.p_user);if(!pref){pref={user_id:args.p_user,enabled:true,revision:0};tables.dating_friend_share_preferences.push(pref);}if(pref.enabled&&!args.p_enabled)pref.revision++;pref.enabled=args.p_enabled;return{data:null,error:null};}
      if(name==='create_dating_friend_share'){const row={id:crypto.randomUUID(),user_id:args.p_user,token:args.p_token,prompt:args.p_prompt,items:args.p_items,request_key:args.p_request_key,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),revoked_at:null};tables.dating_friend_shares.push(row);return{data:row,error:null};}throw Error('unexpected rpc '+name);}};
  const load=loader({
    '@/lib/supabase/server':{createAdminClient:()=>admin},
    '@/lib/supabase/request':{getRequestAuthContext:async()=>({user:state.viewer?{id:state.viewer}:null})},
    '@/lib/admin-route':{requireAdminRoute:async()=>state.admin?{ok:true,admin,user:{id:id(4)}}:{ok:false,response:Response.json({error:'admin only'},{status:403})}},
    '@/lib/request-origin':{ensureAllowedMutationOrigin:req=>req.headers.get('origin')===new URL(req.url).origin?null:Response.json({error:'origin'},{status:403})},
    '@/lib/request-rate-limit':{extractClientIp:()=> 'fixture',checkRouteRateLimit:async()=>({allowed:true})},
    '@/lib/dating-1on1-current-cards':{getCurrentOneOnOneCardIds:async(_,cards)=>new Set(cards.filter(card=>tables.dating_1on1_cards.some(c=>c.id===card.id&&c.status==='approved')).map(c=>c.id))},
    '@/lib/dating-1on1-impressions':{verifyImpressionTicket:(ticket,user,cards)=>ticket===`ticket:${user}:${cards[0]}`?{source:id(11)}:null},
    '@/app/api/dating/1on1/matches/auto/route':{POST:async req=>{state.matchCalls++;state.lastMatch=await req.json();return Response.json({ok:true});}},
  });
  return {tables,state,admin,load,id,request:(path,body,origin='http://localhost')=>new Request('http://localhost'+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})};
}
module.exports={fixture,loader,id};
