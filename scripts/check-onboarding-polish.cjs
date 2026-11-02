/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {test}=require('node:test'),{createHash}=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
const contract=JSON.parse(read('scripts/fixtures/onboarding-polish-contract.json'));
function declarations(source,names){
  const result={},ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function visit(node){if(ts.isVariableDeclaration(node)&&names.includes(node.name.getText(ast)))result[node.name.getText(ast)]=node.getText(ast);ts.forEachChild(node,visit);}visit(ast);
  assert.equal(Object.keys(result).length,names.length);return result;
}
for(const [file,expected] of Object.entries(contract.files))test(file+' preserves reviewed save, validation and action handlers',()=>{
 const actual=Object.fromEntries(Object.entries(declarations(read(file),Object.keys(expected))).map(([name,source])=>[name,createHash('sha256').update(source).digest('hex')]));
 assert.deepEqual(actual,expected,'Review behavioral changes before updating the onboarding contract.');
});
test('first-sex presentation makes no requests and keeps pending/error feedback',()=>{
 const source=read('components/dating/ViewerSexSelection.tsx');
 assert.ok(!/fetch\(|createClient|localStorage|useEffect|useState|setTimeout/.test(source));
 assert.match(source,/disabled=\{saving\}/);assert.match(source,/onClick=\{\(\) => onSelect\(sex\)\}/);
 assert.match(source,/role="alert"/);assert.match(source,/role="status"/);
 assert.match(source,/type="button"/);
});

test('home contract covers matching, refreshing, payments and reads',()=>{
 const file='app/community/dating/cards/page.tsx',source=read(file),names=[];
 const ast=ts.createSourceFile('home.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function visit(node){if(ts.isVariableDeclaration(node)&&/^(handle|reload)[A-Z]/.test(node.name.getText(ast)))names.push(node.name.getText(ast));ts.forEachChild(node,visit);}visit(ast);
 assert.ok(names.length>=15);assert.deepEqual(names.sort(),Object.keys(contract.files[file]).sort());
});

test('profile invitation is presentational and never redirects or writes on render',()=>{
 const source=read('components/dating/ProfileStartCard.tsx');
 assert.ok(!/fetch\(|createClient|useEffect|useState|localStorage|router\./.test(source));
 assert.match(source,/href=\{href\}/);assert.match(source,/loginHref \?/);
 const home=read('app/community/dating/cards/page.tsx');
 assert.match(home,/href=\{viewerLoggedIn \? profileStartHref : "\/signup"\}/);
 assert.match(home,/loginHref=\{!viewerLoggedIn \? profileStartHref : undefined\}/);
 assert.match(home,/!showOneOnOneSection && !showLoveFortuneSection && !showDraftResumeCard/);
 assert.match(read('components/dating/OneOnOneHomePanel.tsx'),/!hasOneOnOneCard && !profileDraftAvailable/);
});
test('inputs do not zoom on mobile and choice controls expose their current state',()=>{
 const source=read('app/onboarding/dating/page.tsx');
 const field=source.slice(source.indexOf('function TextField('),source.indexOf('function Consent('));
 assert.match(field,/text-base/);assert.match(field,/min-w-0/);
 assert.match(source,/function Choice[\s\S]*aria-pressed=\{active\}/);
 assert.match(source,/aria-current=\{index === step \? "step" : undefined\}/);
 assert.match(read('components/dating/GuidedIntroductionField.tsx'),/rows=\{3\}[\s\S]*text-base/);
});
