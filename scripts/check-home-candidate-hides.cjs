/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
function evaluate(code,bindings={}) {
  const m={exports:{}};
  const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports',...Object.keys(bindings),js)(m.exports,...Object.values(bindings)); return m.exports;
}
const home=read('app/community/dating/cards/page.tsx');
const panel=read('components/dating/OneOnOneHomePanel.tsx');
function initializer(source,name) {
  const ast=ts.createSourceFile('view.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX); let result;
  function visit(n) { if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name) result=n.initializer.getText(ast); ts.forEachChild(n,visit); } visit(ast); assert.ok(result,name); return result;
}
test('successful hide changes only recommendations, cancels stale reads and retains quota and membership', async()=>{
  const {createLatestRequest}=evaluate(read('lib/latest-request.ts'));
  const request=createLatestRequest(); let release; const old=new Promise(r=>release=r);
  let stale=false,loading=true,notice='';
  let groups=[{source_card_id:'source',recommendations:[{id:'a'},{id:'b'}],admin_recommendations:[{id:'a'},{id:'c'}],refresh_remaining:2,hidden_candidate_ids:[]}];
  const pending=request.run({load:()=>old,commit:()=>{stale=true;}});
  const hide=evaluate('exports.hide='+initializer(home,'handleHideOneOnOneCandidate'),{
    oneOnOneRecommendationsRequest:request,setOneOnOneRecommendations:fn=>{groups=fn(groups);},
    setOneOnOneRecommendationsLoading:value=>{loading=value;},setOneOnOneActionNotice:value=>{notice=value;},
  }).hide;
  hide('a'); hide('a'); release([]); await pending;
  assert.equal(stale,false); assert.equal(loading,false); assert.match(notice,/기존 요청·매칭/);
  assert.deepEqual(groups[0].recommendations,[{id:'b'}]); assert.deepEqual(groups[0].admin_recommendations,[{id:'c'}]);
  assert.equal(groups[0].refresh_remaining,2); assert.deepEqual(groups[0].hidden_candidate_ids,['a']);
});
test('only unsent admin proposals are filtered; incoming/sent/mutual matches stay intact',()=>{
  const matches=['proposed','source_selected','candidate_accepted','mutual_accepted'].flatMap(state=>['source','candidate'].map(role=>({id:state+role,state,role,counterparty_card:{id:'hidden'}})));
  const active=evaluate('exports.active='+initializer(panel,'activeMatches'),{matches,hiddenCandidateIds:new Set(['hidden'])}).active;
  assert.equal(active.length,7); assert.ok(!active.some(m=>m.state==='proposed'&&m.role==='source'));
  assert.ok(active.some(m=>m.state==='source_selected'&&m.role==='candidate'));
  assert.equal(active.filter(m=>m.state==='mutual_accepted').length,2);
});
test('home controls use the existing API components and restore with a strict read, never a paid refresh',()=>{
  assert.match(home,/onCandidateHidden=\{handleHideOneOnOneCandidate\}/);
  assert.match(home,/onCandidateRestored=\{\(\) => reloadOneOnOneHome\(true, true\)\}/);
  assert.equal((panel.match(/<CandidateHideButton/g)||[]).length,3);
  assert.match(panel,/hidesEnabled=\{group\.hides_enabled === true && Boolean\(onCandidateHidden\)\}/);
  assert.match(panel,/<CandidateHidesPanel enabled=\{group\.hides_enabled === true\}/);
  assert.ok(!initializer(home,'handleHideOneOnOneCandidate').includes('fetch('));
  assert.ok(!initializer(home,'handleHideOneOnOneCandidate').includes('setOneOnOneHome('));
});
