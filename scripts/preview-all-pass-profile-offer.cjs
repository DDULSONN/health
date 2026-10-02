/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),webpack=require('webpack');
const root=path.resolve(__dirname,'..');
async function startPreview(port=0) {
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-all-pass-offer-'));
 await new Promise((resolve,reject)=>{
  const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/all-pass-offer-browser.tsx'),output:{path:output,filename:'fixture.js'},
   resolve:{extensions:['.tsx','.ts','.js'],alias:{'@/lib/supabase/client':path.join(__dirname,'fixtures/return-reward-adapters.tsx'),'@/lib/dating-swipe':path.join(__dirname,'fixtures/all-pass-offer-analytics.ts'),'@/lib/payment-analytics':path.join(__dirname,'fixtures/all-pass-offer-analytics.ts'),'@':root}},
   module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});
  compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();});
 });
 const cssRoot=process.env.PROFILE_UX_CSS_DIR||path.join(root,'.next/static/css');
 const css=fs.readdirSync(cssRoot).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(cssRoot,f),'utf8')).join('\n')+'\n:root{--font-geist-sans:Arial;--font-geist-mono:monospace}';
 const initialNow=Date.now();
 const offer={state:'active',offerId:'00000000-0000-4000-8000-000000000001',startsAt:new Date(initialNow-2*3600000).toISOString(),expiresAt:new Date(initialNow+22*3600000).toISOString(),serverNow:new Date(initialNow).toISOString(),amount:32000,originalAmount:39900};
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self';connect-src 'self';img-src 'self' data:;style-src 'self' 'unsafe-inline';script-src 'self'");
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(output,'fixture.js')));return;}
  if(url.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css; charset=utf-8');res.end(css);return;}
  if(url.pathname.startsWith('/api/')) {
   res.setHeader('Content-Type','application/json; charset=utf-8');
   if(url.pathname==='/api/dating/all-pass-offer'){res.end(JSON.stringify({userId:'return-member',offer:{...offer,serverNow:new Date().toISOString()}}));return;}
   res.writeHead(409);res.end(JSON.stringify({ok:false,message:'로컬 미리보기입니다. 실제 결제는 진행되지 않습니다.'}));return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><p style="font:12px sans-serif;text-align:center;padding:8px;background:#f5f5f5">로컬 미리보기 · 가상 회원 · 실제 결제 없음</p><div id="root"></div><script src="/fixture.js"></script></body></html>');
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));return {server,output,origin:'http://127.0.0.1:'+server.address().port};
}
module.exports={startPreview};
if(require.main===module)startPreview(Number(process.env.ALL_PASS_OFFER_PREVIEW_PORT||3143)).then(({origin})=>console.log(origin+'/community/dating/cards')).catch(e=>{console.error(e);process.exitCode=1;});
