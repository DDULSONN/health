/* eslint-disable @typescript-eslint/no-require-imports */
// Builds the actual React page with test-only service adapters, then drives a real browser.
// All network writes stay inside fixture routes. No production credentials are loaded.
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
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-profile-ux-browser-'));
  const adapter = path.join(__dirname, 'fixtures/profile-ux-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'fixtures/profile-ux-browser.tsx'),
      output: { path: output, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx','.ts','.js'], alias: {
        'next/link': adapter, 'next/image': adapter, 'next/navigation': adapter,
        '@/lib/supabase/client': adapter, '@/components/DatingAdultNotice': adapter, '@': root,
      } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs') }] },
    });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all:false, errors:true }))); else resolve(); });
  });
  const cssRoot = process.env.PROFILE_UX_CSS_DIR;
  const css = cssRoot && fs.existsSync(cssRoot) ? fs.readdirSync(cssRoot).filter(p => p.endsWith('.css')).map(p => fs.readFileSync(path.join(cssRoot,p),'utf8')).join('\n') : '';
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type','text/javascript'); res.end(fs.readFileSync(path.join(output,'fixture.js'))); }
    else if (req.url === '/fixture.css') { res.setHeader('Content-Type','text/css'); res.end(css); }
    else { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width:390, height:844 } });
    const page = await context.newPage(); const errors = []; const writes = []; const analytics = [];
    page.on('pageerror', e => errors.push(e.message));
    let existingOpen = false, allowOne = true, failOne = false, failBootstrap = '', phoneVerified = true;
    await context.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url());
      assert.equal(url.origin, origin);
      if (url.pathname === '/api/analytics/onboarding') {
        const body = JSON.parse(req.postData());
        assert.deepEqual(Object.keys(body), ['event']);
        assert.match(body.event, /^(profile_|validation_|submit_|upload_failed$|photo_rejected$)/);
        analytics.push(body.event);
        // Deliberate outage: analytics cannot block any form behavior.
        await route.abort(); return;
      }
      if (req.method() === 'GET' && url.pathname === failBootstrap) {
        await route.fulfill({status:503,json:{error:'fixture unavailable'}}); return;
      }
      let body = {};
      if (req.method() !== 'GET') writes.push({ url: url.pathname, body: req.postData() });
      if (url.pathname.endsWith('/write-status')) body = { phoneVerified, canWrite: allowOne, writeStatus: 'approved', activeRequestStatus: allowOne ? null : 'submitted' };
      else if (url.pathname === '/api/dating/cards/my' && req.method() === 'GET') body = { items: existingOpen ? [{ status:'pending' }] : [] };
      else if (url.pathname.endsWith('/write-enabled')) body = { enabled:true };
      else if (url.pathname === '/api/mypage/summary') body = { profile:{ nickname:'테스트' } };
      else if (url.pathname.includes('upload')) body = { path:'fixture/photo.jpg' };
      else if (url.pathname === '/api/dating/1on1/cards' && failOne) { await route.fulfill({ status:500, json:{error:'테스트 등록 실패'} }); return; }
      await route.fulfill({ json:body });
    });
    await page.goto(origin);
    const next = () => page.getByRole('button',{ name:'다음',exact:true }).click();
    await next();
    await page.waitForFunction(() => document.activeElement?.id === 'onboarding-field-sex');
    assert.equal(await page.locator('[aria-invalid="true"]').count(), 5);
    await page.getByRole('button',{name:'여자',exact:true}).click();
    for (const [id,value] of Object.entries({name:'테스트이름',birthYear:'1996',heightCm:'170',job:'회사원',region:'서울'})) await page.locator('#onboarding-field-'+id).fill(value);
    await next();
    await page.locator('#onboarding-field-introText').fill('한글 소개가 그대로 저장되어야 해요.');
    await page.locator('#onboarding-field-strengthsText').fill('다정하고 배려하는 사람입니다.');
    await page.locator('#onboarding-field-preferredPartnerText').fill('대화가 잘 통하는 분을 만나고 싶어요.');
    // Reload before debounce: pagehide must flush the latest Korean text.
    await page.reload();
    await page.getByRole('button',{name:'이어서 작성',exact:true}).click();
    assert.equal(await page.locator('#onboarding-field-introText').inputValue(),'한글 소개가 그대로 저장되어야 해요.');
    await next(); await next();
    await page.waitForFunction(() => document.activeElement?.id === 'onboarding-field-instagramId');
    await page.locator('#onboarding-field-instagramId').fill('fixture.user');
    await next(); await next();
    await page.waitForFunction(() => document.activeElement?.id === 'onboarding-field-photo0');
    assert.equal(await page.locator('input[type=file][aria-invalid=true]').count(),2);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z0MAAAAASUVORK5CYII=','base64');
    for (const i of [0,1]) await page.locator('#onboarding-field-photo'+i).setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:png});
    await next();
    await page.getByRole('button',{name:'선택한 프로필 등록하기',exact:true}).click();
    await page.waitForFunction(() => document.activeElement?.id === 'onboarding-field-consentOpenCard');
    assert.equal(await page.locator('input[type=checkbox][aria-invalid=true]').count(),6);
    await page.screenshot({path:path.join(output,'mobile-consent-errors.png'),fullPage:true});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.reload();
    await page.getByRole('button',{name:'이어서 작성',exact:true}).click();
    assert.equal(await page.locator('input[type=file]').count(),2);
    assert.equal(await page.locator('#onboarding-field-photo0').evaluate(el => el.files.length),0);
    for (const i of [0,1]) await page.locator('#onboarding-field-photo'+i).setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:png});
    await next();
    assert.equal(await page.locator('input[type=checkbox]:checked').count(),0);
    for (const checkbox of await page.locator('input[type=checkbox]').all()) await checkbox.check();
    failOne = true;
    await page.getByRole('button',{name:'선택한 프로필 등록하기',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'테스트 등록 실패'}).waitFor();
    assert.equal(writes.filter(w => w.url === '/api/dating/cards/my').length,1);
    assert.equal(writes.filter(w => w.url === '/api/dating/1on1/cards').length,1);
    // Retrying preserves the successful open card and cannot submit it again.
    failOne = false;
    await page.getByRole('button',{name:'남은 등록 다시 시도',exact:true}).evaluate(el => { el.click(); el.click(); });
    await page.waitForFunction(() => window.fixtureRedirect?.includes('one_on_one'));
    assert.equal(writes.filter(w => w.url === '/api/dating/cards/my').length,1);
    assert.equal(writes.filter(w => w.url === '/api/dating/1on1/cards').length,2);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes('dating-onboarding-draft')).length),0);
    await page.reload();
    assert.equal(await page.getByRole('button',{name:'이어서 작성',exact:true}).count(),0);
    await page.getByRole('button',{name:'여자',exact:true}).click();
    await page.locator('#onboarding-field-job').fill('저장될 직업');
    await page.waitForTimeout(650);
    existingOpen = true;
    await page.reload(); await page.getByRole('button',{name:'이어서 작성',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:/오픈카드 등록됨/}).isDisabled(),true);
    assert.equal(await page.locator('#onboarding-field-job').inputValue(),'저장될 직업');
    await page.screenshot({path:path.join(output,'mobile-resumed.png'),fullPage:true});
    await page.setViewportSize({width:1280,height:900});
    await page.reload();
    await page.getByRole('button',{name:'이어서 작성',exact:true}).waitFor();
    await page.screenshot({path:path.join(output,'desktop-resume-prompt.png'),fullPage:true});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button',{name:'새로 작성',exact:true}).click();
    assert.equal(await page.locator('#onboarding-field-job').inputValue(),'');
    await page.locator('#onboarding-field-job').fill('로그아웃 시 삭제할 내용');
    await page.waitForTimeout(650);
    await page.evaluate(() => window.fixtureSignOut());
    await page.waitForFunction(() => document.querySelector('#onboarding-field-job')?.value === '');
    assert.equal(await page.getByRole('button',{name:'이어서 작성',exact:true}).count(),0);
    await page.locator('#onboarding-field-job').fill('계정 전환 시 삭제할 내용');
    await page.evaluate(() => { window.fixtureMarker = 'keep'; window.fixtureRefresh(); });
    assert.equal(await page.evaluate(() => window.fixtureMarker),'keep');
    assert.equal(await page.locator('#onboarding-field-job').inputValue(),'계정 전환 시 삭제할 내용');
    await page.waitForTimeout(650);
    // Fail each prerequisite independently. Drafts must survive failure and retry.
    for (const endpoint of ['/api/dating/1on1/write-status','/api/dating/cards/my','/api/dating/cards/write-enabled','/api/mypage/summary']) {
      failBootstrap = endpoint;
      await page.reload();
      await page.getByRole('heading',{name:'등록 상태를 확인하지 못했어요'}).waitFor();
      assert.equal(await page.getByText('이미 준비가 끝났어요',{exact:true}).count(),0);
      const saved = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.includes('dating-onboarding-draft')));
      await page.waitForTimeout(650);
      assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.includes('dating-onboarding-draft'))),saved);
      failBootstrap = '';
      await page.getByRole('button',{name:'다시 시도',exact:true}).click();
      await page.getByRole('button',{name:'이어서 작성',exact:true}).click();
      assert.equal(await page.locator('#onboarding-field-job').inputValue(),'계정 전환 시 삭제할 내용');
    }
    const writesBeforeRedirect = writes.length;
    phoneVerified = false;
    await page.reload();
    await page.waitForFunction(() => window.fixtureRedirect?.startsWith('/phone-verification?'));
    assert.equal(await page.locator('#onboarding-field-job').count(),0);
    phoneVerified = true;
    await page.goto(origin+'/?next=instant_open_card');
    await page.waitForFunction(() => window.fixtureRedirect?.startsWith('/dating/paid?'));
    assert.equal(writes.length,writesBeforeRedirect);
    await page.goto(origin);
    await page.getByRole('button',{name:'이어서 작성',exact:true}).click();
    // A different authenticated account must not see or inherit member one's text.
    await page.addInitScript(() => { window.fixtureUser = 'fixture-member-b'; });
    await page.reload();
    await page.locator('#onboarding-field-job').waitFor();
    assert.equal(await page.locator('#onboarding-field-job').inputValue(),'');
    assert.equal(await page.getByRole('button',{name:'이어서 작성',exact:true}).count(),0);
    // Storage denied: still usable, honest warning, no unhandled exception.
    await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('fixture full','QuotaExceededError'); }; });
    await page.reload(); await page.locator('#onboarding-field-job').fill('저장 공간 부족');
    await page.getByRole('status').filter({hasText:'임시저장이 안 돼요'}).waitFor();
    await page.getByRole('button',{name:'다음',exact:true}).click();
    await page.waitForFunction(() => document.activeElement?.id === 'onboarding-field-sex');
    assert.deepEqual(errors,[]);
    for (const code of ['profile_basic', 'profile_intro', 'profile_lifestyle', 'profile_photos', 'profile_review',
      'validation_basic', 'validation_lifestyle', 'validation_photos', 'validation_review', 'submit_started', 'submit_failed']) {
      assert.ok(analytics.includes(code), 'missing diagnostic: ' + code);
    }
    console.log('PASS: mobile/desktop real React/browser validation, Korean reload/flush, photo/consent reset, partial success retry, double-click lock, success cleanup, logout/account isolation, normal token renewal, all four prerequisite failures/retries, phone/instant-registration redirects, storage denial; no runtime errors.');
    console.log('Screenshots: '+output);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });
