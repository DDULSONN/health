/* eslint-disable @typescript-eslint/no-require-imports */
// Opt-in sandbox only. Never use a live key, production DB or real member identity.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),webpack=require('webpack');
const {runtime,load}=require('./fixtures/contact-checkout-runtime.cjs');
const root=path.resolve(__dirname,'..');
function sandboxProvider(envFile,mode='DEFAULT') {
  const env={};
  for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)) {
    const m=line.match(/^\s*TOSS_TEST_SECRET_KEY\s*=\s*(.*?)\s*$/);
    if(m)env.TOSS_TEST_SECRET_KEY=m[1].replace(/^(['"])(.*)\1$/,'$2');
  }
  if(!/^test_(?:g)?sk_/.test(env.TOSS_TEST_SECRET_KEY||''))throw Error('Explicit test secret required; live keys are forbidden');
  env.TOSS_CHECKOUT_MODE=mode;
  const calls=[],orders=new Set(),payments=new Set();
  const guardedFetch=async(url,init)=>{
    const u=new URL(url);if(u.origin!=='https://api.tosspayments.com')throw Error('Only Toss sandbox API is permitted');
    const decoded=Buffer.from(new Headers(init.headers).get('authorization').slice(6),'base64').toString();
    if(!decoded.startsWith('test_'))throw Error('Live credential blocked');
    const body=init.body?JSON.parse(init.body):null;
    if(init.method==='POST') {
      if(!['/v1/payments','/v1/payments/confirm'].includes(u.pathname))throw Error('Unexpected provider mutation');
      if(body.amount!==18000)throw Error('Sandbox amount must be 18000');
      if(u.pathname==='/v1/payments'){
        for(const field of ['successUrl','failUrl'])if(new URL(body[field]).hostname!=='127.0.0.1')throw Error('Production callback forbidden');
        if(body.customerEmail)throw Error('Do not transmit real user identity');
        orders.add(body.orderId);
      }else if(!orders.has(body.orderId))throw Error('Only current sandbox orders may be confirmed');
    }else if(init.method!=='GET')throw Error('Unexpected provider method');
    else if(![...orders].some(v=>u.pathname==='/v1/payments/orders/'+v)&&![...payments].some(v=>u.pathname==='/v1/payments/'+encodeURIComponent(v)))throw Error('Only current test payment reads permitted');
    const response=await fetch(url,{...init,signal:AbortSignal.timeout(15000)});
    const result=await response.clone().json().catch(()=>({}));
    if(result.paymentKey)payments.add(result.paymentKey);
    calls.push({path:u.pathname.replace(/\/orders\/.*/, '/orders/[test]').replace(/\/payments\/[^/]+$/,m=>m==='/payments/confirm'?m:'/payments/[test]'),method:init.method,status:response.status,providerState:result.status||null,code:result.code||null,amount:body?.amount||result.totalAmount||null});
    return response;
  };
  const api=load('lib/toss-payments.ts',{}, {process:{env},fetch:guardedFetch});
  return {...api,calls};
}
async function start({port=3161,envFile,mode='DEFAULT'}={}) {
  if(!envFile)throw Error('Use --sandbox-env with a local env file containing TOSS_TEST_SECRET_KEY');
  const provider=sandboxProvider(envFile,mode),f=await runtime({provider});
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-checkout-sandbox-'));
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/contact-checkout-browser.tsx'),output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],fallback:{crypto:false},alias:{'next/link':path.join(__dirname,'fixtures/profile-ux-adapters.tsx'),'next/navigation':path.join(__dirname,'fixtures/profile-ux-adapters.tsx'),'@':root}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});
    compiler.run((err,stats)=>{compiler.close(()=>{});if(err||stats.hasErrors())reject(err||Error(stats.toString({all:false,errors:true})));else resolve();});
  });
  const cssRoot=path.join(root,'.next/static/css');
  const css=fs.readdirSync(cssRoot).filter(v=>v.endsWith('.css')).map(v=>fs.readFileSync(path.join(cssRoot,v),'utf8')).join('\n');
  const server=http.createServer(async(req,res)=>{
    const origin=`http://127.0.0.1:${server.address().port}`;
    try {
      res.setHeader('Cache-Control','no-store');
      if(req.headers.host!==new URL(origin).host){res.statusCode=403;return res.end();}
      const url=new URL(req.url,origin);
      if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(output,'fixture.js')));}
      if(url.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
      if(url.pathname==='/test-evidence'){
        res.setHeader('Content-Type','application/json; charset=utf-8');
        const orders=(await f.db.query('select amount,status from toss_test_payment_orders')).rows;
        const matches=(await f.db.query('select state,contact_exchange_status from dating_1on1_match_proposals')).rows;
        return res.end(JSON.stringify({mode:'TEST_ONLY',productionDatabase:false,orders,matches,providerCalls:provider.calls}));
      }
      if(url.pathname.startsWith('/api/')){
        res.setHeader('Content-Type','application/json; charset=utf-8');
        let body='';for await(const chunk of req){body+=chunk;if(body.length>10000)throw Error('Body too large');}
        const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body}: {})});
        const routes=f.routes();let response;
        if(url.pathname==='/api/payments/toss/create'&&req.method==='POST')response=await routes.create(request);
        else if(url.pathname==='/api/payments/toss/confirm'&&req.method==='POST')response=await routes.confirm(request);
        else if(url.pathname==='/api/dating/1on1/matches/my'&&req.method==='GET')response=await routes.mine(request);
        else if(url.pathname==='/api/dating/1on1/contact-intro-offer')return res.end('{"offer":null}');
        else if(url.pathname==='/api/dating/1on1/contact-care/policy')return res.end('{"active":false}');
        else if(url.pathname.startsWith('/api/analytics/')){res.statusCode=204;return res.end();}
        else {res.statusCode=404;return res.end('{"error":"Not available in isolated test"}');}
        res.statusCode=response.status;for(const [key,value]of response.headers)res.setHeader(key,value);return res.end(await response.text());
      }
      res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><aside style="padding:12px;background:#fff3cd;text-align:center;font:13px sans-serif">토스 테스트 결제 · 실제 출금 없음 · 가상 회원/로컬 DB만 사용</aside><div id="root"></div><script src="/fixture.js"></script></body></html>');
    }catch(error){console.error('sandbox-request-failed',error.name);res.statusCode=500;res.end('{"error":"Isolated sandbox failure"}');}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {server,f,output,origin:`http://127.0.0.1:${server.address().port}`};
}
module.exports={start};
if(require.main===module){const i=process.argv.indexOf('--sandbox-env');start({envFile:i>=0?process.argv[i+1]:null,mode:process.env.CHECKOUT_TEST_MODE||'DEFAULT'}).then(({origin,output})=>console.log(JSON.stringify({origin,output,testMode:true,productionDatabase:false}))).catch(e=>{console.error(e.message);process.exitCode=1;});}
