/* eslint-disable @typescript-eslint/no-require-imports */
// Real panel and review rules; isolated local API/store. Every non-local request is blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const webpack = require('webpack'), ts = require('typescript');
const { chromium } = require('./test-browser-runtime.cjs');
const root = path.resolve(__dirname, '..');
const modules = new Map();
function load(name) {
  if (name === '@/lib/images') return { buildSignedImageUrlAllowRaw: () => '', extractStorageObjectPathFromBuckets: x => x };
  if (!name.startsWith('@/')) return require(name);
  if (modules.has(name)) return modules.get(name).exports;
  const mod = {exports:{}}; modules.set(name,mod);
  const code = ts.transpileModule(fs.readFileSync(path.join(root,name.slice(2)+'.ts'),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  new Function('require','module','exports',code)(load,mod,mod.exports);return mod.exports;
}
const rules=load('@/lib/dating-profile-review');
function item(text='운동하고 산책하는 것을 좋아해요.\nfixture_handle') {
  const card={sourceType:'one_on_one_application',cardId:'00000000-0000-4000-8000-000000000001',
    userId:'00000000-0000-4000-8000-000000000002',displayName:'검증 회원',status:'source_selected',
    age:30,region:'서울',bucket:'fixture',photoPaths:['a.webp','b.webp'],previewUrls:[],createdAt:'2026-10-21T00:00:00Z',
    texts:{name:'검증 회원',intro:text,strengths:'약속을 지키고 상대방의 이야기를 잘 들어요.',preferredPartner:'다정한 사람이 좋아요.'}};
  const review=rules.withReviewSnapshot(card,rules.ruleReview(card));
  return {...card,review,confirmationSnapshot:review.raw.confirmationSnapshot};
}
async function main() {
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-contact-review-'));
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/admin-contact-review-browser.js'),
      output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':root}},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/mypage-navigation-loader.cjs')}]}});
    compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();});
  });
  const cssRoot=path.join(root,'.next/static/css');
  const css=fs.readdirSync(cssRoot).filter(n=>n.endsWith('.css')).map(n=>fs.readFileSync(path.join(cssRoot,n),'utf8')).join('\n');
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'");
    if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(output,'fixture.js')));}
    if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
    if(req.url.startsWith('/api/')){res.writeHead(500);return res.end('Unmocked API request');}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser,passed=0;
  try {
    browser=await chromium.launch({headless:true});
    for(const width of [360,1280])for(const scenario of ['success','save-error','stale-content']) {
      const context=await browser.newContext({viewport:{width,height:900}});
      const page=await context.newPage();page.setDefaultTimeout(10000);
      let current=item(), confirmed=false, scans=0, patches=0;const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await context.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());
        assert.equal(url.origin,origin,'External traffic forbidden');
        if(!url.pathname.startsWith('/api/'))return route.continue();
        assert.equal(url.pathname,'/api/admin/dating/card-ai-review','No member, matching, email or payment endpoints');
        if(req.method()==='POST') {
          const body=req.postDataJSON();assert.equal(body.mode,'rules');scans++;
          return route.fulfill({json:{ok:true,mode:'rules',scannedCount:1,suspiciousCount:confirmed?0:1,items:confirmed?[]:[current]}});
        }
        if(req.method()==='PATCH') {
          patches++;const body=req.postDataJSON();assert.equal(body.cardId,current.cardId);assert.equal(body.action,'confirm_normal');
          assert.deepEqual(body.snapshot,current.confirmationSnapshot);
          if(scenario==='save-error')return route.fulfill({status:500,json:{ok:false,message:'저장하지 못했습니다. 다시 시도해 주세요.'}});
          if(scenario==='stale-content'&&patches===1) {
            current=item('다정하고 운동을 좋아합니다.\n@new_fixture_handle');
            return route.fulfill({status:409,json:{ok:false,code:'REVIEW_CHANGED',sourceType:current.sourceType,cardId:current.cardId,
              item:current,message:'최신 내용을 확인한 뒤 다시 정상 확인해 주세요.'}});
          }
          confirmed=true;return route.fulfill({json:{ok:true,sourceType:current.sourceType,cardId:current.cardId,
            confirmationId:'00000000-0000-4000-8000-000000000003',message:'정상 확인 완료'}});
        }
        assert.equal(req.method(),'GET');
        return route.fulfill({json:{ok:true,items:scans&&!confirmed?[current]:[]}});
      });
      try {
        await page.goto(origin);
        await page.getByRole('button',{name:'일반 검수',exact:true}).click();
        await page.getByRole('button',{name:'✓ 정상 확인',exact:true}).waitFor();
        assert.ok((await page.locator('body').innerText()).includes('자기소개: 외부 계정 형식 확인 필요 · 감지: fixture_handle'));
        await page.getByRole('region',{name:'프로필 내용'}).waitFor();
        await page.screenshot({path:path.join(output,`review-${width}-${scenario}.png`),fullPage:true});
        await page.getByRole('button',{name:'✓ 정상 확인',exact:true}).click();
        if(scenario==='save-error') {
          await page.getByRole('alert').waitFor();
          assert.equal(await page.getByRole('button',{name:'✓ 정상 확인',exact:true}).isEnabled(),true);
          assert.equal(confirmed,false);
        } else {
          if(scenario==='stale-content') {
            await page.getByRole('alert').waitFor();
            assert.ok((await page.locator('body').innerText()).includes('@new_fixture_handle'));
            assert.equal(confirmed,false);
            await page.getByRole('button',{name:'✓ 정상 확인',exact:true}).click();
          }
          await page.getByText('정상 확인 완료',{exact:true}).waitFor();
          assert.equal(await page.getByRole('button',{name:'✓ 정상 확인',exact:true}).count(),0);
          await page.getByRole('button',{name:'최근 결과',exact:true}).click();
          await page.getByText('표시할 의심 카드/지원 내역이 없습니다.',{exact:true}).waitFor();
        }
        assert.equal(scans,1);assert.equal(patches,scenario==='stale-content'?2:1);
        assert.deepEqual(errors,[]);
        assert.ok(!(await page.locator('body').innerText()).includes('\uFFFD'));
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
        console.log(JSON.stringify({width,scenario,passed:true}));passed++;
      } finally {await context.close();}
    }
    console.log(JSON.stringify({passed,output}));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
