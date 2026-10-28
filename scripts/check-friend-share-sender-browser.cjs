/* eslint-disable @typescript-eslint/no-require-imports */
// Actual sender component + isolated API/store. Native shares and clipboard are
// local stubs; no message is sent to another app or real member.
const assert=require('node:assert/strict'),path=require('node:path');
async function runSenderChecks(server,browser){
  const contexts=[],errors=[];let cases=0;
  async function sender(mode='normal'){
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
          const body=await response.json();body.expiresAt=new Date(Date.now()+2000).toISOString();
          window.senderExpiresAt=body.expiresAt;return Response.json(body,{status:response.status});
        }
        return response;
      };
    },{mode});
    const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto(server.origin);await page.getByRole('button',{name:'친구에게 추천',exact:true}).click();
    return {context,page,create:()=>page.getByRole('button',{name:'추천 링크 만들기'}).click(),send:()=>page.getByRole('button',{name:'친구에게 보내기'}).click(),link:()=>page.getByRole('textbox',{name:'친구 추천 링크'}).inputValue()};
  }
  try{
    for(const mode of ['stall','body']){
      const s=await sender(mode);await s.page.clock.install();await s.create();await s.page.getByRole('button',{name:'잠시만요…'}).waitFor();
      assert.equal(await s.page.getByRole('button',{name:'친구 추천 닫기'}).isEnabled(),true);
      await s.page.clock.fastForward(15001);await s.page.getByText('응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.').waitFor();
      assert.equal(await s.page.getByRole('button',{name:'추천 링크 만들기'}).isEnabled(),true);
      await s.page.screenshot({path:path.join(server.output,`sender-timeout-${mode}.png`),fullPage:true});
      await s.page.evaluate(()=>window.senderMode='normal');await s.create();await s.page.getByRole('button',{name:'친구에게 보내기'}).waitFor();
      const requests=await s.page.evaluate(()=>window.senderRequests);assert.equal(requests.length,2);assert.equal(requests[0].aborted,true);assert.equal(requests[0].body.requestKey,requests[1].body.requestKey);
      cases++;
    }
    // Response lost AFTER server commit: same key recovers the same link once.
    const lost=await sender('late');await lost.page.clock.install();const before=server.fixture.tables.dating_friend_shares.length;
    await lost.create();await lost.page.waitForFunction(()=>window.lateResolvers.length===1);await lost.page.clock.fastForward(15001);
    await lost.page.getByText('응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.').waitFor();await lost.page.evaluate(()=>window.senderMode='normal');await lost.create();
    await lost.page.getByRole('button',{name:'친구에게 보내기'}).waitFor();const recovered=await lost.link();
    assert.equal(server.fixture.tables.dating_friend_shares.length,before+1);
    await lost.page.evaluate(()=>window.lateResolvers.shift()());await lost.page.waitForTimeout(30);assert.equal(await lost.link(),recovered);cases++;

    for(const method of ['close','escape']){
      const s=await sender('late');await s.create();await s.page.waitForFunction(()=>window.lateResolvers.length===1);
      if(method==='close')await s.page.getByRole('button',{name:'친구 추천 닫기'}).click();else await s.page.keyboard.press('Escape');
      assert.equal(await s.page.locator('dialog[open]').count(),0);
      await s.page.getByRole('button',{name:'친구에게 추천',exact:true}).click();await s.page.getByLabel('친구에게 한마디').selectOption('hello');
      await s.page.evaluate(()=>window.senderMode='normal');await s.create();await s.page.getByRole('button',{name:'친구에게 보내기'}).waitFor();const fresh=await s.link();
      await s.page.evaluate(()=>window.lateResolvers.shift()());await s.page.waitForTimeout(30);assert.equal(await s.link(),fresh);
      const requests=await s.page.evaluate(()=>window.senderRequests);assert.equal(requests[0].aborted,true);assert.notEqual(requests[0].body.requestKey,requests[1].body.requestKey);cases++;
    }
    for(const mode of ['timer','send','reopen','focus']){
      const s=await sender('short');await s.page.clock.install();await s.create();await s.page.getByRole('button',{name:'친구에게 보내기'}).waitFor();const old=await s.link();
      const expires=await s.page.evaluate(()=>window.senderExpiresAt);
      const row=server.fixture.tables.dating_friend_shares.find(r=>old.endsWith(r.token));row.expires_at=new Date(Date.now()-1000).toISOString();
      await s.page.evaluate(()=>window.senderMode='normal');
      if(mode==='timer')await s.page.clock.fastForward(2001);
      else{
        if(mode==='reopen')await s.page.getByRole('button',{name:'친구 추천 닫기'}).click();
        await s.page.clock.setFixedTime(new Date(Date.parse(expires)+1));
        if(mode==='reopen')await s.page.getByRole('button',{name:'친구에게 추천',exact:true}).click();
        if(mode==='focus')await s.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      }
      if(mode==='send')await s.send();
      else{await s.page.getByText('링크가 만료됐어요. 새 링크를 만들어 주세요.').waitFor();assert.equal(await s.page.getByRole('textbox',{name:'친구 추천 링크'}).count(),0);await s.create();}
      await s.page.getByRole('button',{name:'친구에게 보내기'}).waitFor();const fresh=await s.link();assert.notEqual(fresh,old);
      assert.equal(await s.page.evaluate(()=>window.senderShares.length+window.senderCopies.length),0,'renewal never sends without a fresh user action');
      const requests=await s.page.evaluate(()=>window.senderRequests);assert.equal(requests.length,2);assert.notEqual(requests[0].body.requestKey,requests[1].body.requestKey);
      await s.send();assert.equal(await s.page.evaluate(()=>window.senderShares[0].url),fresh);
      await s.page.screenshot({path:path.join(server.output,`sender-renewed-${mode}.png`),fullPage:true});
      await s.context.addCookies([{name:'fixture_role',value:'guest',url:server.origin}]);await s.page.goto(old);await s.page.getByText('만료되었거나 종료된 추천이에요.').waitFor();cases++;
    }
    const normal=await sender();await normal.create();await normal.page.getByRole('button',{name:'친구에게 보내기'}).waitFor();const url=await normal.link();await normal.send();
    assert.equal(await normal.page.evaluate(()=>window.senderShares[0].url),url);
    await normal.page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('Canceled','AbortError');}}));
    await normal.send();await normal.page.getByText('공유를 취소했어요. 링크는 아래에서 다시 보낼 수 있어요.').waitFor();
    await normal.page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));await normal.send();
    assert.equal(await normal.page.evaluate(()=>window.senderCopies[0]),url);cases++;
    const invalid=await sender('invalid');await invalid.create();await invalid.page.getByText('추천 링크를 확인하지 못했어요. 다시 시도해 주세요.').waitFor();assert.equal(await invalid.page.getByRole('textbox',{name:'친구 추천 링크'}).count(),0);cases++;
    assert.deepEqual(errors,[]);console.log(JSON.stringify({senderCases:cases,externalSends:0,productionWrites:0}));
  }finally{for(const c of contexts)await c.close();}
}
module.exports={runSenderChecks};
