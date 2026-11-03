/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated, loopback-only, synthetic database + simulated provider. No env files.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),webpack=require('webpack');
const {runtime,id}=require('./fixtures/contact-checkout-runtime.cjs');
async function start({port=3198}={}) {
  let f=await runtime({privateContact:true});
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-private-contact-'));
  const root=path.resolve(__dirname,'..');
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/private-contact-browser.tsx'),output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],fallback:{crypto:false},alias:{'next/link':path.join(__dirname,'fixtures/private-contact-adapters.tsx'),'next/navigation':path.join(__dirname,'fixtures/profile-ux-adapters.tsx'),'@':root}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});
    compiler.run((err,stats)=>{compiler.close(()=>{});if(err||stats.hasErrors())reject(err||Error(stats.toString({all:false,errors:true})));else resolve();});
  });
  const postcss=require('postcss'),tailwind=require('@tailwindcss/postcss');
  const css=(await postcss([tailwind()]).process('@import "tailwindcss"; @source "./scripts/fixtures/private-contact-browser.tsx"; @source "./components/dating/OneOnOnePrivateChat.tsx"; @source "./components/dating/OneOnOneContactOffer.tsx"; @source "./components/dating/OneOnOneExchangedContact.tsx"; body{margin:0;background:#fafafa;color:#171717;font-family:Arial,"Malgun Gothic",sans-serif} button,a,input,textarea{touch-action:manipulation} button{cursor:pointer}',{from:path.join(root,'private-preview.css')})).css;
  const server=http.createServer(async(req,res)=>{
    const origin=`http://127.0.0.1:${server.address().port}`;
    try {
      res.setHeader('Cache-Control','no-store');
      if(req.headers.host!==new URL(origin).host || (req.method==='POST'&&req.headers.origin!==origin)) {res.statusCode=403;return res.end();}
      const url=new URL(req.url,origin);
      if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(output,'fixture.js')));}
      if(url.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
      if(url.pathname.startsWith('/api/')) {
        res.setHeader('Content-Type','application/json; charset=utf-8');
        let body='';for await(const chunk of req){body+=chunk;if(body.length>16000)throw Error('Body too large');}
        if(url.pathname==='/api/preview/reset'&&req.method==='POST'){await f.db.close();f=await runtime({privateContact:true});return res.end('{"ok":true}');}
        const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body}:{})});
        const routes=f.routes(req.headers['x-preview-role']==='recipient'?id(2):id(1));let response;
        if(url.pathname==='/api/payments/toss/create'&&req.method==='POST')response=await routes.create(request);
        else if(url.pathname==='/api/payments/toss/confirm'&&req.method==='POST')response=await routes.confirm(request);
        else if(url.pathname==='/api/dating/1on1/matches/my'&&req.method==='GET')response=await routes.mine(request);
        else if(url.pathname==='/api/dating/1on1/private-chat'&&['GET','POST'].includes(req.method))response=await routes.privateChat[req.method](request);
        else if(url.pathname==='/api/dating/1on1/contact-intro-offer')return res.end('{"offer":null,"instagramContactAvailable":true}');
        else if(url.pathname==='/api/dating/1on1/contact-care/policy')return res.end('{"active":false}');
        else if(url.pathname.startsWith('/api/analytics/')){res.statusCode=204;return res.end();}
        else {res.statusCode=404;return res.end('{"error":"Not available in isolated preview"}');}
        res.statusCode=response.status;for(const [key,value]of response.headers)res.setHeader(key,value);return res.end(await response.text());
      }
      res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>짐툴 · 연락처 선택 미리보기</title><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
    }catch(error){console.error('private-preview-failed',error.message);res.statusCode=500;res.end('{"error":"Local preview failed"}');}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {server,origin:`http://127.0.0.1:${server.address().port}`,output};
}
module.exports={start};
if(require.main===module)start().then(info=>console.log(JSON.stringify({origin:info.origin,simulation:true,production:false}))).catch(e=>{console.error(e);process.exitCode=1;});
