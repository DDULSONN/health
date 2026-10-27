/* eslint-disable @typescript-eslint/no-require-imports */
// Real home React page; every API is a fixture and external requests are blocked.
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({browser,origin,output})=>{
  let passed=0;
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  for(const width of [390,1280])for(const scenario of ['favorites','onboarding','few','empty','missing','inbox','inbox-empty']){
    const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();page.setDefaultTimeout(12000);
    const errors=[],mutations=[];let external=0,failFavorite=true,reads=0,favoriteDelay=null;
    const own={id:id(1),user_id:id(101),name:'검증 본인',sex:'female',age:29,status:'approved',region:'서울'};
    const card=n=>({id:id(n),user_id:id(n+100),name:`가상 후보 ${n}`,sex:'male',age:30,region:'서울',height_cm:180,job:'회사원',intro_text:'서로 배려하며 편안하게 대화하고 싶어요.',photo_signed_urls:['/fixture-photo.png']});
    let main=scenario==='empty'||scenario==='missing'?[]:Array.from({length:scenario==='few'?1:6},(_,i)=>card(i+2));
    const extra=scenario==='few'||scenario==='empty'||scenario==='missing'?[]:[card(20),card(21)];
    const saved=scenario==='favorites'?[card(30),card(31),card(32),card(33)]:[];
    const matches=scenario==='inbox'?[{id:id(50),role:'candidate',state:'source_selected',contact_exchange_status:'none',source_card_id:id(70),counterparty_card:card(70),action_required:true}]:[];
    if(scenario==='favorites')matches.push({id:id(51),role:'source',state:'mutual_accepted',contact_exchange_status:'approved',source_card_id:own.id,counterparty_card:card(71),counterparty_phone:'01000000000',contact_exchange_approved_at:new Date().toISOString()});
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin){external++;await route.abort();return;}
      if(!url.pathname.startsWith('/api/')){await route.continue();return;}
      let body={ok:true,items:[],cards:[],applications:[],loggedIn:true};
      if(req.method()!=='GET'){
        if(url.pathname==='/api/dating/1on1/recommendations/impressions'){await route.fulfill({json:{ok:true}});return;}
        mutations.push(url.pathname);const data=req.postDataJSON();
        if(url.pathname==='/api/dating/1on1/favorites'){
          assert.equal(data.source_card_id,own.id);
          if(failFavorite){await route.fulfill({status:503,json:{error:'찜 저장을 확인하지 못했어요.'}});return;}
          if(favoriteDelay)await favoriteDelay;
          const candidate=[...main,...extra,...saved].find(c=>c.id===data.candidate_card_id);assert.ok(candidate);
          if(req.method()==='DELETE')saved.splice(saved.findIndex(c=>c.id===candidate.id),1);
          else if(!saved.some(c=>c.id===candidate.id))saved.push(candidate);
          body={ok:true,favorite:req.method()==='POST'};
        }else if(url.pathname==='/api/dating/1on1/matches/auto'){
          assert.equal(data.source_card_id,own.id);const candidate=[...main,...saved].find(c=>c.id===data.candidate_card_id);assert.ok(candidate);
          main=main.filter(c=>c.id!==candidate.id);const index=saved.findIndex(c=>c.id===candidate.id);if(index>=0)saved.splice(index,1);
          matches.push({id:id(90),role:'source',state:'source_selected',contact_exchange_status:'none',source_card_id:own.id,counterparty_card:candidate});
        }else throw Error('Unexpected mutation: '+url.pathname);
        await route.fulfill({json:body});return;
      }
      switch(url.pathname){
        case '/api/dating/cards/queue-stats':body={male:{public_count:0,pending_count:0,slot_limit:45},female:{public_count:0,pending_count:0,slot_limit:45}};break;
        case '/api/mypage/summary':body={profile:{email:'fixture@example.invalid',nickname:'검증회원',phone_verified:true,nickname_changed_count:0,nickname_change_credits:0,swipe_profile_visible:true},account:{is_banned:false},isAdmin:false,weekly_win_count:0,bodycheck_posts:[]};break;
        case '/api/dating/1on1/my':body={items:scenario==='missing'?[]:[own]};break;
        case '/api/dating/1on1/write-status':body={canWrite:scenario==='missing',phoneVerified:true,writeStatus:'approved',activeRequestStatus:'approved'};break;
        case '/api/dating/1on1/matches/my':body={items:matches};break;
        case '/api/dating/1on1/recommendations/my':reads++;body={items:scenario==='missing'?[]:[{source_card_id:own.id,source_card_status:'approved',recommendations:main,admin_recommendations:extra,favorite_candidates:saved,hides_enabled:false,refresh_limit:2,refresh_used_count:0,refresh_remaining:2,can_refresh:true}]};break;
        case '/api/dating/cards/viewer-sex':body={status:'resolved',viewerSex:'female',targetSex:'male',source:'one_on_one',canSwitchSex:false,requiresSexSelection:false};break;
        case '/api/dating/cards/my/swipe-status':body={outgoing_likes:[],incoming_likes:[],summary:{incoming_pending:0,outgoing_pending:0}};break;
        case '/api/dating/cards/write-enabled':body={enabled:true};break;
        case '/api/dating/apply-credits/status':body={creditsRemaining:5};break;
      }
      await route.fulfill({json:body});
    });
    try{
      const from=['onboarding','few','empty','missing'].includes(scenario)?'&from=onboarding':scenario.startsWith('inbox')?'&focus=incoming':'';
      await page.goto(origin+'/community/dating/cards?tab=one_on_one'+from);
      // This fixture omits root layout; supply its local sans-serif fallback.
      await page.addStyleTag({content:':root { --font-korean-sans: "Malgun Gothic"; --font-geist-sans: Arial; }'});
      const panel=page.locator('#one-on-one-candidates'),recommendations=panel.locator('[data-one-on-one-section="recommendations"]');
      const favorites=page.getByRole('region',{name:'찜한 후보',exact:true});
      if(scenario==='favorites'){
        const header=favorites.getByRole('button',{name:/찜한 후보 4명/});await header.waitFor();assert.equal(await header.getAttribute('aria-expanded'),'false');
        await favorites.screenshot({path:path.join(output,`engagement-favorites-collapsed-${width}.png`)});
        assert.equal(await favorites.locator('article').count(),0);const initialReads=reads;
        await header.click();assert.equal(await favorites.locator('article').count(),3);
        await favorites.getByRole('button',{name:/찜한 후보 더보기/}).click();assert.equal(await favorites.locator('article').count(),4);assert.equal(reads,initialReads);
        const first=recommendations.locator('article').first();
        await first.getByRole('button',{name:'찜하기',exact:true}).click();await first.getByRole('alert').waitFor();assert.equal(saved.length,4);
        failFavorite=false;let release;favoriteDelay=new Promise(r=>release=r);
        await first.getByRole('button',{name:'찜하기',exact:true}).click();await first.getByRole('button',{name:'저장 중...'}).waitFor();
        assert.equal(await first.getByRole('button',{name:'매칭 요청 보내기',exact:true}).isDisabled(),true);
        release();favoriteDelay=null;await first.getByRole('button',{name:'찜 해제',exact:true}).waitFor();assert.equal(saved.length,5);assert.equal(reads,initialReads);
        await page.screenshot({path:path.join(output,`engagement-favorites-${width}.png`),fullPage:true});
        await first.getByRole('button',{name:'찜 해제',exact:true}).click();await first.getByRole('button',{name:'찜하기',exact:true}).waitFor();assert.equal(saved.length,4);
        await favorites.locator('article').first().getByRole('button',{name:'매칭 요청 보내기',exact:true}).click();
        await page.getByText(/매칭 요청을 보냈어요|요청이 전달됐어요|요청을 보냈어요/).first().waitFor();
        assert.equal(mutations.filter(p=>p.endsWith('/matches/auto')).length,1);assert.equal(saved.length,3);
        assert.ok((await panel.innerText()).includes('01000000000'));assert.equal(await page.getByRole('button',{name:/후보 새로고침 · 2회/}).count(),1);
      }else if(scenario==='onboarding'||scenario==='few'){
        await panel.getByRole('button',{name:/후보 모두 보기/}).waitFor();
        assert.equal(await recommendations.locator('article').count(),scenario==='few'?1:3);
        assert.equal(await recommendations.getByRole('button',{name:/후보 새로고침/}).count(),0);
        const initialReads=reads;await page.screenshot({path:path.join(output,`engagement-${scenario}-${width}.png`),fullPage:true});
        await recommendations.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`engagement-${scenario}-viewport-${width}.png`)});
        await panel.getByRole('button',{name:/후보 모두 보기/}).click();assert.equal(await recommendations.locator('article').count(),scenario==='few'?1:8);
        assert.equal(reads,initialReads);assert.equal(mutations.length,0);
        await recommendations.locator('article').first().getByRole('button',{name:'매칭 요청 보내기',exact:true}).click();
        await page.getByText(/매칭 요청을 보냈어요|요청이 전달됐어요|요청을 보냈어요/).first().waitFor();
        assert.equal(mutations.filter(p=>p.endsWith('/matches/auto')).length,1);
      }else if(scenario==='missing'){
        await panel.getByText('내 소개를 등록하고 후보를 만나보세요',{exact:true}).waitFor();
        assert.equal(await panel.getByText('1:1 신청서 작성 완료',{exact:true}).count(),0);assert.equal(await panel.getByRole('button',{name:/후보 모두 보기/}).count(),0);
      }else if(scenario==='empty'){
        await panel.getByText('1:1 신청서 작성 완료',{exact:true}).waitFor();assert.equal(await recommendations.locator('article').count(),0);assert.equal(await panel.getByRole('button',{name:/후보 모두 보기/}).count(),0);
      }else{
        const inbox=panel.locator('#one-on-one-incoming');
        if(scenario==='inbox')await inbox.getByRole('button',{name:'수락',exact:true}).waitFor();
        else await inbox.getByRole('status').waitFor();
        await page.waitForFunction(()=>document.activeElement?.id==='one-on-one-incoming');
        assert.equal(mutations.length,0);await page.screenshot({path:path.join(output,`engagement-${scenario}-${width}.png`),fullPage:true});
      }
      assert.deepEqual(errors,[]);assert.equal(external,0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      passed++;console.log(JSON.stringify({width,scenario,passed:true,reads,mutations,external}));
    }catch(error){await page.screenshot({path:path.join(output,`failed-engagement-${scenario}-${width}.png`),fullPage:true});throw error;}
    finally{await context.close();}
  }
  return passed;
};
