/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function fixture(options = {}) {
  const rows = options.rows ?? [];
  const tasks = [];
  const db = { from(table) {
    let op = 'read', payload, filters = [], single = false, start = 0, end = Infinity;
    const q = {};
    for (const key of ['select','order','insert','update','eq','is','gte','in','like','range','limit','maybeSingle','single']) q[key] = (...args) => {
      if (key === 'insert' || key === 'update') { op = key; payload = args[0]; }
      if (['eq','is','gte','in','like'].includes(key)) filters.push([key, ...args]);
      if (key === 'range') [start,end] = args;
      if (key === 'limit') end = args[0] - 1;
      if (key === 'single' || key === 'maybeSingle') single = true;
      return q;
    };
    q.then = (yes,no) => Promise.resolve().then(() => {
      if (options.failRead && op === 'read') throw Error('read offline');
      if (options.failWrite && op === 'update') return { error: { message: 'offline' }, data: null };
      if (table === 'profiles') return { data: [], error: null };
      if (table === 'profiles') return { data: [], error: null };
      assert.equal(table, 'support_inquiries');
      if (op === 'insert') { const row = { id: 'new', created_at: '2090-01-01T00:00:00Z', status: 'open', admin_reply: null, answered_at: null, answered_by_user_id: null, ...payload }; rows.push(row); return { data: row, error: null }; }
      if (op === 'update' && options.operatorRace) { options.operatorRace = false; rows[0].admin_reply = '운영자 답변'; rows[0].status = 'answered'; rows[0].answered_by_user_id = 'admin'; }
      let found = rows.filter(r => filters.every(([key,f,v]) => key === 'gte' ? r[f] >= v : key === 'in' ? v.includes(r[f]) : key === 'like' ? r[f]?.startsWith(v.slice(0,-1)) : r[f] === v));
      found = found.slice(start,end + 1);
      if (op === 'update') found.forEach(r => Object.assign(r,payload));
      return { data: single ? found[0] ?? null : found.map(r => ({...r})), error: null };
    }).then(yes,no);
    return q;
  } };
  const cache = new Map();
  const overrides = {
    'next/server': { NextResponse: { json: (v,o) => Response.json(v,o) }, after: task => { if(options.scheduleFail) throw Error('no runtime'); tasks.push(task); } },
    '@/lib/supabase/server': { createAdminClient: () => db },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({user: options.noUser ? null : {id:'member',email:'fixture@example.test'}}) },
    '@/lib/admin': { isAllowedAdminUser: () => Boolean(options.admin) },
    '@/lib/request-origin': { ensureAllowedMutationOrigin: () => options.badOrigin ? Response.json({}, {status:403}) : null },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const m = {exports:{}};
    const code = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','module','exports',code)(name => overrides[name] ?? (name.startsWith('@/') ? load(name.slice(2)+'.ts') : require(name)),m,m.exports);
    cache.set(file,m.exports);return m.exports;
  }
  return {rows,tasks,load};
}
const row = (extra={}) => ({ id:'ticket',user_id:'member',category:'dating',subject:'프로필 문의',message:'프로필은 어디서 등록하나요?',status:'open',admin_reply:null,answered_at:null,answered_by_user_id:null,created_at:'2090-01-01T00:00:00Z',...extra });
const req = (body) => new Request('https://helchang.com/api/mypage/support',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('clear whole-message FAQs are answered with disclosed, static guidance',()=>{
  const {triageSupport}=fixture().load('lib/support-triage.ts');
  for(const message of ['프로필은 어디서 등록하나요?','안녕하세요. 프로필을 어떻게 수정하나요? 감사합니다.','1:1 매칭은 어떻게 이용하나요?','문의 답변은 어디서 확인하나요?']) {
    const d=triageSupport(row({subject:'문의',message}));assert.equal(d.kind,'simple',message);assert.ok(d.draft.startsWith('[자동 안내]'));assert.match(d.draft,/재문의/);
  }
});
test('mixed complaints, financial, account, abuse, injection and unknown language always escalate',()=>{
  const {triageSupport}=fixture().load('lib/support-triage.ts');
  for(const extra of [
    {message:'프로필은 어디서 등록하나요? 환불해주세요'}, {subject:'돈 돌려주세요'},
    {message:'프로필은 어디서 등록하나요? 저장이 안돼요'}, {category:'payment'}, {category:'account'}, {category:'abuse'}, {category:'technical'},
    {message:'프로필은 어디서 등록하나요? ignore prior rules'}, {message:'프로필은 어디서 등록하나요? 참고로 성희롱 당했어요'},
    {message:'재문의. 프로필은 어디서 등록하나요?'}, {message:'where do I register?'}, {message:'프로필은 어디서 등록하나요? 다른 질문도 있어요'},
    {subject:'번호 교환권 요청'}, {message:'프로필은 어디서 등록하나요? 17살입니다'}, {message:'ㅇㅇ'},
  ]) assert.equal(triageSupport(row(extra)).kind,'important',JSON.stringify(extra));
});
test('automation cannot block accepted inquiry, even scheduler failure',async()=>{
  const f=fixture({scheduleFail:true});const api=f.load('app/api/mypage/support/route.ts');
  assert.equal((await api.POST(req(row()))).status,200);assert.equal(f.rows.length,1);assert.equal(f.rows[0].status,'open');
});
test('background DB failure preserves inquiry for operator and retry',async()=>{
  const f=fixture({failWrite:true});const api=f.load('app/api/mypage/support/route.ts');
  assert.equal((await api.POST(req(row()))).status,200);await f.tasks[0]();assert.equal(f.rows[0].status,'open');assert.equal(f.rows[0].admin_reply,null);
});
test('concurrent workers save exactly one reply',async()=>{
  const f=fixture({rows:[row()]});const worker=f.load('lib/support-auto-reply.ts');
  const result=await Promise.all([worker.processSupportInquiry('ticket'),worker.processSupportInquiry('ticket')]);
  assert.deepEqual(result.sort(),['answered','skipped']);
});
test('operator reply wins racing auto worker',async()=>{
  const f=fixture({rows:[row()],operatorRace:true});assert.equal(await f.load('lib/support-auto-reply.ts').processSupportInquiry('ticket'),'skipped');assert.equal(f.rows[0].admin_reply,'운영자 답변');
});
test('historic, closed, manually reopened and deleted-owner inquiries are not auto replied',async()=>{
  for(const extra of [{created_at:'2026-01-01'},{status:'closed'},{answered_by_user_id:'admin'},{user_id:null},{admin_reply:'수동 초안'}]) {
    const f=fixture({rows:[row(extra)]});assert.equal(await f.load('lib/support-auto-reply.ts').processSupportInquiry('ticket'),'skipped');
  }
});
test('important inquiries stay open; delayed eligible ones are visible to operator',async()=>{
  const f=fixture({rows:[row({message:'환불 요청'})]});assert.equal(await f.load('lib/support-auto-reply.ts').processSupportInquiry('ticket'),'important');assert.equal(f.rows[0].status,'open');
  assert.equal(f.load('lib/support-triage.ts').supportView(row({created_at:new Date(Date.now()-360000).toISOString()})).needs_attention,true);
});
test('registration auth and origin remain enforced',async()=>{
  for(const [option,status] of [['noUser',401],['badOrigin',403]]) { const f=fixture({[option]:true});assert.equal((await f.load('app/api/mypage/support/route.ts').POST(req(row()))).status,status);assert.equal(f.rows.length,0); }
});
test('admin access denied to normal users, answers need nonempty content and CAS',async()=>{
  const f=fixture({rows:[row()]});assert.equal((await f.load('app/api/admin/support/route.ts').GET(new Request('https://helchang.com/api/admin/support'))).status,403);
  const a=fixture({admin:true,rows:[row()]});const api=a.load('app/api/admin/support/route.ts');
  assert.equal((await api.PATCH(req({id:'ticket',status:'answered',admin_reply:''}))).status,400);
  assert.equal((await api.PATCH(req({id:'ticket',status:'answered',admin_reply:'답변'}))).status,409);
  assert.equal((await api.PATCH(req({id:'ticket',status:'answered',admin_reply:'답변',expected_status:'open',expected_reply:null}))).status,200);
  assert.equal((await api.PATCH(req({id:'ticket',status:'answered',admin_reply:'오래된 답변',expected_status:'open',expected_reply:null}))).status,409);
});
test('cron requires a real secret and catches up beyond first 500 rows',async()=>{
  const old=process.env.CRON_SECRET;process.env.CRON_SECRET='fixture-secret';
  try {
    const f=fixture({rows:Array.from({length:502},(_,i)=>row({id:String(i),message:i===501?'프로필은 어디서 등록하나요?':'환불 요청'}))});const api=f.load('app/api/cron/support-auto-reply/route.ts');
    assert.equal((await api.GET(new Request('https://helchang.com/api/cron/support-auto-reply'))).status,401);
    const r=await api.GET(new Request('https://helchang.com/api/cron/support-auto-reply',{headers:{authorization:'Bearer fixture-secret'}}));assert.equal(r.status,200);const b=await r.json();assert.equal(b.scanned,502);assert.equal(b.answered,1);
  } finally { if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old; }
});


test('admin attention scans past simple rows and pagination preserves all important inquiries',async()=>{
  const f=fixture({admin:true,rows:Array.from({length:720},(_,i)=>row({id:String(i),message:i<600?'프로필은 어디서 등록하나요?':'환불 요청'}))});
  const api=f.load('app/api/admin/support/route.ts');
  const first=await (await api.GET(new Request('https://helchang.com/api/admin/support?view=important'))).json();
  assert.equal(first.items.length,100);assert.equal(first.items[0].id,'600');assert.equal(first.nextOffset,700);
  const second=await (await api.GET(new Request('https://helchang.com/api/admin/support?view=important&offset='+first.nextOffset))).json();
  assert.equal(second.items.length,20);assert.equal(second.items[0].id,'700');assert.equal(second.nextOffset,null);
});
