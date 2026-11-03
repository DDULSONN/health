/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated real component events + real transport; no account/provider access.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),React=require('react');
const root=path.resolve(__dirname,'..');
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function transport(fetch,crypto=global.crypto){const m={exports:{}};new Function('module','exports','fetch','crypto',compile('lib/private-contact-chat-client.ts'))(m,m.exports,fetch,crypto);return m.exports;}
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(setImmediate);};
const message=(content='안녕하세요 🙂')=>({id:'1',mine:true,content,created_at:new Date().toISOString()});
const response=items=>Response.json({items});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function offerView(){
  const states=[],effects=[],pending=[],listeners={},exchanges=[];let si=0,ei=0,props={matchId:'match-a',included:false,processing:false,nudgeProcessing:false,onExchange:(...args)=>exchanges.push(args),onNudge(){}},nextBody={offer:null,instagramContactAvailable:true};
  const helper={exports:{}};new Function('module','exports',compile('lib/dating-private-contact.ts'))(helper,helper.exports);
  const m={exports:{}};new Function('require','module','exports','window','fetch',compile('components/dating/OneOnOneContactOffer.tsx'))(name=>{
    if(name==='react')return {...React,useId:()=> 'test-id',useState:initial=>{const i=si++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=v;}];},useEffect:(fn,deps)=>{const i=ei++;if(!effects[i]||deps.some((d,j)=>!Object.is(d,effects[i].deps[j])))pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
    if(name==='@/lib/dating-private-contact')return helper.exports;
    if(name==='@/lib/contact-intro-offer')return {isContactIntroOffer:v=>!!v?.offerId};
    if(name==='@/lib/dating-contact-price')return {ONE_ON_ONE_CONTACT_PRICE_KRW:18000};
    if(name==='@/lib/use-contact-payment-tracking')return {useContactPaymentTracking:()=>({buttonRef:null,trackClick(){}})};
    if(name.startsWith('@/components/'))return {__esModule:true,default:()=>null,ReceivedContactNudge:()=>null,SentContactNudgeReply:()=>null};
    return require(name);
  },m,m.exports,{setTimeout,clearTimeout,addEventListener:(k,f)=>{listeners[k]=f;},removeEventListener:k=>{delete listeners[k];}},async()=>Response.json(nextBody));
  function render(){si=ei=0;const tree=m.exports.default(props);while(pending.length)pending.shift()();return tree;}
  const get=(type,predicate=()=>true)=>nodes(render()).find(n=>n.type===type&&predicate(n));render();
  return {exchanges,render,get,async ready(){await settle();render();},change:delta=>{props={...props,...delta};render();},async refresh(body){nextBody=body;await listeners.focus();await settle();render();},unmount:()=>effects.forEach(e=>e?.cleanup?.())};
}
for(const change of ['included','disabled','quote'])test('delayed '+change+' preserves Instagram choice and requires explicit phone opt-in',async()=>{
  const v=offerView();try{await v.ready();v.get('input',n=>n.props.type==='checkbox').props.onChange({target:{checked:true}});
    v.get('input',n=>n.props.placeholder==='@내 인스타 아이디').props.onChange({target:{value:'my_runner'}});
    if(change==='included')v.change({included:true});else await v.refresh({instagramContactAvailable:false,offer:change==='quote'?{offerId:'offer-a',matchId:'match-a',amount:15000,active:false}:null});
    assert.equal(v.get('input',n=>n.props.type==='checkbox').props.checked,true);assert.equal(v.get('input',n=>n.props.placeholder==='@내 인스타 아이디').props.value,'my_runner');
    v.get('button',n=>n.props.onClick&&text(n).includes('교환')).props.onClick();assert.equal(v.exchanges.length,0);assert.match(text(v.render()),/번호로 자동 변경하지 않아요/);
    v.get('input',n=>n.props.type==='checkbox').props.onChange({target:{checked:false}});v.get('button',n=>n.props.onClick&&text(n).includes('교환')).props.onClick();assert.equal(v.exchanges.length,1);assert.equal(v.exchanges[0][2],undefined);
  }finally{v.unmount();}
});
function nodes(n){return Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[];}
function text(n){return Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):String(n??'');}
function view(fetch,crypto=global.crypto){
  const calls=[],states=[],refs=[],effects=[],callbacks=[],pending=[],listeners={},intervals=new Map();
  let si=0,ri=0,ei=0,ci=0,props={matchId:'match-a'};
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
  const helper=transport((url,init)=>{calls.push({url,...init});return fetch(url,init);},crypto);
  const m={exports:{}},doc={visibilityState:'visible',addEventListener:(k,f)=>{listeners[k]=f;},removeEventListener:k=>{delete listeners[k];}};
  const win={setInterval:(fn)=>{intervals.set(1,fn);return 1;},clearInterval:id=>intervals.delete(id),addEventListener:(k,f)=>{listeners[k]=f;},removeEventListener:k=>{delete listeners[k];}};
  new Function('require','module','exports','window','document',compile('components/dating/OneOnOnePrivateChat.tsx'))(name=>{
    if(name==='react')return {...React,
      useState:initial=>{const i=si++;if(!(i in states))states[i]=initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},
      useRef:initial=>refs[ri++]??={current:initial},
      useCallback:(fn,deps)=>{const i=ci++;if(!same(callbacks[i]?.deps,deps))callbacks[i]={fn,deps};return callbacks[i].fn;},
      useEffect:(fn,deps)=>{const i=ei++;if(!same(effects[i]?.deps,deps))pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
    };
    if(name==='@/lib/private-contact-chat-client')return helper;
    return require(name);
  },m,m.exports,win,doc);
  function render(){si=ri=ei=ci=0;const tree=m.exports.default(props);while(pending.length)pending.shift()();return tree;}
  const get=type=>nodes(render()).find(n=>n.type===type);
  render();
  return {calls,render,listeners,doc,get,states,async ready(){await settle();render();},
    type:value=>get('textarea').props.onChange({target:{value}}),
    submit:()=>get('form').props.onSubmit({preventDefault(){}}),
    switchMatch:matchId=>{props={matchId};render();},
    unmount:()=>{for(const e of effects)e?.cleanup?.();},
  };
}

for(const phase of ['fetch','body'])test('chat deadline releases '+phase+' even if abort is ignored; no automatic resend',async()=>{
  let calls=0;const t=transport(()=>{calls++;return phase==='fetch'?new Promise(()=>{}):Promise.resolve({ok:true,json:()=>new Promise(()=>{})});});
  await assert.rejects(t.requestPrivateChat('x',{method:'POST',body:'{}'},15),/응답이 늦어/);assert.equal(calls,1);
});
test('parent abort settles a stalled request and pre-aborted requests never send',async()=>{
  let calls=0;const t=transport(()=>{calls++;return new Promise(()=>{});}),c=new AbortController();
  const pending=t.requestPrivateChat('x',{signal:c.signal});c.abort();await assert.rejects(pending,/취소/);
  await assert.rejects(t.requestPrivateChat('x',{signal:c.signal}),/취소/);assert.equal(calls,1);
});
test('malformed success and network errors cannot display raw diagnostics or crash message rendering',async()=>{
  for(const fetch of [async()=>response(null),async()=>response([{}]),async()=>new Response('<html>'),async()=>{throw TypeError('Failed to fetch');}]){
    await assert.rejects(transport(fetch).requestPrivateChat('x',{}),e=>/[가-힣]/.test(e.message)&&!/fetch|html/.test(e.message));
  }
});
test('older Safari UUID fallback stays valid and unique without randomUUID',()=>{
  const t=transport(()=>{}, {getRandomValues:a=>require('node:crypto').randomFillSync(a)});
  const a=t.privateChatMessageId(),b=t.privateChatMessageId();assert.match(a,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.notEqual(a,b);
});
test('double-click sends once, Korean text survives and success clears the draft',async()=>{
  const d=deferred(),v=view((_u,i)=>i.method==='POST'?d.promise:Promise.resolve(response([])));
  try{await v.ready();v.type(' 안녕하세요 🙂 ');v.submit();v.submit();assert.equal(v.calls.filter(c=>c.method==='POST').length,1);
    d.resolve(response([message()]));await settle();assert.equal(v.get('textarea').props.value,'');assert.match(text(v.render()),/안녕하세요 🙂/);
  }finally{v.unmount();}
});
test('ambiguous send keeps draft and client ID for retry, avoiding a duplicate stored message',async()=>{
  let posts=0;const v=view(async(_u,i)=>{if(i.method!=='POST')return response([]);if(++posts===1)throw TypeError('Failed to fetch');return response([message()]);});
  try{await v.ready();v.type('안녕하세요 🙂');v.submit();await settle();assert.equal(v.get('textarea').props.value,'안녕하세요 🙂');
    assert.match(text(v.render()),/중복 저장하지 않아요/);v.submit();await settle();
    const bodies=v.calls.filter(c=>c.method==='POST').map(c=>JSON.parse(c.body));assert.equal(bodies.length,2);assert.equal(bodies[0].clientId,bodies[1].clientId);
  }finally{v.unmount();}
});
test('late polling response cannot erase a freshly sent message',async()=>{
  const late=deferred();let reads=0;const v=view(async(_u,i)=>i.method==='POST'?response([message('새 메시지')]):++reads===1?response([]):late.promise);
  try{await v.ready();v.listeners.focus();v.type('새 메시지');v.submit();await settle();late.resolve(response([]));await settle();assert.match(text(v.render()),/새 메시지/);}
  finally{v.unmount();}
});
test('blocked or signed-out conversations clear visible history and disable sending',async()=>{
  for(const status of [401,409]){const v=view(async(_u,i)=>i.method==='POST'?Response.json({error:'이용할 수 없어요.'},{status}):response([message('이전 대화')]));
    try{await v.ready();v.type('추가');v.submit();await settle();assert.doesNotMatch(text(v.render()),/이전 대화/);assert.equal(nodes(v.render()).find(n=>n.type==='button'&&n.props.type==='submit').props.disabled,true);}
    finally{v.unmount();}
  }
});
test('changing matches while sending never mixes messages or clears the next draft',async()=>{
  const d=deferred();const v=view(async(_u,i)=>i.method==='POST'?d.promise:response([]));
  try{await v.ready();v.type('이전 매칭');v.submit();v.switchMatch('match-b');await v.ready();v.type('다음 매칭');
    d.resolve(response([message('이전 매칭')]));await settle();assert.equal(v.get('textarea').props.value,'다음 매칭');assert.doesNotMatch(text(v.render()),/이전 매칭/);
  }finally{v.unmount();}
});
test('visibility refresh pauses while hidden and resumes without sending a message',async()=>{
  const v=view(async()=>response([]));try{await v.ready();const n=v.calls.length;v.doc.visibilityState='hidden';v.listeners.visibilitychange();await settle();assert.equal(v.calls.length,n);
    v.doc.visibilityState='visible';v.listeners.visibilitychange();await settle();assert.equal(v.calls.length,n+1);assert(!v.calls.some(c=>c.method==='POST'));
  }finally{v.unmount();}
});
test('no send before authenticated conversation loads, including direct form submission',async()=>{
  const d=deferred(),v=view(()=>d.promise);try{v.type('미확인');v.submit();assert.equal(v.calls.length,1);d.resolve(response([]));await settle();}finally{v.unmount();}
});
test('UUID generation failure releases send lock and preserves draft for a later retry',async()=>{
  const v=view(async()=>response([]),{getRandomValues(){throw Error('crypto unavailable');}});
  try{await v.ready();v.type('안녕하세요');v.submit();await settle();assert.equal(v.get('textarea').props.disabled,false);assert.equal(v.get('textarea').props.value,'안녕하세요');assert.equal(v.calls.length,1);}
  finally{v.unmount();}
});
