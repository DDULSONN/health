/* eslint-disable @typescript-eslint/no-require-imports */
// Real component + isolated API/store. Native shares/clipboard are local stubs.
const assert=require('node:assert/strict'),path=require('node:path');
async function runSenderChecks(server,browser){
  const contexts=[],errors=[];let cases=0;
  async function sender(mode='normal',open=true){
    const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);
    await context.route('**/*',route=>new URL(route.request().url()).origin===server.origin?route.continue():route.abort());
    await context.addCookies([{name:'fixture_role',value:'sender',url:server.origin}]);
    await context.addInitScript(({mode})=>{
      window.senderMode=mode;window.senderRequests=[];window.senderShares=[];window.senderCopies=[];window.lateResolvers=[];
      Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>window.senderShares.push(payload)});
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.senderCopies.push(text)}});
      const original=window.fetch;
      window.fetch=async(input,init)=>{
        if(init?.method!=='POST'||String(input)!=='/api/dating/friend-shares')return original(input,init);
        const record={body:JSON.parse(init.body),aborted:false};window.senderRequests.push(record);
        init.signal?.addEventListener('abort',()=>record.aborted=true,{once:true});
        const mode=window.senderMode;
        if(mode==='stall')return new Promise(()=>{});
        if(mode==='body')return {ok:true,json:()=>new Promise(()=>{})};
        if(mode==='invalid')return Response.json({path:'https://evil.invalid',expiresAt:new Date(Date.now()+3600000).toISOString()});
        const response=await original(input,init);
        if(mode==='late'){
          const body=await response.json();window.senderCommitted=body;
          return new Promise(resolve=>window.lateResolvers.push(()=>resolve(Response.json(body))));
        }
        if(mode==='short'){
          const body=await response.json();body.expiresAt=new Date(Date.now()+30000).toISOString();
          window.senderExpiresAt=body.expiresAt;return Response.json(body,{status:response.status});
        }
        return response;
      };
    },{mode});
    const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto(server.origin);
    if(open)await page.getByRole('button',{name:'친구에게 추천',exact:true}).click();
    return {context,page,create:()=>page.getByRole('button',{name:'다시 준비하기'}).click(),
      ready:()=>page.getByRole('button',{name:'친구에게 보내기'}).waitFor(),
      send:()=>page.getByRole('button',{name:'친구에게 보내기'}).click(),
      link:async()=>{await page.getByRole('button',{name:'링크 복사',exact:true}).click();return page.evaluate(()=>{const url=window.senderCopies.at(-1);window.senderCopies=[];return url;});}};
  }
  try{
    const quiet=await sender('normal',false);await quiet.page.waitForTimeout(400);
    assert.equal(await quiet.page.evaluate(()=>window.senderRequests.length),0,'rendering candidates must not create links');
    await quiet.page.getByRole('button',{name:'친구에게 추천',exact:true}).click();await quiet.ready();
    assert.equal(await quiet.page.getByRole('textbox',{name:'친구 추천 링크'}).count(),0);
    assert.equal(await quiet.page.locator('dialog[open] details').getAttribute('open'),null);
    const bounds=await quiet.page.locator('dialog[open]').boundingBox();assert.ok(bounds.height<400);assert.ok(bounds.y+bounds.height<=844);assert.ok(bounds.y>400);
    assert.equal(await quiet.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await quiet.page.screenshot({path:path.join(server.output,'sender-compact-390.png'),fullPage:true});
    assert.equal(await quiet.page.evaluate(()=>window.senderShares.length+window.senderCopies.length),0);
    await quiet.send();assert.equal(await quiet.page.evaluate(()=>window.senderShares.length),1);cases++;

    for(const mode of ['stall','body']){
      const s=await sender(mode,false);await s.page.clock.install();await s.page.getByRole('button',{name:'친구에게 추천',exact:true}).click();
      await s.page.waitForFunction(()=>window.senderRequests.length===1);
      assert.equal(await s.page.getByRole('button',{name:'친구 추천 닫기'}).isEnabled(),true);
      await s.page.clock.fastForward(15001);await s.page.getByText('응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.').waitFor();
      assert.equal(await s.page.getByRole('button',{name:'다시 준비하기'}).isEnabled(),true);
      await s.page.screenshot({path:path.join(server.output,`sender-timeout-${mode}.png`),fullPage:true});
      await s.page.evaluate(()=>window.senderMode='normal');await s.create();await s.ready();
      const requests=await s.page.evaluate(()=>window.senderRequests);assert.equal(requests.length,2);assert.equal(requests[0].aborted,true);assert.equal(requests[0].body.requestKey,requests[1].body.requestKey);cases++;
    }
    const lost=await sender('late',false);await lost.page.clock.install();const before=server.fixture.tables.dating_friend_shares.length;
    await lost.page.getByRole('button',{name:'친구에게 추천',exact:true}).click();await lost.page.waitForFunction(()=>window.lateResolvers.length===1);await lost.page.clock.fastForward(15001);
    await lost.page.getByText('응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.').waitFor();await lost.page.evaluate(()=>window.senderMode='normal');await lost.create();
    await lost.ready();const recovered=await lost.link();assert.equal(server.fixture.tables.dating_friend_shares.length,before+1);
    await lost.page.evaluate(()=>window.lateResolvers.shift()());await lost.page.waitForTimeout(30);assert.equal(await lost.link(),recovered);cases++;

    for(const method of ['close','escape']){
      const s=await sender('late');await s.page.waitForFunction(()=>window.lateResolvers.length===1);
      if(method==='close')await s.page.getByRole('button',{name:'친구 추천 닫기'}).click();else await s.page.keyboard.press('Escape');
      assert.equal(await s.page.locator('dialog[open]').count(),0);
      await s.page.evaluate(()=>window.senderMode='normal');await s.page.getByRole('button',{name:'친구에게 추천',exact:true}).click();await s.page.locator('dialog[open]').getByLabel('친구에게 한마디').selectOption('hello');
      await s.ready();const fresh=await s.link();await s.page.evaluate(()=>window.lateResolvers.shift()());await s.page.waitForTimeout(30);assert.equal(await s.link(),fresh);
      const requests=await s.page.evaluate(()=>window.senderRequests);assert.equal(requests[0].aborted,true);assert.notEqual(requests[0].body.requestKey,requests.at(-1).body.requestKey);cases++;
    }
    for(const mode of ['timer','send','reopen','focus']){
      const s=await sender('short',false);await s.page.clock.install();await s.page.getByRole('button',{name:'친구에게 추천',exact:true}).click();await s.ready();const old=await s.link();
      const expires=await s.page.evaluate(()=>window.senderExpiresAt);
      const row=server.fixture.tables.dating_friend_shares.find(r=>old.endsWith(r.token));row.expires_at=new Date(Date.now()-1000).toISOString();
      await s.page.evaluate(()=>window.senderMode='normal');
      if(mode==='timer')await s.page.clock.fastForward(30001);
      else{
        if(mode==='reopen')await s.page.getByRole('button',{name:'친구 추천 닫기'}).click();
        await s.page.clock.setFixedTime(new Date(Date.parse(expires)+1));
        if(mode==='reopen')await s.page.getByRole('button',{name:'친구에게 추천',exact:true}).click();
        if(mode==='focus')await s.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        if(mode==='send')await s.send();
      }
      await s.page.waitForFunction(()=>window.senderRequests.length===2);await s.ready();const fresh=await s.link();assert.notEqual(fresh,old);
      assert.equal(await s.page.evaluate(()=>window.senderShares.length+window.senderCopies.length),0,'renewal must not send automatically');
      const requests=await s.page.evaluate(()=>window.senderRequests);assert.notEqual(requests[0].body.requestKey,requests[1].body.requestKey);
      await s.send();assert.equal(await s.page.evaluate(()=>window.senderShares[0].url),fresh);
      await s.page.screenshot({path:path.join(server.output,`sender-renewed-${mode}.png`),fullPage:true});
      await s.context.addCookies([{name:'fixture_role',value:'guest',url:server.origin}]);await s.page.goto(old);await s.page.getByText('만료되었거나 종료된 추천이에요.').waitFor();cases++;
    }
    const normal=await sender();await normal.ready();const url=await normal.link();await normal.send();
    assert.equal(await normal.page.evaluate(()=>window.senderShares[0].url),url);
    await normal.page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('Canceled','AbortError');}}));
    await normal.send();await normal.page.getByText('공유를 취소했어요. 다시 보낼 수 있어요.').waitFor();
    await normal.page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));await normal.send();
    assert.equal(await normal.page.evaluate(()=>window.senderCopies[0]),url);cases++;
    await normal.page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}}));
    await normal.page.getByRole('button',{name:'링크 복사',exact:true}).click();await normal.page.getByText('아래 링크를 길게 눌러 복사해 주세요.').waitFor();
    assert.equal(await normal.page.getByRole('textbox',{name:'친구 추천 링크'}).inputValue(),url);cases++;
    const invalid=await sender('invalid');await invalid.page.getByText('추천 링크를 확인하지 못했어요. 다시 시도해 주세요.').waitFor();assert.equal(await invalid.page.getByRole('textbox',{name:'친구 추천 링크'}).count(),0);cases++;

    const reuse=await sender();await reuse.ready();const first=await reuse.link();
    const rowsBefore=server.fixture.tables.dating_friend_shares.length;
    await reuse.page.getByRole('button',{name:'친구 추천 닫기'}).click();await reuse.page.getByRole('button',{name:'친구에게 추천',exact:true}).click();
    await reuse.ready();assert.equal(await reuse.link(),first);assert.equal(server.fixture.tables.dating_friend_shares.length,rowsBefore);
    await reuse.page.locator('dialog[open]').getByLabel('친구에게 한마디').selectOption('hello');await reuse.ready();assert.notEqual(await reuse.link(),first);
    await reuse.page.locator('dialog[open]').getByLabel('친구에게 한마디').selectOption('fit');await reuse.ready();assert.equal(await reuse.link(),first);
    assert.equal(server.fixture.tables.dating_friend_shares.length,rowsBefore+1);cases++;
    await reuse.page.getByRole('button',{name:'추천회원 빼기'}).click();
    assert.equal(await reuse.page.getByRole('button',{name:'다시 준비하기'}).isDisabled(),true);
    assert.equal(await reuse.page.getByRole('button',{name:'링크 복사',exact:true}).isDisabled(),true);cases++;
    const debounce=await sender('normal',false);await debounce.page.clock.install();await debounce.page.clock.pauseAt(new Date());
    await debounce.page.getByRole('button',{name:'친구에게 추천',exact:true}).click();await debounce.page.getByRole('button',{name:'친구 추천 닫기'}).click();await debounce.page.clock.runFor(300);
    assert.equal(await debounce.page.evaluate(()=>window.senderRequests.length),0);cases++;
    const signedOut=await sender();await signedOut.ready();
    await signedOut.page.getByRole('button',{name:'친구 추천 닫기'}).click();
    await signedOut.context.addCookies([{name:'fixture_role',value:'guest',url:server.origin}]);
    await signedOut.page.getByRole('button',{name:'친구에게 추천',exact:true}).click();
    await signedOut.page.waitForFunction(()=>window.senderRequests.length===2);
    await signedOut.page.getByRole('button',{name:'다시 준비하기'}).waitFor();
    assert.equal(await signedOut.page.getByRole('button',{name:'링크 복사',exact:true}).isDisabled(),true);
    assert.equal(await signedOut.page.getByRole('textbox',{name:'친구 추천 링크'}).count(),0);
    assert.equal(await signedOut.page.evaluate(()=>window.senderShares.length+window.senderCopies.length),0,'reopening after logout must not reuse a cached link');cases++;
    const double=await sender();await double.ready();
    await double.page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:payload=>{
      window.senderShares.push(payload);return new Promise(resolve=>{window.finishShare=resolve;});
    }}));
    await double.page.getByRole('button',{name:'친구에게 보내기',exact:true}).dblclick();
    assert.equal(await double.page.evaluate(()=>window.senderShares.length),1,'double click opens only one native share');
    await double.page.evaluate(()=>window.finishShare());await double.ready();cases++;
    assert.deepEqual(errors,[]);console.log(JSON.stringify({senderCases:cases,externalSends:0,productionWrites:0}));
  }finally{for(const c of contexts)await c.close();}
}
module.exports={runSenderChecks};
