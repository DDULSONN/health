/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),path=require('node:path');
const {id}=require('./fixtures/friend-recommendation-store.cjs');
async function runSettingsChecks(server,browser){
  const f=server.fixture,errors=[];let cases=0;
  function seed(){
    const row={id:id(88),user_id:id(1),token:'s'.repeat(43),prompt:'fit',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),revoked_at:null,
      items:[{id:id(70),kind:'open_card',card_id:id(12),user_id:id(2),revision:0,label:'추천회원'},{id:id(71),kind:'one_on_one',card_id:id(24),user_id:id(6),revision:0,label:'러닝친구'}]};
    f.tables.dating_friend_shares=[row];f.tables.dating_friend_share_preferences=[];return row;
  }
  async function setup(mode='normal',width=390){
    const context=await browser.newContext({viewport:{width,height:844}});
    await context.route('**/*',r=>new URL(r.request().url()).origin===server.origin?r.continue():r.abort());
    await context.addCookies([{name:'fixture_role',value:'sender',url:server.origin}]);
    await context.addInitScript(({mode})=>{
      window.settingsMode=mode;window.settingsCalls=[];window.settingsCopies=[];window.settingsLate=[];
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{if(window.settingsMode==='copy-denied')throw Error('denied');window.settingsCopies.push(value);}}});
      const original=window.fetch;window.fetch=async(input,init)=>{
        if(String(input)!=='/api/dating/friend-shares')return original(input,init);
        const call={body:init?.body?JSON.parse(init.body):null,aborted:false};window.settingsCalls.push(call);init?.signal?.addEventListener('abort',()=>call.aborted=true);
        const mode=window.settingsMode;
        if(mode==='stall')return new Promise(()=>{});
        if(mode==='body')return {ok:true,json:()=>new Promise(()=>{})};
        if(mode==='unauth')return Response.json({error:'로그인이 필요해요.'},{status:401});
        const response=await original(input,init);
        if(mode==='lost'&&call.body){window.settingsCommitted=true;throw TypeError('Failed to fetch');}
        if(mode==='late'&&!call.body){const data=await response.json();return new Promise(resolve=>window.settingsLate.push(()=>resolve(Response.json(data))));}
        return response;
      };
    },{mode});
    const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install();await page.goto(server.origin+'/settings');
    return {context,page,open:()=>page.locator('summary').click(),ready:()=>page.waitForFunction(()=>{const control=document.querySelector('[role=switch]');return control&&!control.disabled;})};
  }
  for(const width of [320,390,1280]){
    const row=seed(),s=await setup('normal',width),p=s.page;
    try{
      await s.ready();assert.equal(await p.locator('details').getAttribute('open'),null);await s.open();
      await p.getByText('추천회원 · 러닝친구',{exact:true}).waitFor();assert.match(await p.locator('article time').innerText(),/종료/);
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:path.join(server.output,`settings-${width}.png`),fullPage:true});cases++;
      await p.getByRole('button',{name:'링크 복사',exact:true}).click();assert.deepEqual(await p.evaluate(()=>window.settingsCopies),[server.origin+'/s/'+row.token]);
      await p.evaluate(()=>window.settingsMode='copy-denied');await p.getByRole('button',{name:'링크 복사',exact:true}).click();await p.getByRole('textbox',{name:'복사할 추천 링크'}).waitFor();
      assert.equal(await p.getByRole('textbox',{name:'복사할 추천 링크'}).inputValue(),server.origin+'/s/'+row.token);cases++;
      p.once('dialog',d=>d.dismiss());await p.getByRole('button',{name:'링크 종료'}).click();assert.equal(f.tables.dating_friend_shares[0].revoked_at,null);
      p.once('dialog',d=>d.accept());await p.getByRole('button',{name:'링크 종료'}).click();await p.getByText('링크를 종료했어요.').waitFor();assert.ok(f.tables.dating_friend_shares[0].revoked_at);
      assert.equal(await p.locator('article').count(),0);assert.equal(await p.getByRole('textbox',{name:'복사할 추천 링크'}).count(),0);
      assert.equal(await p.evaluate(()=>window.settingsCalls.filter(c=>c.body?.action==='revoke').length),1);
      const response=await p.request.get(server.origin+'/api/dating/friend-shares/'+row.token);assert.equal(response.status(),410);cases++;
    }finally{await s.context.close();}
  }
  for(const mode of ['stall','body']){
    seed();const s=await setup(mode);try{
      await s.page.waitForFunction(()=>window.settingsCalls.length===1);await s.page.clock.fastForward(15001);
      await s.page.getByText('응답이 늦어지고 있어요. 다시 확인해 주세요.').waitFor();assert.equal(await s.page.getByRole('switch').isDisabled(),true);
      await s.page.evaluate(()=>window.settingsMode='normal');await s.page.getByRole('button',{name:'내역 다시 확인'}).click();await s.ready();await s.open();await s.page.getByText('추천회원 · 러닝친구',{exact:true}).waitFor();
      assert.equal(await s.page.evaluate(()=>window.settingsCalls.length),2);assert.equal(await s.page.evaluate(()=>window.settingsCalls[0].aborted),true);cases++;
    }finally{await s.context.close();}
  }
  for(const action of ['preference','revoke']){
    seed();const s=await setup();try{
      await s.ready();await s.page.evaluate(()=>window.settingsMode='lost');
      if(action==='preference')await s.page.getByRole('switch').click();else{await s.open();s.page.once('dialog',d=>d.accept());await s.page.getByRole('button',{name:'링크 종료'}).click();}
      await s.page.getByText('처리 결과를 확인하지 못했어요. 내역 다시 확인을 눌러 주세요.').waitFor();assert.equal(await s.page.getByRole('switch').isDisabled(),true);assert.equal(await s.page.locator('article').count(),0);
      await s.page.evaluate(()=>window.settingsMode='normal');await s.page.getByRole('button',{name:'내역 다시 확인'}).click();await s.ready();
      if(action==='preference')assert.equal(await s.page.getByRole('switch').getAttribute('aria-checked'),'false');else assert.equal(await s.page.locator('article').count(),0);
      assert.equal(await s.page.evaluate(()=>window.settingsCalls.filter(c=>c.body).length),1,'lost response must not replay settings mutation');cases++;
    }finally{await s.context.close();}
  }
  {const row=seed(),s=await setup();try{
    await s.ready();await s.open();await s.page.clock.setFixedTime(new Date(Date.parse(row.expires_at)+1));
    await s.page.getByRole('button',{name:'링크 복사',exact:true}).click();await s.page.getByText('만료된 링크예요. 후보에서 새로 추천해 주세요.').waitFor();assert.equal(await s.page.locator('article').count(),0);assert.equal(await s.page.evaluate(()=>window.settingsCopies.length),0);cases++;
  }finally{await s.context.close();}}
  {seed();const s=await setup();try{
    await s.ready();await s.open();await s.page.evaluate(()=>window.settingsMode='unauth');await s.page.getByRole('button',{name:'내역 다시 확인'}).click();await s.page.getByText('로그인이 필요해요.').waitFor();assert.equal(await s.page.locator('article').count(),0);assert.equal(await s.page.getByRole('switch').isDisabled(),true);cases++;
  }finally{await s.context.close();}}
  {seed();const s=await setup('late');try{
    await s.page.waitForFunction(()=>window.settingsLate.length===1);await s.page.clock.fastForward(15001);await s.page.getByRole('button',{name:'내역 다시 확인'}).waitFor();
    f.tables.dating_friend_shares[0].revoked_at=new Date().toISOString();await s.page.evaluate(()=>window.settingsMode='normal');await s.page.getByRole('button',{name:'내역 다시 확인'}).click();await s.ready();await s.open();
    await s.page.evaluate(()=>window.settingsLate.shift()());await s.page.waitForTimeout(30);assert.equal(await s.page.locator('article').count(),0);cases++;
  }finally{await s.context.close();}}
  assert.deepEqual(errors,[]);console.log(JSON.stringify({settingsCases:cases,externalSends:0,productionWrites:0}));
}
module.exports={runSettingsChecks};
