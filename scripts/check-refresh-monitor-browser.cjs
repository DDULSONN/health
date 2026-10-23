/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const webpack=require('webpack'),{chromium}=require('./test-browser-runtime.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-refresh-monitor-'));
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/refresh-monitor-browser.tsx'),
      output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':root}},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/mypage-navigation-loader.cjs')}]}});
    compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();});
  });
  const cssDir=path.join(root,'.next/static/css'),css=fs.readdirSync(cssDir).filter(p=>p.endsWith('.css')).map(p=>fs.readFileSync(path.join(cssDir,p),'utf8')).join('\n');
  const server=http.createServer((req,res)=>{
    if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(output,'fixture.js')));}
    else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);}
    else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  let browser,checked=0;
  try{
    browser=await chromium.launch({headless:true});
    for(const width of [320,390,1024])for(const scenario of ['empty','ready','missing','error','conflict']){
      const context=await browser.newContext({viewport:{width,height:850}}),page=await context.newPage(),errors=[],writes=[];
      let settings={mode:'observe',email_enabled:false},accept=true,dialogs=0;
      page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs++;if(accept)await d.accept();else await d.dismiss();});
      await context.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'external calls forbidden');
        if(!url.pathname.startsWith('/api/'))return route.continue();
        assert.equal(url.pathname,'/api/admin/dating/1on1/refresh-monitor');
        if(req.method()==='PATCH'){
          const body=req.postDataJSON();writes.push(body);assert.equal(body.expected_mode,settings.mode);assert.equal(body.expected_email_enabled,settings.email_enabled);
          if(scenario==='conflict')return route.fulfill({status:409,json:{error:'다른 화면에서 설정이 바뀌었습니다. 다시 불러와 주세요.'}});
          settings={mode:body.mode,email_enabled:body.email_enabled};return route.fulfill({json:{ok:true,settings}});
        }
        if(scenario==='error')return route.fulfill({status:503,json:{error:'점검 결과를 읽지 못했습니다.'}});
        if(scenario==='missing')return route.fulfill({json:{configured:false}});
        const index=Number(url.searchParams.get('page')||0),findings=['healthy','pool_small','repeat_review','repair_ready','repaired','fit_review'];
        return route.fulfill({json:{configured:true,settings,total:scenario==='empty'?0:21,pending:3,
          items:scenario==='empty'?[]:index===1?[{id:'last',name:'마지막 테스트',day:'2026-10-22',state:'done',finding:'healthy',pool:25,overlap:2,shown:10,widened:0,ageMismatch:0,emailState:'none'}]:findings.map((finding,i)=>({
            id:String(i),name:i===0?'검증회원 <script>':`테스트 ${i}`,day:'2026-10-22',state:'done',finding,pool:35,overlap:8,shown:10,widened:3,ageMismatch:1,emailState:i===4?'sent':'none',checkedAt:'2026-10-23T01:00:00Z',
          }))}});
      });
      await page.goto(origin);const panel=page.getByRole('region',{name:'1:1 새로고침 일일 점검'});
      if(scenario==='missing'){await panel.getByText('점검 SQL 설치가 필요합니다.',{exact:false}).waitFor();assert.equal(await panel.getByRole('combobox').count(),0);}
      else if(scenario==='error'){await panel.getByRole('alert').waitFor();}
      else if(scenario==='empty'){await panel.getByText('아직 기록이 없습니다.',{exact:false}).waitFor();assert.equal(await panel.getByRole('button',{name:'다음',exact:true}).isDisabled(),true);}
      else if(scenario==='conflict'){
        await panel.getByRole('combobox').selectOption('repair');await panel.getByRole('alert').waitFor();
        assert.equal(await panel.getByRole('combobox').inputValue(),'observe');assert.equal(writes.length,1);
      }else{
        await panel.getByText('검증회원 <script>',{exact:true}).waitFor();assert.equal(await panel.locator('script').count(),0);
        assert.equal(await panel.getByRole('checkbox').isDisabled(),true);
        accept=false;await panel.getByRole('combobox').selectOption('repair');assert.equal(writes.length,0);accept=true;
        await panel.getByRole('combobox').selectOption('repair');await page.waitForFunction(()=>document.querySelector('select')?.value==='repair');
        await panel.getByRole('checkbox').click();await page.waitForFunction(()=>document.querySelector('input[type=checkbox]')?.checked===true);
        assert.equal(writes.length,2);assert.equal(dialogs,3);
        await panel.getByRole('button',{name:'다음',exact:true}).click();await panel.getByText('마지막 테스트').waitFor();
        assert.equal(await panel.getByRole('button',{name:'다음',exact:true}).isDisabled(),true);
        await panel.getByRole('button',{name:'이전',exact:true}).click();await panel.getByText('후보 풀 부족',{exact:true}).waitFor();
        await panel.getByRole('combobox').selectOption('off');await page.waitForFunction(()=>document.querySelector('select')?.value==='off');
        assert.equal(await panel.getByRole('checkbox').isChecked(),false);assert.equal(writes.length,3);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.doesNotMatch(await panel.innerText(),/�/);assert.deepEqual(errors,[]);
      await page.screenshot({path:path.join(output,`${scenario}-${width}.png`),fullPage:true});checked++;await context.close();
    }
    console.log(JSON.stringify({checked,output,liveRequests:0}));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
