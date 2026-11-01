/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),webpack=require('webpack');
const {chromium}=require('./test-browser-runtime.cjs');
const root=path.resolve(__dirname,'..'),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function main(){
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-admin-vouchers-'));
 await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/admin-contact-vouchers-browser.tsx'),output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':root}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});compiler.run((e,s)=>{compiler.close(()=>{});e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve();});});
 const cssRoot=process.env.CONTACT_CONVERSION_CSS_DIR||path.join(root,'.next/static/css');
 const css=fs.readdirSync(cssRoot).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(cssRoot,f),'utf8')).join('\n');
 const server=http.createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(output,'fixture.js')));}else if(req.url==='/fixture.css'){res.setHeader('content-type','text/css');res.end(css);}else{res.setHeader('content-type','text/html; charset=utf-8');res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 try {
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844}});
  let reads=0,writes=0,balance=1,installed=true,canGrant=true,loseResponse=false,rejectChanged=false;const requests=new Map(),payloads=[],errors=[];
  await context.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);assert.equal(url.pathname,'/api/admin/contact-care/vouchers','only admin grant endpoint');
   if(req.method()==='GET'){reads++;const userId=url.searchParams.get('userId');return route.fulfill({json:{member:{id:userId,nickname:userId===id(1)?'검증회원':'다른회원',canGrant},installed,manualRemaining:balance,claimRemaining:0,remaining:balance,history:[]}});}
   writes++;const body=req.postDataJSON();payloads.push(body);assert.equal(body.confirmed,true);assert.equal(body.userId,id(1));
   if(rejectChanged)return route.fulfill({status:409,json:{error:'회원 상태가 바뀌어 지급하지 않았어요.',resetRequest:true}});
   const already=requests.has(body.requestId);if(!already){balance+=body.quantity;requests.set(body.requestId,body);}else assert.deepEqual(body,requests.get(body.requestId));
   if(loseResponse){loseResponse=false;return route.abort('failed');}
   await new Promise(r=>setTimeout(r,100));return route.fulfill({json:{ok:true,requestId:body.requestId,quantity:body.quantity,alreadyGranted:already,remaining:balance}});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const open=async()=>{await page.locator('summary').first().click();await page.getByLabel('1:1 교환권 지급 수량').waitFor();};
  const prepare=async(q='1')=>{await page.getByLabel('1:1 교환권 지급 수량').selectOption(q);await page.getByLabel('1:1 교환권 지급 사유').fill('고객 문의 확인 후 추가 지급');await page.getByRole('button',{name:'지급 내용 확인',exact:true}).click();};
  await page.goto(origin);assert.equal(reads,0);assert.equal(writes,0);await open();await prepare('3');assert.equal(writes,0);
  await page.getByRole('button',{name:'취소',exact:true}).click();assert.equal(writes,0);
  await prepare('3');await page.screenshot({path:path.join(output,'confirmation-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'확인하고 지급',exact:true}).evaluate(b=>{b.click();b.click();});
  await page.getByRole('button',{name:'새 지급 준비'}).waitFor();assert.equal(writes,1);assert.equal(balance,4);
  assert.equal(await page.evaluate(()=>sessionStorage.length),0);assert.match(await page.locator('body').innerText(),/교환권 3장을 지급/);
  await page.getByRole('button',{name:'새 지급 준비'}).click();await prepare();loseResponse=true;
  await page.getByRole('button',{name:'확인하고 지급',exact:true}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/같은 요청/);assert.equal(balance,5);
  const uncertain=payloads.at(-1);assert.equal(await page.getByRole('button',{name:'취소',exact:true}).count(),0);
  await page.reload();await page.locator('summary').first().click();await page.getByRole('button',{name:'같은 요청으로 지급 확인'}).waitFor();
  await page.getByRole('button',{name:'같은 요청으로 지급 확인'}).click();await page.getByRole('button',{name:'새 지급 준비'}).waitFor();
  assert.deepEqual(payloads.at(-1),uncertain);assert.equal(balance,5);assert.match(await page.locator('body').innerText(),/추가 지급하지 않았어요/);
  await page.getByRole('button',{name:'새 지급 준비'}).click();await prepare();rejectChanged=true;
  await page.getByRole('button',{name:'확인하고 지급',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>sessionStorage.length),0);assert.equal(balance,5);
  assert.equal(await page.getByRole('button',{name:'지급 내용 확인',exact:true}).isEnabled(),false);rejectChanged=false;
  await page.getByRole('button',{name:'내역 다시 확인'}).click();await page.getByLabel('1:1 교환권 지급 사유').fill('다시 확인 후 지급');
  await page.getByRole('button',{name:'지급 내용 확인',exact:true}).click();
  await page.getByRole('button',{name:'다른 회원 선택'}).click();await page.locator('summary').first().click();await page.getByText('다른회원 · 보유 5장',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'확인하고 지급',exact:true}).count(),0);
  installed=false;await page.getByRole('button',{name:'내역 다시 확인'}).click();await page.getByText('관리자 지급 SQL 적용 후 사용할 수 있어요.').waitFor();assert.equal(await page.getByLabel('1:1 교환권 지급 수량').isEnabled(),false);
  installed=true;canGrant=false;await page.getByRole('button',{name:'내역 다시 확인'}).click();await page.getByText(/미인증 회원에게는/).waitFor();assert.equal(await page.getByLabel('1:1 교환권 지급 수량').isEnabled(),false);
  canGrant=true;await page.goto(origin);await open();await prepare();
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('denied');};});const before=writes;
  await page.getByRole('button',{name:'확인하고 지급',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(writes,before);assert.match(await page.getByRole('alert').innerText(),/보내지 않았어요/);
  for(const width of [360,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  assert.deepEqual(errors,[]);console.log('PASS: lazy load, confirmation, cancel, double-click, network-loss/reload replay, member change, SQL missing, banned, storage failure, responsive layout; '+output);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
