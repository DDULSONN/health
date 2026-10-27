/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function evaluate(source,bindings={}){const m={exports:{}};new Function('exports',...Object.keys(bindings),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m.exports,...Object.values(bindings));return m.exports;}
const starter=evaluate(read('lib/dating-1on1-starter.ts'));
const card=id=>({id,name:id,region:'서울',age:30});
for(const size of [0,1,2,3,10])test('first-profile preview caps at three without changing original data: '+size,()=>{
  const groups=[{source_card_id:'own',recommendations:Array.from({length:size},(_,i)=>card(String(i))),refresh_remaining:2}];
  const before=JSON.stringify(groups),preview=starter.getOneOnOneStarterGroups(groups);
  assert.equal(preview.flatMap(g=>g.recommendations).length,Math.min(size,3));assert.equal(JSON.stringify(groups),before);
  if(size)assert.equal(preview[0].refresh_remaining,2);
});
test('starter preserves server order and fills only from delivered extras, deduplicating profiles',()=>{
  const first=card('a'),second=card('b'),third=card('c');
  const result=starter.getOneOnOneStarterGroups([{source_card_id:'own',recommendations:[first,first],admin_recommendations:[first,second]},
    {source_card_id:'other',recommendations:[second,third,card('d')]}]);
  assert.deepEqual(result.flatMap(g=>[...(g.recommendations||[]),...(g.admin_recommendations||[])]),[first,second,third]);
  assert.deepEqual(starter.getOneOnOneStarterGroups([{recommendations:[first]},{}]),[]);
});
function initializer(name){const ast=ts.createSourceFile('home.tsx',read('app/community/dating/cards/page.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let value;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)value=n.initializer.getText(ast);ts.forEachChild(n,visit);}visit(ast);assert.ok(value);return value;}
test('favorite acknowledgements update only saved candidates, preserve order/quota and cancel stale reads',()=>{
  let canceled=0,loading=true;
  let groups=[{source_card_id:'own',recommendations:[card('a'),card('b')],admin_recommendations:[card('c')],favorite_candidates:[],refresh_remaining:2,hidden_candidate_ids:[]},
    {source_card_id:'other',favorite_candidates:[card('d')]}];
  const handler=evaluate('exports.apply='+initializer('handleOneOnOneFavoriteChanged'),{oneOnOneRecommendationsRequest:{cancel(){canceled++;}},setOneOnOneRecommendations:fn=>groups=fn(groups),setOneOnOneRecommendationsLoading:v=>loading=v}).apply;
  handler('own','a',true);handler('own','a',true);assert.deepEqual(groups[0].favorite_candidates,[card('a')]);
  handler('own','c',true);assert.deepEqual(groups[0].favorite_candidates,[card('a'),card('c')]);
  handler('own','a',false);assert.deepEqual(groups[0].favorite_candidates,[card('c')]);
  handler('own','unknown',true);assert.deepEqual(groups[0].favorite_candidates,[card('c')]);
  groups[0].hidden_candidate_ids=['b'];handler('own','b',true);assert.deepEqual(groups[0].favorite_candidates,[card('c')]);
  assert.deepEqual(groups[0].recommendations,[card('a'),card('b')]);assert.equal(groups[0].refresh_remaining,2);
  assert.deepEqual(groups[1].favorite_candidates,[card('d')]);assert.equal(canceled,6);assert.equal(loading,false);
  assert.doesNotMatch(initializer('handleOneOnOneFavoriteChanged'),/fetch\(|setOneOnOneHome\(/);
});
test('favorite button uses existing API only, bounded request and acknowledged response',()=>{
  const source=read('components/dating/CandidateFavoriteButton.tsx');
  assert.match(source,/lock\.current = true/);assert.match(source,/body\.favorite !== !favorite/);
  assert.match(source,/method: favorite \? "DELETE" : "POST"/);assert.match(source,/, 15000\)/);
  assert.doesNotMatch(source,/payments|matches\/auto|recommendations\/refresh|setInterval/);
  assert.match(source,/onBusyChange\?\.\(true\)/);assert.match(source,/onBusyChange\?\.\(false\)/);
  assert.match(source,/useEffect\(\(\) => \(\) => \{ request\.current\?\.abort\(\)/);
  assert.match(source,/if \(controller\.signal\.aborted\) return/);
});
test('home adds no mount-time favorite endpoint; inbox and starter links are display-only',()=>{
  const home=read('app/community/dating/cards/page.tsx'),panel=read('components/dating/OneOnOneHomePanel.tsx');
  assert.doesNotMatch(home,/fetch\(["']\/api\/dating\/1on1\/favorites/);
  assert.match(home,/focusIncomingRequests=\{searchParams\.get\("focus"\) === "incoming"\}/);
  assert.match(panel,/id="one-on-one-incoming"/);assert.match(panel,/현재 응답할 요청이 없어요/);
  assert.match(panel,/onClick=\{\(\) => setAllCandidatesVisible\(true\)\}/);
  assert.match(home,/favorite_candidates: group\.favorite_candidates\?\.filter/);
  assert.match(panel,/arrivedFromOnboarding && viewerLoggedIn && hasOneOnOneCard && !loading && !sessionError && !error/);
});
test('reminder inbox destination survives the login redirect without changing exact-match priority',()=>{
  const code=read('components/dating/OneOnOneHomePanel.tsx'),ast=ts.createSourceFile('panel.tsx',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let call;
  function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='buildLoginRedirect')call=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);assert.ok(call);
  const href=(focusIncomingRequests,targetMatchId)=>evaluate('exports.href='+call,{focusIncomingRequests,targetMatchId,
    buildLoginRedirect:href=>'/login?redirect='+encodeURIComponent(href),oneOnOneMatchHref:id=>'/match?matchId='+id,ONE_ON_ONE_HOME_HREF:'/community/dating/cards?tab=one_on_one'}).href;
  assert.equal(new URL(href(true,null),'https://example.invalid').searchParams.get('redirect'),'/community/dating/cards?tab=one_on_one&focus=incoming');
  assert.equal(new URL(href(true,'safe-id'),'https://example.invalid').searchParams.get('redirect'),'/match?matchId=safe-id');
  assert.equal(new URL(href(false,null),'https://example.invalid').searchParams.get('redirect'),'/community/dating/cards?tab=one_on_one');
});
