/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('./test-browser-runtime.cjs');
const {start}=require('./preview-contact-nudge-reply.cjs');
async function main(){
  const s=await start();let browser;
  try{
    browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844}});
    const external=[];await context.route('**/*',route=>{if(new URL(route.request().url()).origin===s.origin)return route.continue();external.push(route.request().url());return route.abort();});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>d.accept());
    const open=async()=>{await page.goto(s.origin+'/?role=recipient');await page.getByRole('button',{name:'짧게 답하기',exact:true}).click();};
    for(const width of [320,390,768]){
      await s.reset();await page.setViewportSize({width,height:844});await open();
      assert.equal(await page.getByRole('button',{name:'좋아요, 연락 나눠봐요.',exact:true}).count(),1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(s.out,`reply-options-${width}.png`),fullPage:true});
      if(width===390)await page.locator('div.border-l-2').first().screenshot({path:path.join(s.out,'reply-detail.png')});
      await page.getByRole('button',{name:'연락처 교환하기',exact:true}).click();
      await page.getByText(/미리보기에서는 실제 결제하지 않아요/).waitFor();assert.equal(s.replyPosts(),0,'payment never requires a reply');
    }
    await s.reset();await open();s.flags.delay=600;
    await page.getByRole('button',{name:'좋아요, 연락 나눠봐요.',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'이번 주에 연락 가능해요.',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'연락처 교환하기',exact:true}).isEnabled(),true,'reply pending must not gate checkout');
    await page.getByText('내가 보낸 답장',{exact:true}).waitFor();assert.equal(s.replyPosts(),1);
    await page.reload();await page.getByText('내가 보낸 답장',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'짧게 답하기',exact:true}).count(),0);
    await page.getByRole('link',{name:'보낸 사람 화면'}).click();await page.getByText('상대의 답장',{exact:true}).waitFor();
    await page.getByText('“좋아요, 연락 나눠봐요.”',{exact:true}).waitFor();
    await page.screenshot({path:path.join(s.out,'sender-reply.png'),fullPage:true});
    // Server saved but response was lost: retry shows the original reply, not a different one.
    await s.reset();s.flags.failAfterSave=true;await open();await page.getByRole('button',{name:'이번 주에 연락 가능해요.',exact:true}).click();
    await page.getByRole('alert').waitFor();assert.equal(await page.getByText('내가 보낸 답장',{exact:true}).count(),0);
    s.flags.failAfterSave=false;await page.getByRole('button',{name:'지금은 어려울 것 같아요.',exact:true}).click();
    await page.getByText('내가 보낸 답장',{exact:true}).waitFor();await page.getByText('이번 주에 연락 가능해요.',{exact:true}).waitFor();
    assert.equal((await s.r.db.query('select count(*)::int n from dating_1on1_contact_nudge_replies')).rows[0].n,1);
    // Failure leaves checkout usable; stale UI after cancellation cannot save.
    await s.reset();s.flags.failReply=true;await open();await page.getByRole('button',{name:'좋아요, 연락 나눠봐요.',exact:true}).click();
    await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'연락처 교환하기',exact:true}).isEnabled(),true);
    s.flags.failReply=false;await s.r.db.exec("update dating_1on1_match_proposals set state='admin_canceled'");
    await page.getByRole('button',{name:'좋아요, 연락 나눠봐요.',exact:true}).click();await page.getByText(/이미 연락처를 교환했거나 종료된 매칭/).waitFor();
    assert.equal((await s.r.db.query('select count(*)::int n from dating_1on1_contact_nudge_replies')).rows[0].n,0);
    assert.equal(await page.getByRole('button',{name:'좋아요, 연락 나눠봐요.',exact:true}).isDisabled(),true);
    // A real negative reply is visible before checkout, never hidden as optional content.
    await s.reset();await page.setViewportSize({width:390,height:844});await open();
    await page.getByRole('button',{name:'지금은 어려울 것 같아요.',exact:true}).click();
    await page.getByText('내가 보낸 답장',{exact:true}).waitFor();
    await page.getByRole('link',{name:'보낸 사람 화면'}).click();
    const negative=page.getByText('“지금은 어려울 것 같아요.”',{exact:true});await negative.waitFor();
    assert.ok((await negative.boundingBox()).y<(await page.getByRole('button',{name:'연락처 교환하기',exact:true}).boundingBox()).y);
    await page.screenshot({path:path.join(s.out,'sender-negative.png'),fullPage:true});
    // New optional greeting goes through the actual send API and SQL; provider adapters are offline.
    await s.reset();await page.goto(s.origin+'/?role=recipient');
    await page.getByRole('button',{name:'가볍게 인사하기',exact:true}).waitFor();
    await page.screenshot({path:path.join(s.out,'greeting-closed-390.png'),fullPage:true});
    await page.getByRole('button',{name:'가볍게 인사하기',exact:true}).click();
    for(const message of ['반가워요. 편하게 이야기 나눠보고 싶어요 🙂','처음엔 가볍게 커피 한잔하면 좋겠어요 ☕','운동 이야기부터 나눠봐도 좋겠네요!'])assert.equal(await page.getByRole('button',{name:message,exact:true}).count(),1);
    assert.equal(await page.getByRole('button',{name:'연락처 교환해 주시면 첫 커피는 제가 살게요 ☕',exact:true}).count(),0);
    await page.getByRole('button',{name:'처음엔 가볍게 커피 한잔하면 좋겠어요 ☕',exact:true}).click();
    await page.getByText('인사를 보냈어요. 로컬 가상 계정에만 저장됐어요.',{exact:true}).waitFor();
    await page.getByRole('link',{name:'보낸 사람 화면'}).click();
    await page.getByText('“처음엔 가볍게 커피 한잔하면 좋겠어요 ☕”',{exact:true}).waitFor();
    assert.equal((await s.r.db.query('select count(*)::int n from dating_1on1_contact_nudges')).rows[0].n,2);
    assert.equal(s.r.calls.filter(c=>c.email).length,1);
    await s.reset();await s.r.db.exec('drop table dating_1on1_contact_nudge_replies');await page.goto(s.origin);
    await page.getByRole('button',{name:'연락처 교환하기',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'짧게 답하기',exact:true}).count(),0);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log('PASS: real UI → API → local SQL → sender, reload/idempotency/lost response/canceled/missing SQL, payment independence, 320/390/768px; '+s.out);
  }finally{await browser?.close();await s.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
