/* eslint-disable @typescript-eslint/no-require-imports */
// Real component -> actual POST route -> local PostgreSQL -> sender GET -> UI.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),webpack=require('webpack');
const {chromium}=require('./test-browser-runtime.cjs');
const {runtime,id}=require('./fixtures/contact-nudge-read-runtime.cjs');
async function main(){
  const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-nudge-read-'));
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/contact-nudge-read-browser.tsx'),
      output:{path:out,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'next/link':path.join(__dirname,'fixtures/profile-ux-adapters.tsx'),'@':root}},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]},
    });
    compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();});
  });
  const cssRoot=process.env.CONTACT_CONVERSION_CSS_DIR;assert.ok(cssRoot&&fs.existsSync(cssRoot));
  const css=fs.readdirSync(cssRoot).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(cssRoot,f),'utf8')).join('\n');
  const r=await runtime();let posts=0,fail=false,browser;
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(out,'fixture.js')));return;}
      if(url.pathname==='/fixture.css'){res.setHeader('content-type','text/css');res.end(css);return;}
      if(url.pathname.startsWith('/api/')){
        let response;
        if(url.pathname==='/api/test-summary'){
          response=await r.routes(url.searchParams.get('role')==='sender'?id(1):id(2)).get(new Request('https://example.test/my'));
        }else{
          assert.equal(req.method,'POST');assert.equal(url.pathname,`/api/dating/1on1/matches/${id(10)}/nudge/read`);
          posts++;let body='';for await(const chunk of req)body+=chunk;
          assert.deepEqual(JSON.parse(body),{nudgeId:id(30)});
          response=fail?Response.json({error:'test offline'},{status:503}):await r.routes().post(r.request(JSON.parse(body)),r.params);
        }
        res.statusCode=response.status;res.setHeader('content-type','application/json');res.end(await response.text());return;
      }
      res.setHeader('content-type','text/html; charset=utf-8');res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
    }catch(e){res.statusCode=500;res.end(String(e));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const readAt=async()=> (await r.db.query('select read_at from dating_1on1_contact_nudges')).rows[0].read_at;
  const reset=async()=>{await r.db.exec('update dating_1on1_contact_nudges set read_at=null');posts=0;fail=false;};
  try{
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const waitPost=async()=>{for(let i=0;i<40&&!posts;i++)await page.waitForTimeout(100);assert.equal(posts,1);};
    for(const mode of ['collapsed','offscreen','covered','background','receiver','offer']){
      await reset();await page.goto(origin+'?mode='+mode);
      if(mode==='background')await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
      if(['collapsed','offscreen','covered','background'].includes(mode)){
        await page.waitForTimeout(1400);assert.equal(posts,0,mode+' must not mark read');assert.equal(await readAt(),null);
        if(mode==='collapsed')await page.locator('summary').click();
        if(mode==='offscreen'){
          await page.getByText('“연락처 교환해 주시면 첫 커피는 제가 살게요 ☕”').scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(1200);
          assert.equal(posts,0,'fast scroll is not a read');
          await page.getByText('“연락처 교환해 주시면 첫 커피는 제가 살게요 ☕”').scrollIntoViewIfNeeded();
        }
        if(mode==='covered'){await page.getByRole('button',{name:'덮개 닫기'}).click();await page.evaluate(()=>dispatchEvent(new Event('focus')));}
        if(mode==='background')await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
      }
      await waitPost();for(let i=0;i<30&&!await readAt();i++)await page.waitForTimeout(100);
      assert.ok(await readAt());const first=String(await readAt());
      await page.evaluate(()=>{dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
      await page.waitForTimeout(1300);assert.equal(posts,1);assert.equal(String(await readAt()),first);
      assert.equal(await page.getByRole('button',{name:'확인',exact:true}).count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    await page.goto(origin+'?mode=sender');await page.getByText('상대가 확인함',{exact:true}).waitFor();
    assert.match(await page.locator('main').innerText(),/수락·결제 의사를 뜻하지 않아요/);
    await page.screenshot({path:path.join(out,'sender-390.png')});
    await reset();fail=true;await page.goto(origin);await waitPost();await page.waitForTimeout(1800);
    assert.equal(await readAt(),null);assert.equal(posts,1,'no polling after failure');
    fail=false;await page.evaluate(()=>dispatchEvent(new Event('focus')));
    for(let i=0;i<40&&posts<2;i++)await page.waitForTimeout(100);
    assert.equal(posts,2);for(let i=0;i<30&&!await readAt();i++)await page.waitForTimeout(100);assert.ok(await readAt());
    for(const width of [320,390,768]){
      await reset();await page.setViewportSize({width,height:844});await page.goto(origin);await waitPost();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(out,`received-${width}.png`)});
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: viewport/background/collapsed/fast scroll/overlay, actual API+SQL, sender view, retry bounds, 320/390/768px. Screenshots: '+out);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await r.db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
