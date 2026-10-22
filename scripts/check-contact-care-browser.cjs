/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),webpack=require('webpack');
const {chromium}=require('./test-browser-runtime.cjs');
const root=path.resolve(__dirname,'..');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function main(){
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-contact-care-'));
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/contact-care-browser.tsx'),output:{path:output,filename:'fixture.js'},
      resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':root,'next/navigation':path.join(__dirname,'fixtures/contact-care-navigation.ts')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});
    compiler.run((e,s)=>{compiler.close(()=>{});if(e||s.hasErrors())reject(e||Error(s.toString({all:false,errors:true})));else resolve();});
  });
  const cssRoot=process.env.CONTACT_CONVERSION_CSS_DIR || path.join(root,'.next/static/css');
  const css=fs.readdirSync(cssRoot).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(cssRoot,f),'utf8')).join('\n');
  const server=http.createServer((req,res)=>{
    if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(output,'fixture.js')));}
    else if(req.url==='/fixture.css'){res.setHeader('content-type','text/css');res.end(css);}
    else{res.setHeader('content-type','text/html; charset=utf-8');res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});
    const context=await browser.newContext({viewport:{width:390,height:844}});
    let claim=null,reads=0,writes=0,fail=false,installed=true,active=true,policyReads=0,noticeStarted=Date.now();
    const errors=[];
    await context.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
      assert.ok(['/api/admin/contact-care','/api/dating/1on1/contact-care','/api/dating/1on1/contact-care/evidence','/api/dating/1on1/contact-care/policy'].includes(url.pathname),'never call payment APIs');
      if(url.pathname.endsWith('/policy')){
        policyReads++;await route.fulfill({json:{active:installed&&active,startsAt:new Date(noticeStarted).toISOString(),endsAt:new Date(noticeStarted+48*3600000).toISOString()}});return;
      }
      if(url.pathname.endsWith('/evidence')){await route.fulfill({contentType:'image/webp',body:await require('sharp')({create:{width:120,height:240,channels:3,background:'#e5e5e5'}}).webp().toBuffer()});return;}
      if(req.method()==='POST'){
        writes++;let body;
        if(req.headers()['content-type'].startsWith('multipart/form-data')){
          const form=await new Response(req.postDataBuffer(),{headers:{'content-type':req.headers()['content-type']}}).formData();body=JSON.parse(form.get('payload'));assert.equal(form.getAll('evidence').length,1);
        }else body=req.postDataJSON();
        await new Promise(r=>setTimeout(r,120));
        if(fail){await route.fulfill({status:409,json:{error:'이 매칭에 진행 중인 결제가 있어요. 교환권은 유지돼요.'}});return;}
        if(url.pathname.startsWith('/api/admin')){
          if(body.decision==='approved')assert.equal(body.evidenceChecked,true);claim={...claim,status:body.decision,review_note:body.note,supplement_due_at:body.decision==='needs_info'?new Date(Date.now()+72*3600000).toISOString():null};
        }else if(body.action==='apply'){
          assert.equal(body.confirmed,true);assert.equal(body.matchId,id(10));assert.equal(body.orderId,id(100));
          claim={id:id(500),user_id:id(1),match_id:id(10),order_id:id(100),first_contact_at:body.firstContactAt,explanation:body.explanation,reason:body.reason,evidence_count:1,supplement_due_at:null,status:'pending',created_at:new Date().toISOString(),review_note:null,used_at:null,used_match_id:null};
        }else{assert.equal(body.action,'redeem');assert.equal(body.matchId,id(20));claim={...claim,used_at:new Date().toISOString(),used_match_id:id(20)};}
        await route.fulfill({json:{ok:true}});return;
      }
      reads++;
      if(!installed){await route.fulfill({status:503,json:{error:'교환권 기능을 준비 중이에요.'}});return;}
      await route.fulfill({json:url.pathname.startsWith('/api/admin')?{items:['pending','needs_info'].includes(claim?.status)?[{...claim,nickname:'검증회원'}]:[],next:null}:
        {active,starts_at:'2026-10-01T00:00:00Z',claim,payments:active&&(!claim||['rejected','needs_info'].includes(claim.status))?[{id:id(10),name:'이전상대',order_id:id(100),exchanged_at:new Date(Date.now()-48*3600000).toISOString()}]:[],matches:claim?.status==='approved'?[{id:id(20),name:'새상대'}]:[]}});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);assert.equal(reads,0,'collapsed panels do not fetch');assert.equal(writes,0);
    const member=page.getByRole('region',{name:'회원 화면'}),admin=page.getByRole('region',{name:'관리자 화면'});
    await member.locator('summary').click();await member.getByLabel('내가 결제한 상대').waitFor();
    const contactTime=new Date(Date.now()-36*3600000);const localTime=new Date(contactTime.getTime()-contactTime.getTimezoneOffset()*60000).toISOString().slice(0,16);
    await member.getByLabel('내가 결제한 상대').selectOption(id(100));await member.getByLabel('첫 연락을 보낸 시각').fill(localTime);
    await member.getByLabel('연락 방법과 상황').fill('카카오톡으로 처음 연락한 뒤 24시간이 지났지만 답장이 오지 않았어요.');
    assert.equal(await member.getByRole('button',{name:'교환권 신청',exact:true}).isEnabled(),false);
    await member.getByRole('checkbox').check();
    assert.equal(await member.getByRole('button',{name:'교환권 신청',exact:true}).isEnabled(),false,'evidence is required');
    const capture={name:'대화캡처.png',mimeType:'image/png',buffer:await require('sharp')({create:{width:100,height:200,channels:3,background:'white'}}).png().toBuffer()};
    await member.getByLabel(/대화 캡처/).setInputFiles(capture);
    await member.getByRole('button',{name:'교환권 신청',exact:true}).evaluate(b=>{b.click();b.click();});
    await member.getByText('신청 검토 중',{exact:true}).waitFor();assert.equal(writes,1);
    await admin.getByText('연락처 교환 지원 · 신청 검토',{exact:true}).click();await admin.getByText('검증회원 · 검토 대기').waitFor();
    assert.equal(await admin.getByRole('button',{name:'승인 · 교환권 1장'}).isEnabled(),false);
    await admin.getByRole('link',{name:/캡처 1 크게 보기/}).waitFor();
    await admin.getByRole('img',{name:'대화 캡처 1'}).waitFor();
    await page.waitForFunction(()=>document.querySelector('img[alt="대화 캡처 1"]')?.naturalWidth>0);
    await admin.getByRole('checkbox').check();await admin.getByLabel('회원에게 표시할 검토 사유').fill('첫 연락 후 무응답 증빙 확인으로 교환권을 지급합니다.');
    for(const width of [320,390,768]){
      await page.setViewportSize({width,height:1100});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(output,`review-${width}.png`),fullPage:true});
    }
    page.once('dialog',d=>d.accept());await admin.getByRole('button',{name:'승인 · 교환권 1장'}).click();
    await admin.getByText('교환권 1장을 지급했습니다.',{exact:true}).waitFor();assert.equal(writes,2);
    await member.getByRole('button',{name:'내역 다시 확인'}).click();await member.getByText('교환권 1장 · 사용 전까지 유지').waitFor();
    await member.getByLabel('교환할 상대').selectOption(id(20));
    page.once('dialog',d=>d.dismiss());await member.getByRole('button',{name:'이 매칭에 교환권 사용'}).click();assert.equal(writes,2);
    fail=true;page.once('dialog',d=>d.accept());await member.getByRole('button',{name:'이 매칭에 교환권 사용'}).click();
    await member.getByRole('alert').waitFor();assert.equal(claim.used_at,null);assert.equal(await member.getByRole('button',{name:'이 매칭에 교환권 사용'}).isEnabled(),false);
    fail=false;await member.getByRole('button',{name:'내역 다시 확인'}).click();await member.getByLabel('교환할 상대').selectOption(id(20));
    page.once('dialog',d=>d.accept());await member.getByRole('button',{name:'이 매칭에 교환권 사용'}).click();
    await member.getByText('교환권 사용 완료',{exact:true}).waitFor();assert.equal(writes,4);
    assert.equal(await member.getByRole('link',{name:'연락처 확인'}).getAttribute('href'),`/community/dating/cards?tab=one_on_one&matchId=${id(20)}#selected-one-on-one-match`);
    claim={...claim,status:'rejected',used_at:null,used_match_id:null,review_note:'증빙의 첫 연락 시각이 필요합니다.'};
    await page.reload();await member.locator('summary').click();await member.getByLabel('내가 결제한 상대').waitFor();
    assert.equal(await member.getByText(/부족한 내용을 보완해 다시 신청/).count(),1);
    assert.equal(await member.getByRole('button',{name:'교환권 신청',exact:true}).count(),1);
    claim={...claim,status:'needs_info',supplement_due_at:new Date(Date.now()+72*3600000).toISOString()};
    await page.reload();await member.locator('summary').click();await member.getByText('추가 자료가 필요해요',{exact:true}).waitFor();
    assert.equal(await member.getByRole('button',{name:'추가 자료 제출',exact:true}).count(),1);
    await member.getByLabel(/대화 캡처/).setInputFiles({name:'too-large.png',mimeType:'image/png',buffer:Buffer.alloc(3_000_001)});
    await member.getByRole('alert').waitFor();assert.equal(await member.getByRole('button',{name:'추가 자료 제출',exact:true}).isEnabled(),false);
    await admin.getByText('연락처 교환 지원 · 신청 검토',{exact:true}).click();await admin.getByText('검증회원 · 추가 자료 대기').waitFor();
    assert.equal(await admin.getByRole('button',{name:'추가 자료 요청',exact:true}).isEnabled(),false,'repeat requests do not extend deadline');
    await admin.getByLabel('회원에게 표시할 검토 사유').fill('추가 자료가 제출되지 않아 반려합니다.');
    page.once('dialog',d=>d.accept());await admin.getByRole('button',{name:'반려',exact:true}).click();await admin.getByText('반려했습니다.',{exact:true}).waitFor();
    assert.equal(claim.status,'rejected');
    active=false;claim=null;await page.reload();await member.locator('summary').click();await member.getByText(/현재 신규 신청을 받지/).waitFor();
    assert.equal(await member.getByRole('button',{name:'교환권 신청',exact:true}).count(),0);
    installed=false;await page.reload();await member.locator('summary').click();await member.getByRole('alert').waitFor();
    assert.equal(await member.getByRole('button',{name:'교환권 신청',exact:true}).count(),0);
    // The current site-wide notice takes precedence; never stack two modal notices.
    const releaseNow=Date.parse('2026-10-23T00:01:00+09:00');
    await page.clock.setFixedTime(new Date(releaseNow));noticeStarted=releaseNow;installed=true;active=true;
    const beforeGlobalNotice=policyReads;
    await page.goto(origin+'/?notice');await page.waitForTimeout(700);
    assert.equal(await page.getByRole('dialog').count(),0,'site-wide notice suppresses the older launch popup');
    assert.equal(policyReads,beforeGlobalNotice,'suppressed popup skips policy fetch');
    const noticeNow=Date.parse('2026-10-26T00:00:00+09:00');
    await page.clock.setFixedTime(new Date(noticeNow));noticeStarted=noticeNow;installed=false;
    await page.reload();await page.waitForTimeout(700);assert.equal(await page.getByRole('dialog').count(),0,'disabled policy never announces availability');
    installed=true;active=true;await page.reload();await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('link',{name:'자세히 보기'}).getAttribute('href'),'/mypage?section=matching&match=one_on_one&care=1#contact-care');
    for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,`notice-${width}.png`)});}
    await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
    const beforePolicyReads=policyReads;await page.reload();await page.waitForTimeout(700);assert.equal(policyReads,beforePolicyReads,'acknowledged visitors skip public-policy fetch');
    await page.evaluate(()=>localStorage.clear());noticeStarted=noticeNow-49*3600000;await page.reload();await page.waitForTimeout(700);assert.equal(await page.getByRole('dialog').count(),0);
    noticeStarted=noticeNow;const beforeExcluded=policyReads;await page.goto(origin+'/payments/success?notice');await page.waitForTimeout(600);assert.equal(policyReads,beforeExcluded,'notice never fetches or interrupts checkout');
    noticeStarted=noticeNow-48*3600000+2500;await page.goto(origin+'/?notice');await page.getByRole('dialog').waitFor();await page.getByRole('dialog').waitFor({state:'hidden',timeout:5000});
    await page.goto(origin+'/#contact-care');await member.getByLabel('내가 결제한 상대').waitFor();
    assert.equal(await member.locator('details').getAttribute('open'),'','support deep link opens the form without a second click');
    await page.goto(origin+'/mypage?section=matching&match=one_on_one&care=1');await member.getByLabel('내가 결제한 상대').waitFor();
    assert.equal(await member.locator('details').getAttribute('open'),'','login return query opens support even without the URL fragment');
    assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,widths:[320,390,768],writes,reads,policyReads,paymentRequests:0,pageErrors:errors,screenshots:output}));
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
