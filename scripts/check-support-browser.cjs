const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const webpack=require('webpack');const {chromium}=require('./test-browser-runtime.cjs');
const root=path.resolve(__dirname,'..');
async function main(){
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'support-browser-'));
 await new Promise((resolve,reject)=>{
  const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/support-browser.tsx'),output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@/lib/supabase/client':path.join(__dirname,'fixtures/support-auth.ts'),'@':root,'next/link':path.join(__dirname,'fixtures/payment-confirmation-adapters.tsx')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});
  compiler.run((e,s)=>compiler.close(()=>e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve()));
 });
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/fixture.js'?fs.readFileSync(path.join(output,'fixture.js')):'<html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/fixture.js"></script></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const row={id:'fixture',user_id:'member',nickname:'검증회원',category:'payment',subject:'결제 확인 요청',message:'결제 내역을 확인해 주세요.',status:'open',admin_reply:null,created_at:new Date().toISOString(),triage:{kind:'important',needs_attention:true,automatic:false,reason:'결제 문의',summary:'결제 내역 확인',draft:'안녕하세요. 확인 후 안내드리겠습니다.'}};
  let saves=0;
  await page.route('**/api/admin/support*',async route=>{
   if(route.request().method()==='PATCH'){const b=route.request().postDataJSON();assert.equal(b.expected_status,'open');assert.equal(b.expected_reply,null);assert.ok(b.admin_reply.includes('안녕하세요'));saves++;return route.fulfill({json:{ok:true}});}
   const view=new URL(route.request().url()).searchParams.get('view');return route.fulfill({json:{items:view==='auto'?[]:[row],nextOffset:null}});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('button',{name:'답변 초안 가져오기'}).click();
  assert.match(await page.locator('textarea').inputValue(),/안녕하세요/);
  await page.getByRole('button',{name:'답변 완료 저장'}).click();await page.waitForFunction(()=>document.querySelector('textarea')?.value==='');assert.equal(saves,1);
  await page.getByRole('button',{name:'자동답변 완료',exact:true}).click();await page.getByText('접수된 문의가 없습니다.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'중요 · 관리자 확인',exact:true}).click();await page.getByRole('button',{name:'답변 초안 가져오기'}).waitFor();
  assert.deepEqual(errors,[]);console.log('Support UI: attention panel, category tabs, draft, save/CAS and empty state passed');
 }finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(output,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
