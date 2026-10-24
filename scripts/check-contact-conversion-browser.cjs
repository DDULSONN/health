/* eslint-disable @typescript-eslint/no-require-imports */
// Render actual components, intercept every API and never open a real checkout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const webpack = require('webpack');
const root = path.resolve(__dirname, '..');
const { chromium } = require('./test-browser-runtime.cjs');
async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-contact-browser-'));
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'fixtures/contact-conversion-browser.tsx'),
      output: { path: output, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx','.ts','.js'], alias: { 'next/link': path.join(__dirname, 'fixtures/profile-ux-adapters.tsx'), '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs') }] },
    });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all:false, errors:true }))); else resolve(); });
  });
  const cssRoot = process.env.CONTACT_CONVERSION_CSS_DIR;
  assert.ok(cssRoot && fs.existsSync(cssRoot), 'Set CONTACT_CONVERSION_CSS_DIR to built Next CSS');
  const css = fs.readdirSync(cssRoot).filter(p => p.endsWith('.css')).map(p => fs.readFileSync(path.join(cssRoot, p),'utf8')).join('\n');
  const server = http.createServer((req,res) => {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type','text/javascript'); res.end(fs.readFileSync(path.join(output,'fixture.js'))); }
    else if (req.url === '/fixture.css') { res.setHeader('Content-Type','text/css'); res.end(css); }
    else if (req.url?.startsWith('/i/signed/')) { res.statusCode = 404; res.end(); }
    else { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end('<html lang="ko" style="--font-geist-sans:Arial"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel:'msedge', headless:true });
    const context = await browser.newContext({ viewport:{ width:390,height:844 } });
    let state = 'retry', readFailure = false, writes = 0, requests = 0, careReads = 0, careActive = true;
    const quoteReads = new Set();
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin, 'No production API access'); requests++;
      if (request.method() === 'POST') {
        writes++; assert.equal(url.pathname,'/api/payments/toss/create');
        assert.deepEqual(request.postDataJSON(),{ productType:'one_on_one_contact_exchange', matchId:'fixture-match', recoveryOrderId:'fixture_order_123' });
        await new Promise(resolve => setTimeout(resolve,200));
        await route.fulfill({status:409,json:{ok:false,message:'이미 결제가 확인됐어요. 결제 내역을 확인해 주세요.'}}); return;
      }
      if (readFailure) { await route.fulfill({status:503,json:{ok:false}}); return; }
      if (url.pathname === '/api/dating/1on1/contact-intro-offer') {
        quoteReads.add(url.searchParams.get('matchId'));
        await route.fulfill({json:{offer:null}}); return;
      }
      if (url.pathname === '/api/dating/1on1/contact-care') {
        careReads++;
        await route.fulfill({json:{active:careActive,starts_at:null,claim:null,payments:[],matches:[]}}); return;
      }
      await route.fulfill({json:{ok:true,recovery:{matchId:'fixture-match',name:'복귀테스트상대',age:29,region:'경기 수원',photoUrl:'/i/signed/fixture.webp',amount:20000,state}}});
    });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const width of [320,390,768]) {
      quoteReads.clear();
      await page.setViewportSize({width,height:1000}); await page.goto(origin);
      const retry = page.getByRole('button',{name:'다른 카드로 다시 시도 · 20,000원'}); await retry.waitFor();
      assert.equal(writes,0,'Opening/reloading must not initiate payment');
      assert.equal(await page.getByText('테스트상대님이 보낸 1:1 한마디').count(),1);
      const offer = page.getByRole('region',{name:'교환 안내'});
      const msgBox = await offer.getByText('“연락처 교환해 주시면 첫 커피는 제가 살게요 ☕”').boundingBox();
      const button = offer.getByRole('button',{name:'연락처 교환하기',exact:true});
      const buttonBox = await button.boundingBox();
      const price = offer.getByText('18,000원',{exact:true}); await price.waitFor();
      const priceBox = await price.boundingBox();
      assert.equal(await button.getAttribute('aria-describedby'),await price.getAttribute('id'));
      assert.ok(priceBox.y >= buttonBox.y + buttonBox.height, 'price stays visible directly below the CTA');
      assert.ok(priceBox.y - (buttonBox.y + buttonBox.height) <= 8);
      assert.ok(msgBox.y > buttonBox.y, 'optional greeting follows checkout; actual replies have a separate above-checkout assertion'); assert.ok(buttonBox.height >= 44);
      const care = offer.locator('summary').filter({hasText:'교환 직후 연락이 끊기면?'});
      assert.ok(await care.isVisible(), 'conditional support guidance remains visible without starting payment');
      assert.ok((await care.boundingBox()).y > priceBox.y, 'compact support guidance follows the CTA and its visible price');
      assert.equal(careReads, 0, 'support guidance does not fetch until opened');
      const list = page.getByRole('region',{name:'매칭 정렬 검증'});
      const links = list.getByRole('link');
      assert.match(await links.nth(0).innerText(), /최근수락/);
      assert.match(await links.nth(1).innerText(), /어제수락/);
      assert.equal(await list.getByText('이전상대0',{exact:true}).count(), 0);
      assert.equal([...quoteReads].some(id => id?.startsWith('old-')), false, 'folded cards never fetch payment quotes');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'No horizontal overflow');
      await page.getByRole('img').waitFor({ state:'hidden' });
      await page.screenshot({path:path.join(output,`contact-${width}.png`),fullPage:true});
      await offer.screenshot({path:path.join(output,`contact-offer-${width}.png`)});
      await list.screenshot({path:path.join(output,`contact-list-${width}.png`)});
    }
    const list = page.getByRole('region',{name:'매칭 정렬 검증'});
    const oldSummary = list.locator('summary').filter({hasText:'이전 미교환 매칭'});
    await oldSummary.click();
    await list.getByText('이전상대0',{exact:true}).waitFor();
    assert.equal(await list.getByText('이전상대3',{exact:true}).count(),0);
    await list.getByRole('button',{name:'이전 매칭 더보기 · 1건',exact:true}).click();
    await list.getByText('이전상대3',{exact:true}).waitFor();
    assert.equal(writes,0,'expanding groups never pays or sends');
    await oldSummary.click();
    await list.getByText('이전상대0',{exact:true}).waitFor({state:'hidden'});
    await page.getByLabel('이전 상대의 새 한마디 수신').check();
    await list.getByText('이전상대0님이 보낸 1:1 한마디',{exact:true}).waitFor();
    assert.match(await list.getByRole('link').first().innerText(),/이전상대0/);
    assert.equal(await list.getByText('이전상대0',{exact:true}).count(),1,'new partner message promotes once');
    const promoted = list.locator('article').filter({hasText:'이전상대0님이 보낸'});
    await promoted.getByRole('button',{name:'연락처 교환하기',exact:true}).click();
    assert.equal(await page.getByLabel('선택한 매칭').innerText(),'old-0');
    assert.equal(await promoted.getByRole('button',{name:'결제 준비 중...',exact:true}).isDisabled(),true);
    assert.equal(writes,0,'fixture calls only the original callback, never real checkout');
    const guide = page.getByRole('region',{name:'교환 안내'}).locator('details').filter({hasText:'교환 직후 연락이 끊기면?'});
    await guide.locator('summary').click();
    await guide.getByText(/^번호교환 후 72시간 이내, 결제한 회원이/).waitFor();
    assert.equal(careReads,1);
    assert.match(await guide.innerText(),/신청만으로 자동 지급되거나 상대가 제재되지는 않아요/);
    assert.equal(await guide.getByRole('button',{name:/신청하기|교환권 사용/}).count(),0,'guide cannot submit claims');
    await guide.locator('summary').click();
    careActive = false;
    await guide.locator('summary').click();
    await guide.getByText(/현재 신규 신청을 받지 않아요/).waitFor();
    const originalExchange = page.getByRole('region',{name:'교환 안내'}).getByRole('button',{name:'연락처 교환하기',exact:true});
    assert.equal(await originalExchange.isEnabled(),true,'support eligibility never gates checkout');
    readFailure = true;
    await guide.getByRole('button',{name:'내역 다시 확인',exact:true}).click();
    await guide.getByRole('alert').waitFor();
    assert.equal(await originalExchange.isEnabled(),true,'support read error never disables checkout');
    assert.equal(writes,0);
    readFailure = false;
    await guide.locator('summary').click();
    await page.getByLabel('기존 무료 혜택').check();
    await page.getByRole('button',{name:'무료로 번호교환'}).click();
    assert.ok((await page.getByLabel('작동 횟수').innerText()).includes('교환 1 · 문구 0'));
    await page.getByLabel('받은 한마디').uncheck();
    assert.equal(await page.getByText('테스트상대님이 보낸 1:1 한마디').count(),0);
    await page.getByRole('button',{name:'한마디 보내기',exact:true}).click();
    page.once('dialog', d => d.dismiss());
    await page.getByRole('button',{name:'저는 연락처를 교환하고 싶어요 🙂',exact:true}).click();
    assert.ok((await page.getByLabel('작동 횟수').innerText()).includes('문구 0'));
    const retry = page.getByRole('button',{name:'다른 카드로 다시 시도 · 20,000원'});
    await retry.evaluate(button => { button.click(); button.click(); });
    await page.getByRole('alert').waitFor(); assert.equal(writes,1,'Double-click only makes one POST');
    assert.equal(await page.getByRole('button',{name:/다른 카드로 다시 시도/}).count(),0,'Lost/stale result cannot be retried blindly');
    for (const nextState of ['paid','pending','unavailable']) {
      state = nextState; await page.reload(); await page.getByText('복귀테스트상대님과의 연락처 교환').waitFor();
      assert.equal(await page.getByRole('button',{name:/다른 카드로 다시 시도/}).count(),0); assert.equal(writes,1);
    }
    readFailure = true; await page.reload(); await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button',{name:/다른 카드로 다시 시도/}).count(),0);
    assert.deepEqual(errors,[]); assert.ok(requests > 0);
    console.log(JSON.stringify({ok:true,widths:[320,390,768],automaticPayments:0,doubleClickPosts:writes,blockedStates:['paid','pending','unavailable','read-error'],pageErrors:errors,screenshots:output}));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
