/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({browser,origin,output})=>{
  let passed=0;
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  for(const surface of ['home','mypage']) for(const width of [390,1280]) {
    const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(); page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',d=>d.accept());
    const own={id:id(1),user_id:id(101),name:'검증 본인',sex:'female',age:29,status:'approved',region:'서울'};
    const card=(n,name)=>({id:id(n),user_id:id(n+100),name,sex:'male',age:30,region:'서울',height_cm:180,job:'회사원',intro_text:'로컬 가상 프로필입니다.',photo_signed_urls:[]});
    const main=card(2,'기본 숨김 후보'),extra=card(3,'추가 숨김 후보'),expanded=card(4,'넓혀보기 숨김 후보'),proposed=card(5,'관리자 제안 후보');
    const originalMain=[main,...Array.from({length:9},(_,i)=>card(i+6,`기본 숨김 후보 ${i+2}`))];
    const originalExtra=[extra,card(15,'추가 숨김 후보 2'),card(16,'추가 숨김 후보 3')];
    const refreshedMain=Array.from({length:10},(_,i)=>card(i+20,`새 명단 후보 ${i+1}`));
    const refreshedExtra=Array.from({length:3},(_,i)=>card(i+30,`새 추가 후보 ${i+1}`));
    const everyCard=[...originalMain,...originalExtra,...refreshedMain,...refreshedExtra,expanded,proposed];
    const hidden=new Set();let fail=true,writes=0,external=0,refreshes=0;const mutations=[];
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin){external++;await route.abort();return;}
      if(!url.pathname.startsWith('/api/')){await route.continue();return;}
      let body={ok:true,items:[],cards:[],applications:[],loggedIn:true};
      if(req.method()!=='GET'){
        mutations.push(url.pathname);
        if(url.pathname==='/api/dating/1on1/recommendations/impressions'){await route.fulfill({json:{ok:true}});return;}
        const data=req.postDataJSON();
        if(url.pathname==='/api/dating/1on1/candidate-hides'){
          writes++;
          if(fail){await route.fulfill({status:503,json:{error:'숨김 저장을 확인하지 못했어요.'}});return;}
          if(data.action==='hide'){assert.equal(data.sourceCardId,own.id);hidden.add(data.candidateId);}
          else {assert.equal(data.action,'restore');hidden.delete(data.id);}
        }else if(url.pathname==='/api/dating/1on1/recommendations/refresh'){
          assert.equal(data.source_card_id,own.id);refreshes++;
          body={ok:true,source_card_id:own.id,refresh_consumed:true,changed_candidate_count:13,
            refresh_remaining:1,refresh_used_count:1,refresh_limit:2,refresh_used_at:new Date().toISOString()};
        }else if(url.pathname==='/api/dating/1on1/recommendations/expand'){
          body={source_card_id:own.id,day_key:'2026-10-27',expires_at:new Date(Date.now()+86400000).toISOString(),impression_ticket:'local-receipt',candidates:hidden.has(expanded.id)?[]:[expanded]};
        }else throw Error('Unexpected mutation: '+url.pathname);
        await route.fulfill({json:body});return;
      }
      switch(url.pathname){
        case '/api/dating/cards/queue-stats':body={male:{public_count:0,pending_count:0,slot_limit:45},female:{public_count:0,pending_count:0,slot_limit:45}};break;
        case '/api/mypage/summary':body={profile:{email:'fixture@example.invalid',nickname:'검증회원',phone_verified:true,nickname_changed_count:0,nickname_change_credits:0,swipe_profile_visible:true},account:{is_banned:false},isAdmin:false,weekly_win_count:0,bodycheck_posts:[]};break;
        case '/api/dating/1on1/my':body={items:[own]};break;
        case '/api/dating/1on1/write-status':body={canWrite:false,phoneVerified:true,writeStatus:'approved',activeRequestStatus:'approved'};break;
        case '/api/dating/1on1/matches/my':body={items:[
          {id:id(51),source_card_id:own.id,role:'source',state:'proposed',contact_exchange_status:'none',counterparty_card:proposed},
          {id:id(52),source_card_id:own.id,role:'candidate',state:'source_selected',contact_exchange_status:'none',counterparty_card:{...main,name:'받은 요청 유지'},action_required:true},
          {id:id(53),source_card_id:own.id,role:'source',state:'mutual_accepted',contact_exchange_status:'approved',counterparty_card:{...main,name:'번호교환 유지'},counterparty_phone:'01000000000',contact_exchange_approved_at:new Date().toISOString()},
        ]};break;
        case '/api/dating/1on1/recommendations/my':body={items:[{source_card_id:own.id,source_card_status:'approved',hides_enabled:true,hidden_candidate_ids:[...hidden],impression_ticket:'local-receipt',recommendations:(refreshes?refreshedMain:originalMain).filter(c=>!hidden.has(c.id)),admin_recommendations:(refreshes?refreshedExtra:originalExtra).filter(c=>!hidden.has(c.id)),favorite_candidates:[],refresh_limit:2,refresh_used_count:refreshes,refresh_remaining:2-refreshes,can_refresh:true,expansion_enabled:true}]};break;
        case '/api/dating/1on1/candidate-hides':body={enabled:true,items:[...hidden].map(key=>({id:key,name:everyCard.find(c=>c.id===key).name,created_at:new Date().toISOString()}))};break;
        case '/api/dating/cards/viewer-sex':body={status:'resolved',viewerSex:'female',targetSex:'male',source:'one_on_one',canSwitchSex:false,requiresSexSelection:false};break;
        case '/api/dating/cards/my/swipe-status':body={outgoing_likes:[],incoming_likes:[],summary:{incoming_pending:0,outgoing_pending:0}};break;
        case '/api/dating/cards/write-enabled':body={enabled:true};break;
        case '/api/dating/apply-credits/status':body={creditsRemaining:5};break;
      }
      await route.fulfill({json:body});
    });
    try{
      const href=origin+(surface==='home'?'/community/dating/cards?tab=one_on_one':'/mypage?section=matching&matching=one_on_one');
      await page.goto(href);
      const article=name=>page.locator('article').filter({has:page.getByText(new RegExp(`^${name}(?: / 30세 / 서울)?$`))});
      const title=name=>surface==='home'?article(name).getByText(name,{exact:true}):page.getByText(name+' / 30세 / 서울',{exact:true});
      const mainTitles=prefix=>surface==='home'
        ?page.locator('article').getByText(new RegExp(`^${prefix}(?: \\d+)?$`))
        :page.getByText(new RegExp(`^${prefix}(?: \\d+)? / 30세 / 서울$`));
      // MyPage cards use sections/divs; use the real hide button's nearest profile container.
      const hideNamed=async(name)=>{
        if(surface==='home') await article(name).getByRole('button',{name:'숨기기',exact:true}).click();
        else {
          const title=page.getByText(name+' / 30세 / 서울',{exact:true});
          await title.locator('xpath=ancestor::div[.//button[normalize-space(.)="숨기기"]][1]').getByRole('button',{name:'숨기기',exact:true}).click();
        }
      };
      await page.getByRole('button',{name:'숨기기',exact:true}).first().waitFor();
      assert.equal(await mainTitles('기본 숨김 후보').count(),10);
      await hideNamed(main.name); await page.getByText('숨김 저장을 확인하지 못했어요.',{exact:true}).waitFor();
      assert.equal(hidden.size,0);fail=false;await hideNamed(main.name);
      await page.getByText('후보를 숨겼어요. 빈자리는 바로 채워지지 않아요. 기존 요청·매칭은 그대로 유지돼요.',{exact:true}).waitFor();
      assert.equal(hidden.has(main.id),true);assert.equal(writes,2);
      await title(main.name).waitFor({state:'hidden'});
      assert.equal(await mainTitles('기본 숨김 후보').count(),9);
      await page.reload();await page.getByRole('button',{name:'숨긴 후보 보기'}).waitFor();
      assert.equal(await title(main.name).count(),0);
      assert.equal(await mainTitles('기본 숨김 후보').count(),9);
      assert.equal(refreshes,0,'hiding and reload cannot call the quota mutation');
      assert.ok((await page.locator('body').innerText()).includes('01000000000'));
      assert.ok((await page.locator('body').innerText()).includes('받은 요청 유지'));
      assert.equal(await page.getByRole('button',{name:/후보 새로고침 · 2회/}).count(),1);
      await page.getByRole('button',{name:'숨긴 후보 보기'}).click();await page.getByRole('button',{name:'숨김 해제',exact:true}).click();
      await title(main.name).waitFor();assert.equal(hidden.size,0);
      if(surface==='home'){
        await hideNamed(extra.name);await article(extra.name).waitFor({state:'hidden'});
        await hideNamed(proposed.name);await article(proposed.name).waitFor({state:'hidden'});
        const expansion=page.getByRole('region',{name:'후보 범위 넓히기'});
        await expansion.getByRole('button',{name:'후보 넓혀보기'}).click();await article(expanded.name).waitFor();
        await hideNamed(expanded.name);await article(expanded.name).waitFor({state:'hidden'});
        assert.ok(hidden.has(expanded.id));assert.ok((await page.locator('body').innerText()).includes('01000000000'));
      }
      // Hide the main candidate again, then use the actual paid-quota refresh UI.
      await hideNamed(main.name);await title(main.name).waitFor({state:'hidden'});
      assert.equal(await mainTitles('기본 숨김 후보').count(),9);
      await page.getByRole('button',{name:/후보 새로고침 · 2회/}).click();
      const confirmation=page.getByRole('dialog',{name:'후보를 새로고침할까요?'});
      await confirmation.waitFor();assert.equal(refreshes,0);
      await confirmation.getByRole('button',{name:'1회 사용하기',exact:true}).click();
      await page.getByRole('button',{name:/후보 새로고침 · 1회/}).waitFor();
      assert.equal(await mainTitles('새 명단 후보').count(),10);
      assert.equal(refreshes,1);
      await page.reload();await page.getByRole('button',{name:/후보 새로고침 · 1회/}).waitFor();
      assert.equal(await mainTitles('새 명단 후보').count(),10);
      assert.equal(await title(main.name).count(),0);
      assert.equal(refreshes,1);assert.ok((await page.locator('body').innerText()).includes('01000000000'));
      assert.deepEqual(errors,[]);assert.equal(external,0);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(output,`hides-${surface}-${width}.png`),fullPage:true});
      passed++;console.log(JSON.stringify({surface,width,writes,refreshes,passed:true,external,mutations}));
    }finally{await context.close();}
  }
  return passed;
};
