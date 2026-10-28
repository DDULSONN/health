/* eslint-disable @typescript-eslint/no-require-imports */
// Loopback only. Actual UI/API/service with fake identities/storage; no live credentials.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),webpack=require('webpack');
const {fixture,id}=require('./fixtures/friend-recommendation-store.cjs');
async function start(port=0){const f=fixture(),out=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-friend-production-')),root=path.resolve(__dirname,'..');
  await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/friend-recommendation-browser.tsx'),output:{path:out,filename:'app.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':root,'next/link':path.join(__dirname,'fixtures/friend-recommendation-link.tsx')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});compiler.run((error,stats)=>{compiler.close(()=>{});error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve();});});
  const css=(await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process('@import "tailwindcss" source(none);\n@source "./components/dating/sharing";\n@source "./components/admin/AdminFriendSharesPanel.tsx";\n@source "./scripts/fixtures/friend-recommendation-browser.tsx";',{from:path.join(root,'friend-preview.css')})).css;
  const server=http.createServer(async(req,res)=>{try{const origin=`http://127.0.0.1:${server.address().port}`,url=new URL(req.url,origin);if(req.headers.host!==new URL(origin).host){res.writeHead(403);return res.end();}res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(out,'app.js')));}if(url.pathname==='/style.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
    if(url.pathname.startsWith('/api/')){
      const role=(req.headers.cookie||'').match(/fixture_role=(sender|recipient|target|admin|guest)/)?.[1]||'guest';f.state.viewer={sender:id(1),recipient:id(3),target:id(2),admin:id(4),guest:null}[role];f.state.admin=role==='admin';
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)throw Error('body too large');}
      const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(raw?{body:raw}:{})});let response;
      if(url.pathname==='/api/dating/friend-shares')response=await f.load('@/app/api/dating/friend-shares/route')[req.method](request);
      else if(url.pathname==='/api/admin/friend-shares')response=await f.load('@/app/api/admin/friend-shares/route')[req.method](request);
      else {const m=url.pathname.match(/^\/api\/dating\/friend-shares\/([^/]+)(?:\/photos\/([^/]+)\/([01])|(\/request))?$/);if(!m){res.writeHead(404);return res.end();}const route=m[2]?'@/app/api/dating/friend-shares/[token]/photos/[itemId]/[index]/route':m[4]?'@/app/api/dating/friend-shares/[token]/request/route':'@/app/api/dating/friend-shares/[token]/route';response=await f.load(route)[req.method](request,{params:Promise.resolve({token:m[1],itemId:m[2],index:m[3]})});}
      res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>');
  }catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));return{origin:`http://127.0.0.1:${server.address().port}`,fixture:f,close:()=>new Promise(resolve=>server.close(resolve)),output:out};
}
if(require.main===module)start(Number(process.argv[2]||3190)).then(s=>console.log('FRIEND_RECOMMENDATION_PREVIEW '+s.origin));
module.exports={start};
