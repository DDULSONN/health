/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({browser,origin,output})=>{
  let passed=0;
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  for(const surface of ['home','mypage'])for(const width of [320,390,1280]){
    const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();page.setDefaultTimeout(10000);
    const own={id:id(1),user_id:id(101),name:'본인',sex:'female',age:29,status:'approved',region:'서울'};
    const card={id:id(2),user_id:id(102),name:'복구 후보',sex:'male',age:30,region:'서울',job:'회사원',intro_text:'검증 프로필',photo_signed_urls:[]};
    let mode='empty',hidden=true,failRestore=true,hiddenReads=0;const mutations=[],errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin)throw Error('External traffic forbidden');
      if(!url.pathname.startsWith('/api/'))return route.continue();
      let body={ok:true,items:[],cards:[],applications:[],loggedIn:true};
      if(req.method()!=='GET'){
        mutations.push(url.pathname);
        if(url.pathname==='/api/dating/1on1/recommendations/impressions')return route.fulfill({json:{ok:true}});
        assert.equal(url.pathname,'/api/dating/1on1/candidate-hides');
        assert.deepEqual(req.postDataJSON(),{action:'restore',id:card.id});
        if(failRestore)return route.fulfill({status:503,json:{error:'잠시 후 다시 확인해 주세요.'}});
        hidden=false;mode='one';return route.fulfill({json:{ok:true}});
      }
      switch(url.pathname){
        case '/api/mypage/summary':body={profile:{email:'fixture@example.invalid',nickname:'검증회원',phone_verified:true,nickname_changed_count:0,nickname_change_credits:0,swipe_profile_visible:true},account:{is_banned:false},isAdmin:false,weekly_win_count:0,bodycheck_posts:[]};break;
        case '/api/dating/cards/queue-stats':body={male:{public_count:0,pending_count:0,slot_limit:45},female:{public_count:0,pending_count:0,slot_limit:45}};break;
        case '/api/dating/1on1/my':body={items:[own]};break;
        case '/api/dating/1on1/write-status':body={canWrite:false,phoneVerified:true,writeStatus:'approved',activeRequestStatus:'approved'};break;
        case '/api/dating/1on1/matches/my':body={items:[
          {id:id(51),source_card_id:own.id,role:'candidate',state:'source_selected',contact_exchange_status:'none',counterparty_card:{...card,name:'받은 요청 유지'},action_required:true},
          {id:id(52),source_card_id:own.id,role:'source',state:'mutual_accepted',contact_exchange_status:'approved',counterparty_card:{...card,name:'번호교환 유지'},counterparty_phone:'01000000000',contact_exchange_approved_at:new Date().toISOString()}
        ]};break;
        case '/api/dating/1on1/recommendations/my':{
          const count=mode==='empty'?0:mode==='one'?1:10;
          body={items:[{source_card_id:own.id,source_card_status:'approved',hides_enabled:mode!=='disabled',hidden_candidate_ids:hidden?[card.id]:[],impression_ticket:'local-receipt',
            recommendations:Array.from({length:count},(_,i)=>({...card,id:id(i+2),user_id:id(i+102),name:i?`후보 ${i}`:card.name})),admin_recommendations:[],favorite_candidates:[],
            refresh_limit:2,refresh_used_count:0,refresh_remaining:2,can_refresh:true,candidate_pool_count:count,
            recommendation_availability:count<10?{state:count?'limited':'empty',candidate_count:count,has_hidden_candidates:hidden,has_request_history:true,has_favorites:false}:null}]};break;
        }
        case '/api/dating/1on1/candidate-hides':hiddenReads++;body={enabled:true,items:hidden?[{id:card.id,name:card.name,created_at:new Date().toISOString()}]:[]};break;
        case '/api/dating/cards/viewer-sex':body={status:'resolved',viewerSex:'female',targetSex:'male',source:'one_on_one',canSwitchSex:false,requiresSexSelection:false};break;
        case '/api/dating/cards/my/swipe-status':body={outgoing_likes:[],incoming_likes:[],summary:{incoming_pending:0,outgoing_pending:0}};break;
        case '/api/dating/cards/write-enabled':body={enabled:true};break;
        case '/api/dating/apply-credits/status':body={creditsRemaining:5};break;
      }
      return route.fulfill({json:body});
    });
    try{
      await page.goto(origin+(surface==='home'?'/community/dating/cards?tab=one_on_one':'/mypage?section=matching&matching=one_on_one'));
      await page.getByText('지금 새로 추천할 후보가 없어요.',{exact:true}).waitFor();
      await page.getByText('이미 요청했거나 거절·차단한 상대는 추천에서 제외해요.',{exact:true}).waitFor();
      await page.getByText('숨김을 해제하면 조건에 맞는 후보를 다시 추천받을 수 있어요.',{exact:true}).waitFor();
      assert.equal(await page.getByText(/지금 바로 보여줄 자동 추천 후보가 없어요/).count(),0,'no duplicate empty-pool explanation');
      assert.equal(hiddenReads,0,'no new background query for the hint');
      const unchanged=async()=>{
        await page.getByRole('button',{name:/후보 새로고침 · 2회/}).waitFor();
        const text=await page.locator('body').innerText();assert.ok(text.includes('01000000000'));assert.ok(text.includes('받은 요청 유지'));
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      };
      await unchanged();
      await page.getByText('지금 새로 추천할 후보가 없어요.',{exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,`availability-${surface}-${width}.png`)});
      await page.getByRole('button',{name:'숨긴 후보 보기'}).click();
      await page.getByRole('button',{name:'숨김 해제',exact:true}).click();
      await page.getByRole('alert').filter({hasText:'잠시 후 다시 확인해 주세요.'}).waitFor();assert.equal(hidden,true);await unchanged();
      failRestore=false;await page.getByRole('button',{name:'숨김 해제',exact:true}).click();
      await page.getByText('지금 추천 가능한 후보는 1명이에요.',{exact:true}).waitFor();
      assert.equal(hidden,false);await unchanged();
      assert.equal(await page.getByText('숨김을 해제하면 조건에 맞는 후보를 다시 추천받을 수 있어요.',{exact:true}).count(),0);
      mode='full';await page.reload();await page.getByRole('button',{name:'숨긴 후보 보기'}).waitFor();await unchanged();
      assert.equal(await page.getByText(/지금 추천 가능한 후보는/).count(),0);
      mode='disabled';await page.reload();await page.getByRole('button',{name:/후보 새로고침 · 2회/}).waitFor();
      assert.equal(await page.getByRole('button',{name:'숨긴 후보 보기'}).count(),0);
      assert.ok(mutations.every(p=>p.endsWith('/candidate-hides')||p.endsWith('/impressions')),'no refresh, matching, payment or contact mutations');
      assert.deepEqual(errors,[]);passed++;console.log(JSON.stringify({surface,width,passed:true,hiddenReads,mutations}));
    }finally{await context.close();}
  }
  return passed;
};
