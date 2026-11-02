/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),webpack=require('webpack');
const {chromium}=require('./test-browser-runtime.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-confirmation-browser-'));
  const adapter=path.join(__dirname,'fixtures/payment-confirmation-adapters.tsx');
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/payment-confirmation-browser.tsx'),output:{path:out,filename:'fixture.js'},
      resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':root,'next/navigation':adapter,'next/link':adapter}},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});
    compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();});
  });
  const cssDir=process.env.CONTACT_CONVERSION_CSS_DIR || path.join(root,'.next/static/css');
  assert.ok(fs.existsSync(cssDir),'Built CSS is required for mobile overflow inspection');
  const css=fs.readdirSync(cssDir).filter(n=>n.endsWith('.css')).map(n=>fs.readFileSync(path.join(cssDir,n),'utf8')).join('\n');
  const server=http.createServer((req,res)=>{
    if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(out,'fixture.js')));}
    else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);}
    else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port, browser=await chromium.launch({headless:true});
  try{
    for(const mode of ['failed','success','recover','missing']){
      const context=await browser.newContext({viewport:{width:360,height:800}}),page=await context.newPage();
      const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin!==origin){await route.abort();throw Error('External request blocked: '+url.origin);}
        if(url.pathname==='/api/payments/toss/confirm'){
          const body=request.postDataJSON();calls.push(body);
          await new Promise(resolve=>setTimeout(resolve,180));
          const fail=mode==='failed'||(mode==='recover'&&calls.length===1);
          await route.fulfill({status:fail?502:200,contentType:'application/json',body:JSON.stringify(fail?{ok:false,message:'결제 승인 결과를 확인하지 못했어요. 다시 결제하지 말고 결제센터에서 내역을 확인해 주세요.'}:{ok:true,productType:'one_on_one_contact_exchange',orderId:'synthetic_order',matchId:'00000000-0000-4000-8000-000000000010',amount:18000})});return;
        }
        if(url.pathname.startsWith('/api/'))throw Error('Unexpected API '+url.pathname);
        await route.continue();
      });
      await page.goto(origin+(mode==='missing'?'/':'/?paymentKey=synthetic&orderId=synthetic_order&amount=18000'));
      if(mode!=='missing'){
        await page.getByRole('heading',{name:'결제 확인 중이에요'}).waitFor();
        assert.equal(await page.getByRole('heading',{name:'결제가 완료됐어요',exact:true}).count(),0);
      }
      await page.getByRole('heading',{name:['failed','missing'].includes(mode)?'결제 확인이 필요해요':'결제가 완료됐어요',exact:true}).waitFor();
      if(['failed','missing'].includes(mode))assert.equal(await page.getByRole('link',{name:'결제센터에서 확인'}).getAttribute('href'),'/mypage?section=payment');
      assert.equal(calls.length,{failed:3,success:1,recover:2,missing:0}[mode]);
      assert.ok(calls.every(c=>c.orderId==='synthetic_order'&&c.amount==='18000'&&c.paymentKey==='synthetic'));
      assert.deepEqual(errors,[]);assert.ok(!(await page.locator('body').innerText()).includes('\uFFFD'));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
      await page.screenshot({path:path.join(out,mode+'.png'),fullPage:true});
      await context.close();
    }
    console.log('Payment confirmation browser: loading, failure, success, recovery, missing parameters and mobile layout passed. '+out);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
