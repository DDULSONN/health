/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated localhost fixture: production UI, fake reads, ALL writes disabled, no credentials.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), webpack = require('webpack');
const root = path.resolve(__dirname, '..');
async function startPreview(port=3152) {
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-instant-preview-'));
  const adapter=path.join(__dirname,'fixtures/instant-registration-adapters.tsx');
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/instant-registration-browser.tsx'),output:{path:output,filename:'fixture.js'},
      resolve:{extensions:['.tsx','.ts','.js'],fallback:{crypto:false},alias:{'next/link':adapter,'next/navigation':adapter,'@/lib/supabase/client':adapter,'@/components/DatingAdultNotice':adapter,'@':root}},
      plugins:[new webpack.DefinePlugin({'process.env.NEXT_PUBLIC_OPENKAKAO_URL':'undefined'})],
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]} });
    compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();});
  });
  const cssDir=path.join(root,'.next/static/css');
  const css=fs.readdirSync(cssDir).filter(p=>p.endsWith('.css')).map(p=>fs.readFileSync(path.join(cssDir,p),'utf8')).join('\n');
  const source={id:'fixture-open',sex:'male',status:'pending',age:30,region:'서울',height_cm:178,job:'회사원',training_years:2,strengths_text:'대화와 산책을 좋아해요.',ideal_type:'서로 배려하는 분',instagram_id:'fixture_member',photo_visibility:'public',photo_paths:['cards/fixture-member/raw/a.jpg','cards/fixture-member/raw/b.jpg'],photo_preview_urls:['/preview-photo.svg','/preview-photo.svg']};
  const card={id:'fixture-paid',nickname:'공개 테스트',gender:'F',age:29,region:'서울',height_cm:165,job:'회사원',photo_visibility:'public',thumbUrl:'/preview-photo.svg',image_urls:['/preview-photo.svg','/preview-photo.svg'],display_mode:'instant_public',expires_at:new Date(Date.now()+36*3600000).toISOString(),strengths_text:'가상 프로필 · 운영 회원이 아닙니다.'};
  let failedReads=0;
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(output,'fixture.js')));return;}
    if(url.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
    if(url.pathname==='/preview-photo.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="300"><rect width="240" height="300" fill="#f3f4f6"/><text x="35" y="155" font-size="20" fill="#555">TEST PHOTO</text></svg>');return;}
    if(url.pathname.startsWith('/api/')){
      res.setHeader('Content-Type','application/json; charset=utf-8');
      if(req.method!=='GET'){console.log('BLOCKED_LOCAL_WRITE',req.method,url.pathname);res.statusCode=405;res.end(JSON.stringify({error:'로컬 검증에서는 등록/결제를 실행하지 않습니다.'}));return;}
      const scenario=new URL(req.headers.referer||'http://localhost').searchParams.get('scenario');
      let body={ok:true,items:[],cards:[],applications:[],loggedIn:true};
      if(url.pathname==='/api/mypage/summary')body={profile:{nickname:'테스트',phone_verified:true}};
      if(url.pathname==='/api/dating/1on1/write-status'){res.statusCode=503;body={error:'의도적으로 만든 별도 1:1 조회 오류'};}
      if(url.pathname==='/api/dating/cards/my')body={items:scenario==='no-profile'?[]:[{...source,status:scenario==='expired'?'expired':'pending'}]};
      if(url.pathname==='/api/dating/cards/list'||url.pathname==='/api/dating/cards/public')body={items:[],hasMore:false,audience:{status:'resolved',targetSex:'female',viewerSex:'male',canSwitchSex:false}};
      if(url.pathname==='/api/dating/cards/queue-stats')body={male:{public_count:0,pending_count:1,slot_limit:45},female:{public_count:0,pending_count:0,slot_limit:45}};
      if(url.pathname==='/api/dating/paid/list'){
        body={items:[card]}; if(scenario==='list-failure'&&failedReads++<2){res.statusCode=503;body={message:'의도적으로 만든 목록 오류'};}
      }
      if(url.pathname==='/api/dating/paid/create')body={card:{...source,...(url.searchParams.has('id')?{gender:'M',display_mode:'instant_public',status:'approved',expires_at:card.expires_at,ideal_text:source.ideal_type}:{})}};
      res.end(JSON.stringify(body));return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><aside style="padding:8px;background:#f5f5f5;color:#555;font:12px sans-serif;text-align:center">로컬 검증 · 가상 데이터 · 실제 등록/결제 차단</aside><nav style="padding:8px;font:12px sans-serif"><a href="/community/dating/cards?scenario=expired">만료 카드</a> · <a href="/community/dating/cards?scenario=no-profile">미등록</a> · <a href="/community/dating/cards?scenario=list-failure">조회 실패</a> · <a href="/dating/paid">유료카드</a> · <a href="/dating/paid?editId=fixture-paid">기존 유료카드 수정</a></nav><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));return {server,origin:'http://127.0.0.1:'+server.address().port};
}
module.exports={startPreview};
if(require.main===module)startPreview().then(({origin})=>console.log(origin+'/community/dating/cards')).catch(error=>{console.error(error);process.exitCode=1;});
