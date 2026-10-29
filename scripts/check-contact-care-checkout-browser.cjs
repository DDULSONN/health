/* eslint-disable @typescript-eslint/no-require-imports */
// Real component, loopback/synthetic orders only. Never reaches a payment API.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),webpack=require('webpack');
const {chromium}=require('./test-browser-runtime.cjs');
const root=path.resolve(__dirname,'..'),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function until(check){for(let i=0;i<500;i++){if(await check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected request did not complete');}
async function main(){
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-care-checkout-'));
  await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/contact-care-browser.tsx'),output:{path:output,filename:'app.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':root,'next/navigation':path.join(__dirname,'fixtures/contact-care-navigation.ts')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});compiler.run((e,s)=>{compiler.close(()=>{});e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve();});});
  const cssRoot=process.env.CONTACT_CONVERSION_CSS_DIR||path.join(root,'.next/static/css');
  const css=fs.readdirSync(cssRoot).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(cssRoot,f),'utf8')).join('\n');
  const server=http.createServer((req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(output,'app.js')));}
    if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  let browser;const passed=[];
  try{
    browser=await chromium.launch({headless:true});
    for(const scenario of ['manual-expired','claim-expired','still-active','network','timeout','invalid-response','collapsed','hidden','other-target','credit-used-elsewhere']){
      console.log('Checking checkout recovery:',scenario);
      const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
      let checks=0,redeems=0,reads=0,cleared=false,used=false,failed=false;
      const claimMode=scenario==='claim-expired';
      await context.route('**/api/**',async route=>{
        const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
        assert.equal(url.pathname,'/api/dating/1on1/contact-care','no payment/phone API');
        if(req.method()==='POST'){
          const body=req.postDataJSON();assert.equal(body.matchId,id(20));
          if(body.action==='check_checkout'){
            checks++;assert.equal(body.confirmed,undefined,'status check carries no redemption consent');
            if(!failed&&['network','timeout','invalid-response'].includes(scenario)){
              failed=true;
              if(scenario==='network')return route.abort('failed');
              if(scenario==='timeout')return; // Intentional hang: bounded client deadline.
              return route.fulfill({json:{ok:true}});
            }
            if(scenario==='credit-used-elsewhere')return route.fulfill({status:409,json:{code:'CARE_NO_CREDIT',error:'사용 가능한 교환권이 없어요. 사용 내역을 확인해 주세요.'}});
            cleared=scenario!=='still-active';return route.fulfill({json:{ok:true,checkoutCleared:cleared}});
          }
          assert.equal(body.action,claimMode?'redeem':'redeem_manual');assert.equal(body.confirmed,true);redeems++;
          if(!cleared)return route.fulfill({status:409,json:{code:'CARE_CHECKOUT',error:'진행 중인 결제'}});
          used=true;return route.fulfill({json:{ok:true}});
        }
        if(url.searchParams.get('summary')==='1')return route.fulfill({json:{remaining:1}});
        reads++;return route.fulfill({json:{active:true,payments:[],matches:used?[]:[{id:id(20),name:'예시 상대'},{id:id(21),name:'다른 상대'}],
          manual_remaining:claimMode||used?0:1,manual_history:!claimMode&&used?[{used_match_id:id(20),used_at:new Date().toISOString()}]:[],
          claim:claimMode?{id:id(500),match_id:id(10),order_id:id(100),status:'approved',evidence_count:0,used_at:used?new Date().toISOString():null,used_match_id:used?id(20):null}:null}});
      });
      const member=page.getByRole('region',{name:'회원 화면'}),button=member.getByRole('button',{name:'이 매칭에 교환권 사용'});
      await page.goto(origin);
      // Await actual effect registration/cleanup before advancing virtual time.
      // WebKit can paint text before React's passive effects have run.
      await page.evaluate(()=>{
        const set=window.setInterval.bind(window),clear=window.clearInterval.bind(window);
        window.careTestTimers=new Set();
        window.setInterval=(callback,delay,...args)=>{const timer=set(callback,delay,...args);if(delay===60000)window.careTestTimers.add(timer);return timer;};
        window.clearInterval=timer=>{window.careTestTimers.delete(timer);return clear(timer);};
      });
      await member.locator('summary').click();
      const select=member.getByLabel(claimMode?'교환할 상대':'추가 지급 교환권으로 교환할 상대',{exact:true});
      await select.selectOption(id(20));page.on('dialog',d=>d.accept());
      await button.evaluate(b=>{b.click();b.click();});
      await member.getByText(/1분 간격으로 다시 확인/).waitFor();
      await until(()=>page.evaluate(()=>window.careTestTimers.size===1));
      assert.equal(redeems,1);assert.equal(checks,0);assert.equal(await button.isEnabled(),false);assert.equal(await select.isEnabled(),true);
      if(scenario==='collapsed'){
        await member.locator('summary').click();await until(()=>page.evaluate(()=>window.careTestTimers.size===0));await page.clock.runFor(180001);assert.equal(checks,0);
        await member.locator('summary').click();
      }else if(scenario==='hidden'){
        await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'}));
        await page.clock.runFor(180001);assert.equal(checks,0);
        await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'}));
        await page.clock.runFor(60001);
      }else if(scenario==='other-target'){
        await select.selectOption(id(21));assert.equal(await button.isEnabled(),true);
        await until(()=>page.evaluate(()=>window.careTestTimers.size===0));
        await page.clock.runFor(180001);assert.equal(checks,0);
        await select.selectOption(id(20));assert.equal(await button.isEnabled(),false);
        await until(()=>page.evaluate(()=>window.careTestTimers.size===1));
        await member.getByRole('button',{name:'내역 다시 확인'}).click();
      }else{
        await page.clock.runFor(30000);assert.equal(checks,0);
        await page.clock.runFor(31000);
      }
      if(scenario==='timeout'){
        await until(()=>checks===1);
        await page.clock.runFor(12001);
      }
      if(['network','timeout','invalid-response'].includes(scenario)){
        await member.getByRole('alert').waitFor();assert.equal(await button.isEnabled(),false);assert.equal(redeems,1);
        await member.getByRole('button',{name:'내역 다시 확인'}).click();
      }
      if(scenario==='still-active'){
        await until(()=>reads===2);
        assert.equal(checks,1);assert.equal(await button.isEnabled(),false);assert.equal(used,false);
      }else if(scenario==='credit-used-elsewhere'){
        try { await member.getByRole('alert').waitFor({timeout:5000}); }
        catch(e){console.error({scenario,checks,redeems,reads,visibility:await page.evaluate(()=>document.visibilityState),text:await member.innerText()});throw e;}
        assert.equal(await button.isEnabled(),false);
        await until(()=>page.evaluate(()=>window.careTestTimers.size===0));await page.clock.runFor(180001);assert.equal(checks,1,'definite rejection stops automatic checks');
      }else{
        try { await member.getByText(/결제 대기가 해소됐어요/).waitFor({timeout:5000}); }
        catch(e){console.error({scenario,checks,redeems,reads,cleared,visibility:await page.evaluate(()=>document.visibilityState),text:await member.innerText()});throw e;}
        await until(()=>page.evaluate(()=>window.careTestTimers.size===0));
        assert.equal(await button.isEnabled(),true);assert.equal(used,false);assert.equal(redeems,1,'recovery cannot automatically spend');
        assert.equal(await select.inputValue(),id(20));
        if(scenario==='manual-expired'){
          for(const width of [320,390,768]){await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,`checkout-recovered-${width}.png`),fullPage:true});}
          await button.click();await member.getByText(/교환권으로 번호 교환을 완료/).waitFor();assert.equal(redeems,2);assert.equal(used,true);
        }
        const done=checks;await page.clock.runFor(180001);assert.equal(checks,done,'resolved checkout stops polling');
      }
      assert.deepEqual(errors,[]);passed.push(scenario);await context.close();
    }
    console.log(JSON.stringify({ok:true,scenarios:passed,paymentRequests:0,productionWrites:0,screenshots:output}));
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
