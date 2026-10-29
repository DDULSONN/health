/* eslint-disable @typescript-eslint/no-require-imports */
// Actual member component, synthetic data, loopback only. No production writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),webpack=require('webpack');
const {chromium}=require('./test-browser-runtime.cjs');
const root=path.resolve(__dirname,'..'),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function main(){
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-care-recovery-'));
  await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/contact-care-browser.tsx'),output:{path:output,filename:'app.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':root,'next/navigation':path.join(__dirname,'fixtures/contact-care-navigation.ts')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});compiler.run((e,s)=>{compiler.close(()=>{});e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve();});});
  const cssRoot=process.env.CONTACT_CONVERSION_CSS_DIR||path.join(root,'.next/static/css');
  const css=fs.readdirSync(cssRoot).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(cssRoot,f),'utf8')).join('\n');
  let handlePost;
  const server=http.createServer((req,res)=>{
    if(req.method==='POST'&&req.url==='/api/dating/1on1/contact-care')return void handlePost(req,res);
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(output,'app.js')));}
    if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const capture={name:'대화 캡처.jpg',mimeType:'image/jpeg',buffer:await require('sharp')({create:{width:800,height:1200,channels:3,background:'white'}}).jpeg().toBuffer()};
  let browser;const passed=[];
  try{
    browser=await chromium.launch({headless:true});
    for(const scenario of ['apply-network','apply-committed','apply-timeout','apply-invalid-response','apply-recheck-fails','apply-business-rejection','manual-committed','claim-committed','manual-network','initial-read-fails','attachment-unreadable','attachment-stable']){
      const context=await browser.newContext({viewport:{width:390,height:844}});
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      if(scenario==='apply-timeout')await page.clock.install();
      if(scenario==='attachment-unreadable')await page.addInitScript(()=>{File.prototype.arrayBuffer=async()=>{throw Error('NotReadableError');};});
      let posts=0,reads=0,failReads=scenario==='initial-read-fails',mode=scenario,manualRemaining=scenario.startsWith('manual')?1:0,manualHistory=[],claim=scenario==='claim-committed'?{id:id(500),user_id:id(1),match_id:id(10),order_id:id(100),status:'approved',evidence_count:0,used_at:null}:null;
      let lateResponse,postError,postReceived;
      const postArrived=new Promise(resolve=>{postReceived=resolve;});
      handlePost=async(req,res)=>{
        try{
          posts++;const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);let payload;
          if(req.headers['content-type'].startsWith('multipart/form-data')){
            const form=await new Response(bytes,{headers:{'content-type':req.headers['content-type']}}).formData();payload=JSON.parse(form.get('payload'));
            assert.ok(Buffer.from(await form.get('evidence').arrayBuffer()).equals(capture.buffer),'actual HTTP server received exact attachment bytes');
            assert.equal(payload.orderId,id(100));assert.equal(payload.matchId,id(10));
          }else payload=JSON.parse(bytes.toString('utf8'));
          postReceived();
          if(mode==='apply-business-rejection'){res.writeHead(409,{'content-type':'application/json'});return res.end(JSON.stringify({error:'신청 가능한 정상 결제 건인지 확인해 주세요.'}));}
          if(mode==='apply-recheck-fails')failReads=true;
          if(mode==='apply-timeout'){lateResponse=res;return;}
          if(mode==='apply-invalid-response'){res.writeHead(502,{'content-type':'text/html'});return res.end('<html>gateway failed</html>');}
          if(mode==='apply-committed'||mode==='success'||mode==='attachment-stable')claim={id:id(500),user_id:id(1),match_id:id(10),order_id:id(100),status:'pending',evidence_count:1,created_at:new Date().toISOString(),used_at:null,first_contact_at:payload.firstContactAt,explanation:payload.explanation};
          if(mode==='manual-committed'){assert.equal(payload.action,'redeem_manual');assert.equal(payload.matchId,id(20));manualRemaining--;manualHistory.push({used_match_id:id(20),used_at:new Date().toISOString()});}
          if(mode==='claim-committed'){assert.equal(payload.action,'redeem');assert.equal(payload.matchId,id(20));claim={...claim,used_at:new Date().toISOString(),used_match_id:id(20)};}
          if(mode==='success'||mode==='attachment-stable'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true}));}
          // A partial response models a lost result without a browser silently
          // retrying a reused HTTP socket before it receives any response bytes.
          res.writeHead(200,{'content-type':'application/json'});res.write('{"ok":');setTimeout(()=>res.destroy(),20);
        }catch(error){postError=error;postReceived();res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'fixture validation failed'}));}
      };
      await context.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());if(url.origin!==origin)throw Error('external request forbidden');
        if(!url.pathname.startsWith('/api/'))return route.continue();
        assert.equal(url.pathname,'/api/dating/1on1/contact-care','no payment or other mutation API calls');
        // WebKit's intercepted postData omits file contents. Validate the bytes
        // received by an actual loopback server instead of trusting interception.
        if(req.method()==='POST'){
          if(['apply-network','manual-network','apply-recheck-fails'].includes(mode)){
            posts++;if(mode==='apply-recheck-fails')failReads=true;return route.abort('failed');
          }
          return route.continue();
        }
        if(url.searchParams.get('summary')==='1')return route.fulfill({json:{remaining:manualRemaining+(claim?.status==='approved'&&!claim.used_at?1:0)}});
        reads++;if(failReads)return route.abort('failed');
        return route.fulfill({json:{active:true,claim,manual_remaining:manualRemaining,manual_history:manualHistory,payments:!claim?[{id:id(10),order_id:id(100),name:'예시 상대',exchanged_at:new Date(Date.now()-48*3600000).toISOString()}]:[],matches:(manualRemaining>0||claim?.status==='approved'&&!claim.used_at)?[{id:id(20),name:'새 상대'}]:[]}});
      });
      const member=page.getByRole('region',{name:'회원 화면'});
      await page.goto(origin);await member.locator('summary').click();
      if(scenario==='initial-read-fails'){
        await member.getByRole('alert').waitFor();assert.doesNotMatch(await member.getByRole('alert').innerText(),/Failed to fetch/);assert.equal(posts,0);
        failReads=false;await member.getByRole('button',{name:'내역 다시 확인'}).click();await member.getByLabel('내가 결제한 상대').waitFor();assert.equal(reads,2);
      }else if(scenario.startsWith('manual')||scenario==='claim-committed'){
        await member.getByLabel(scenario.startsWith('manual')?'추가 지급 교환권으로 교환할 상대':'교환할 상대',{exact:true}).selectOption(id(20));
        page.on('dialog',d=>d.accept());await member.getByRole('button',{name:'이 매칭에 교환권 사용'}).evaluate(b=>{b.click();b.click();});
        if(scenario==='manual-network'){
          await member.getByText(/아직 완료 내역이 확인되지/).waitFor();assert.equal(reads,2);assert.equal(manualRemaining,1);assert.equal(await member.getByLabel('추가 지급 교환권으로 교환할 상대').inputValue(),id(20));
        }else{
          await member.getByText(/교환권 사용을 확인했어요/).waitFor();assert.equal(reads,2);
          if(scenario==='manual-committed'){assert.equal(manualRemaining,0);await member.getByText('최근 교환권 사용 내역',{exact:true}).click();}else assert.ok(claim.used_at);
          assert.equal(await member.getByRole('link',{name:/연락처 확인/}).getAttribute('href'),`/community/dating/cards?tab=one_on_one&matchId=${id(20)}#selected-one-on-one-match`);
        }
        assert.equal(posts,1);
      }else{
        await member.getByLabel('내가 결제한 상대').selectOption(id(100));
        const first=new Date(Date.now()-36*3600000),local=new Date(first-first.getTimezoneOffset()*60000).toISOString().slice(0,16);
        const explanation='문자로 첫 인사를 보낸 뒤 24시간이 지났지만 아직 답장이 오지 않았습니다.';
        await member.getByLabel('첫 연락을 보낸 시각').fill(local);await member.getByLabel('연락 방법과 상황').fill(explanation);await member.getByRole('checkbox').check();await member.getByLabel(/대화 캡처/).setInputFiles(capture);
        if(scenario==='attachment-unreadable'){
          await member.getByRole('alert').waitFor();assert.match(await member.getByRole('alert').innerText(),/휴대폰에 저장한 뒤 다시 선택/);assert.equal(await member.getByRole('button',{name:'교환권 신청',exact:true}).isEnabled(),false);assert.equal(posts,0);assert.equal(await member.getByLabel('연락 방법과 상황').inputValue(),explanation);
        }else{
          await member.getByText(/1장 선택됨/).waitFor();
          if(scenario==='attachment-stable')await page.evaluate(()=>{File.prototype.arrayBuffer=async()=>{throw Error('original file access expired');};});
          const requestSeen=scenario==='apply-timeout'?page.waitForRequest(r=>r.method()==='POST'):null;
          await member.getByRole('button',{name:'교환권 신청',exact:true}).evaluate(b=>{b.click();b.click();});
          if(scenario==='apply-timeout'){
            await requestSeen;await postArrived;
            await page.clock.fastForward(45001);
          }
          if(scenario==='apply-committed'||scenario==='attachment-stable'){
            await member.getByText('신청 검토 중',{exact:true}).waitFor();assert.equal(claim.status,'pending');assert.equal(await member.getByRole('button',{name:'교환권 신청',exact:true}).count(),0);
          }else if(scenario==='apply-business-rejection'){
            await member.getByRole('alert').waitFor();assert.match(await member.getByRole('alert').innerText(),/정상 결제/);assert.equal(reads,1,'definite business rejection is not automatically retried');
          }else{
            if(scenario==='apply-recheck-fails'){
              await member.getByRole('alert').waitFor();assert.doesNotMatch(await member.getByRole('alert').innerText(),/Failed to fetch/);assert.equal(await member.getByRole('button',{name:'교환권 신청',exact:true}).isEnabled(),false);assert.equal(reads,2);
              failReads=false;await member.getByRole('button',{name:'내역 다시 확인'}).click();
            }
            await member.getByText(/아직 완료 내역이 확인되지/).waitFor();assert.equal(posts,1);assert.equal(await member.getByLabel('내가 결제한 상대').inputValue(),id(100));assert.equal(await member.getByLabel('첫 연락을 보낸 시각').inputValue(),local);assert.equal(await member.getByLabel('연락 방법과 상황').inputValue(),explanation);assert.equal(await member.getByRole('checkbox').isChecked(),true);assert.equal(await member.getByText(/1장 선택됨/).count(),1);
            if(scenario==='apply-network'){
              for(const width of [320,390,768]){await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,`recovered-${width}.png`),fullPage:true});}
              mode='success';await member.getByRole('button',{name:'교환권 신청',exact:true}).click();await member.getByText('신청 검토 중',{exact:true}).waitFor();assert.equal(posts,2,'only explicit retry sends a second mutation');
            }
          }
          if(scenario!=='apply-network')assert.equal(posts,1,scenario+' sends one mutation');
        }
      }
      if(postError)throw postError;assert.deepEqual(errors,[]);passed.push(scenario);lateResponse?.destroy();await context.close();
    }
    console.log(JSON.stringify({ok:true,scenarios:passed,paymentRequests:0,productionWrites:0,screenshots:output}));
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
