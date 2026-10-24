/* eslint-disable @typescript-eslint/no-require-imports */
// Loopback-only preview: real components/handlers and local PostgreSQL, no credentials/providers.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),webpack=require('webpack');
const {runtime,id,read}=require('./fixtures/contact-nudge-read-runtime.cjs');
async function start({port=0}={}){
  const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-nudge-reply-'));
  const r=await runtime({names:{source:'지후',candidate:'서연'}});await r.db.exec(read('supabase/sql/dating_1on1_contact_nudge_replies.sql'));
  await r.db.exec(read('supabase/sql/dating_1on1_contact_greetings.sql'));
  // Synthetic row only: preview the new greeting while legacy preservation is tested separately.
  await r.db.exec("update dating_1on1_contact_nudges set preset_key='nice_to_meet',message_text='반가워요. 편하게 이야기 나눠보고 싶어요 🙂'");
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/contact-nudge-reply-browser.tsx'),output:{path:out,filename:'fixture.js'},
      resolve:{extensions:['.tsx','.ts','.js'],alias:{'next/link':path.join(__dirname,'fixtures/profile-ux-adapters.tsx'),'@':root}},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});
    compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();});
  });
  const css=(await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(read('app/globals.css'),{from:path.join(root,'app/globals.css')})).css;
  const flags={failReply:false,failAfterSave:false,delay:0};let replyPosts=0;
  const server=http.createServer(async(req,res)=>{
    const origin=`http://127.0.0.1:${server.address().port}`;
    try{
      res.setHeader('Cache-Control','no-store');
      if(req.headers.host!==new URL(origin).host){res.statusCode=403;return res.end();}
      const url=new URL(req.url,origin);
      if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(fs.readFileSync(path.join(out,'fixture.js')));}
      if(url.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css; charset=utf-8');return res.end(css);}
      if(url.pathname.startsWith('/api/')){
        res.setHeader('Content-Type','application/json; charset=utf-8');let response;
        if(url.pathname==='/api/preview/summary'){
          response=await r.routes(url.searchParams.get('role')==='sender'?id(1):id(2)).get(new Request(origin+'/my'));
        }else if([`/api/dating/1on1/matches/${id(10)}/nudge`,`/api/dating/1on1/matches/${id(10)}/nudge/reply`,`/api/dating/1on1/matches/${id(10)}/nudge/read`].includes(url.pathname)){
          if(req.method!=='POST'){res.statusCode=405;return res.end('{}');}
          let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)throw Error('Body too large');}
          const request=new Request(url,{method:'POST',headers:req.headers,body});
          const role=new URL(req.headers.referer||origin).searchParams.get('role');
          const routes=r.routes(role==='sender'?id(1):id(2));
          if(url.pathname.endsWith('/reply')){
            replyPosts++;if(flags.delay)await new Promise(resolve=>setTimeout(resolve,flags.delay));
            response=flags.failReply?Response.json({error:'전송을 확인하지 못했어요. 다시 시도해 주세요.'},{status:503}):await routes.reply(request,r.params);
            if(flags.failAfterSave)response=Response.json({error:'전송을 확인하지 못했어요. 다시 시도해 주세요.'},{status:503});
          }else response=await (url.pathname.endsWith('/read')?routes.post:routes.send)(request,r.params);
        }else if(url.pathname==='/api/dating/1on1/contact-intro-offer')return res.end('{"offer":null}');
        else if(url.pathname==='/api/dating/1on1/contact-care/policy')return res.end('{"active":false}');
        else if(url.pathname.startsWith('/api/analytics/')){res.statusCode=204;return res.end();}
        else{res.statusCode=404;return res.end('{}');}
        res.statusCode=response.status;return res.end(await response.text());
      }
      res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end('<!doctype html><html lang="ko" style="--font-geist-sans:Arial;--font-geist-mono:monospace"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>짐툴 · 한마디 답장 미리보기</title><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
    }catch(error){console.error('local-preview',error.message);res.statusCode=500;res.end('{"error":"Local preview failure"}');}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {r,server,flags,out,origin:`http://127.0.0.1:${server.address().port}`,replyPosts:()=>replyPosts,
    async reset(){await r.db.exec("delete from dating_1on1_contact_nudge_replies; update dating_1on1_match_proposals set state='mutual_accepted',contact_exchange_status='awaiting_applicant_payment',contact_exchange_paid_at=null");flags.failReply=false;flags.failAfterSave=false;flags.delay=0;replyPosts=0;},
    async close(){await new Promise(resolve=>server.close(resolve));await r.db.close();}};
}
module.exports={start};
if(require.main===module)start({port:Number(process.argv[2]||3174)}).then(v=>console.log(JSON.stringify({origin:v.origin,localDatabaseOnly:true,output:v.out}))).catch(e=>{console.error(e);process.exitCode=1;});
