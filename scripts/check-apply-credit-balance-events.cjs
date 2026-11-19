/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/apply-credit-balance-events.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function('exports',code)(mod.exports);
const {APPLY_CREDIT_BALANCE_CHANGED,notifyApplyCreditBalanceChanged,isApplyCreditBalanceChangeForUser}=mod.exports;
test('server render does not access browser state',()=>assert.doesNotThrow(()=>notifyApplyCreditBalanceChanged('member')));
for(const detail of [null,undefined,5,'member',{}, {userId:5},{userId:'other'}])test('reject unrelated/invalid event '+JSON.stringify(detail),()=>{
 assert.equal(isApplyCreditBalanceChangeForUser(new CustomEvent(APPLY_CREDIT_BALANCE_CHANGED,{detail}),'member'),false);
});
test('reject plain event',()=>assert.equal(isApplyCreditBalanceChangeForUser(new Event(APPLY_CREDIT_BALANCE_CHANGED),'member'),false));
test('notify only invalidates this member; it never supplies a credit count',()=>{
 const original=global.window;const target=new EventTarget();global.window=target;const events=[];
 target.addEventListener(APPLY_CREDIT_BALANCE_CHANGED,e=>events.push(e));
 try {notifyApplyCreditBalanceChanged('');notifyApplyCreditBalanceChanged('member');assert.equal(events.length,1);assert.deepEqual(events[0].detail,{userId:'member'});assert.equal(isApplyCreditBalanceChangeForUser(events[0],'member'),true);}
 finally {if(original===undefined)delete global.window;else global.window=original;}
});
test('optional display notification failure does not invalidate a successful grant',()=>{
 const original=global.window;global.window={dispatchEvent(){throw Error('display unavailable');}};
 try {assert.doesNotThrow(()=>notifyApplyCreditBalanceChanged('member'));}
 finally {if(original===undefined)delete global.window;else global.window=original;}
});
