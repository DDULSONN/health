/* eslint-disable @typescript-eslint/no-require-imports */
// Render actual components, intercept every API and never open a real checkout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const webpack = require('webpack');
const root = path.resolve(__dirname, '..');
const runtime = process.env.CODEX_NODE_PACKAGES || 'C:/Users/DDULSONN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(path.join(runtime, 'playwright'));
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
    let state = 'retry', readFailure = false, writes = 0, requests = 0;
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
      await route.fulfill({json:{ok:true,recovery:{matchId:'fixture-match',name:'복귀테스트상대',age:29,region:'경기 수원',photoUrl:'/i/signed/fixture.webp',amount:20000,state}}});
    });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const width of [320,390,768]) {
      await page.setViewportSize({width,height:1000}); await page.goto(origin);
      const retry = page.getByRole('button',{name:'다른 카드로 다시 시도 · 20,000원'}); await retry.waitFor();
      assert.equal(writes,0,'Opening/reloading must not initiate payment');
      assert.equal(await page.getByText('테스트상대님이 보낸 1:1 한마디').count(),1);
      const offer = page.getByRole('region',{name:'교환 안내'});
      const msgBox = await offer.getByText('“연락처 교환해 주시면 첫 커피는 제가 살게요 ☕”').boundingBox();
      const buttonBox = await offer.getByRole('button',{name:'연락처 교환 · 20,000원'}).boundingBox();
      assert.ok(msgBox.y < buttonBox.y); assert.ok(buttonBox.height >= 44);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'No horizontal overflow');
      await page.getByRole('img').waitFor({ state:'hidden' });
      await page.screenshot({path:path.join(output,`contact-${width}.png`),fullPage:true});
    }
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
