/* eslint-disable @typescript-eslint/no-require-imports */
// Real shared basket/components -> real API/service -> isolated in-memory store.
const assert=require('node:assert/strict'),path=require('node:path');
async function runBasketChecks(server,browser){
  let cases=0;
  for(const width of [320,390,1280]){
    const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();
    const requests=[],errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.method()==='POST')requests.push({path:new URL(r.url()).pathname,body:r.postDataJSON()});});
    await context.route('**/*',r=>new URL(r.request().url()).origin===server.origin?r.continue():r.abort());
    await context.addInitScript(()=>{
      window.basketShares=[];window.basketCopies=[];
      Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>window.basketShares.push(payload)});
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>window.basketCopies.push(value)}});
    });
    try{
      const sheet=()=>page.locator('dialog[open]');
      const close=()=>page.getByRole('button',{name:'친구 추천 닫기'}).click();
      const ready=()=>page.getByRole('button',{name:'친구에게 보내기',exact:true}).waitFor();
      const basket=n=>page.getByRole('button',{name:`친구에게 추천할 담은 후보 ${n}명 보기`,exact:true});
      async function add(name){await page.getByRole('article',{name,exact:true}).getByRole('button',{name:'친구에게 추천',exact:true}).click();await ready();}
      await page.goto(server.origin+'/basket');await page.getByRole('article',{name:'추천회원',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:/담은 후보/}).count(),0);assert.equal(requests.length,0);cases++;
      await add('추천회원');const firstKey=requests.at(-1).body.requestKey;await close();await basket(1).waitFor();
      const rows=server.fixture.tables.dating_friend_shares.length;
      await basket(1).click();await ready();assert.equal(requests.at(-1).body.requestKey,firstKey);
      assert.equal(server.fixture.tables.dating_friend_shares.length,rows,'basket does not consume another link for the same selection');
      assert.equal(await sheet().getByRole('listitem').count(),1);assert.equal(await page.evaluate(()=>window.basketShares.length),0);
      await page.getByRole('button',{name:'친구에게 보내기',exact:true}).click();assert.equal(await page.evaluate(()=>window.basketShares.length),1);await close();cases++;
      await add('추천회원');assert.equal(await sheet().getByRole('listitem').count(),1,'adding same card is idempotent');await close();
      await add('산책친구');await close();await basket(2).waitFor();
      await page.getByRole('button',{name:'1:1 매칭',exact:true}).click();await basket(2).waitFor();
      await add('러닝친구');assert.equal(await sheet().getByRole('listitem').count(),3);await close();await basket(3).waitFor();
      assert.match(await basket(3).innerText(),/3\/3/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.ok((await basket(3).boundingBox()).height<=40,'small, inline entry point');
      await page.screenshot({path:path.join(server.output,`basket-button-${width}.png`),fullPage:true});cases++;
      await add('주말친구');assert.equal(await sheet().getByRole('listitem').count(),3);
      await sheet().getByText('최대 3명까지 담을 수 있어요. 한 명을 빼고 담아 주세요.').waitFor();
      assert.equal(await sheet().getByText('주말친구',{exact:true}).count(),0);await close();
      await basket(3).click();await ready();await page.screenshot({path:path.join(server.output,`basket-sheet-${width}.png`),fullPage:true});
      assert.equal(requests.at(-1).body.items.length,3);assert.deepEqual(requests.at(-1).body.items.map(x=>x.kind),['open_card','open_card','one_on_one']);cases++;
      await sheet().getByRole('button',{name:'산책친구 빼기',exact:true}).click();await ready();await close();await basket(2).waitFor();
      await basket(2).click();await ready();await sheet().getByRole('button',{name:'추천회원 빼기',exact:true}).click();await ready();
      await sheet().getByRole('button',{name:'러닝친구 빼기',exact:true}).click();await sheet().getByText('담은 후보가 없어요.').waitFor();
      assert.equal(await sheet().getByRole('button',{name:'다시 준비하기'}).isDisabled(),true);
      assert.equal(await sheet().getByRole('button',{name:'링크 복사'}).isDisabled(),true);
      await close();assert.equal(await page.getByRole('button',{name:/담은 후보/}).count(),0);cases++;
      await add('러닝친구');await close();await basket(1).waitFor();await page.reload();
      await page.getByRole('article',{name:'추천회원',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/담은 후보/}).count(),0,'temporary basket is not persisted');
      assert.ok(requests.every(r=>r.path==='/api/dating/friend-shares'),'never writes matches/payments/contacts');
      assert.deepEqual(errors,[]);cases++;
    }finally{await context.close();}
  }
  console.log(JSON.stringify({basketCases:cases,productionWrites:0,externalSends:0}));
}
module.exports={runBasketChecks};
