/* eslint-disable @typescript-eslint/no-require-imports */
// Local-only in-memory preview. No credentials, database, payment or external calls.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),webpack=require('webpack');
const root=path.resolve(__dirname,'..'),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function main(){
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-care-preview-'));
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/contact-care-browser.tsx'),output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':root,'next/navigation':path.join(__dirname,'fixtures/contact-care-navigation.ts')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});
    compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();});
  });
  const cssRoot=process.env.CONTACT_CONVERSION_CSS_DIR||path.join(root,'.next/static/css');
  const css=fs.readdirSync(cssRoot).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(cssRoot,f),'utf8')).join('\n');
  const exchanged=new Date(Date.now()-48*3600000).toISOString();let claim=null,captures=[];
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const json=(body,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(body));};
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(output,'fixture.js')));return;}
      if(url.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
      if(url.pathname.endsWith('/evidence')){
        const file=captures[Number(url.searchParams.get('index'))];
        if(!file||url.searchParams.get('claimId')!==claim?.id)return json({error:'미리보기 캡처가 없습니다.'},404);
        res.setHeader('Content-Type',file.type);res.end(Buffer.from(await file.arrayBuffer()));return;
      }
      if(url.pathname.startsWith('/api/')){
        if(url.pathname==='/api/dating/1on1/contact-care/policy')return json({active:true,startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+48*3600000).toISOString()});
        if(!['/api/admin/contact-care','/api/dating/1on1/contact-care'].includes(url.pathname))return json({error:'실제 API는 이 미리보기에서 호출하지 않습니다.'},403);
        if(req.method==='POST'){
          const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>3500000)return json({error:'캡처는 합계 3MB 이하로 선택해 주세요.'},400);parts.push(part);}
          const bytes=Buffer.concat(parts);let body,form;
          if(req.headers['content-type']?.startsWith('multipart/form-data')){form=await new Response(bytes,{headers:{'content-type':req.headers['content-type']}}).formData();body=JSON.parse(form.get('payload'));}
          else body=JSON.parse(bytes.toString());
          if(url.pathname.startsWith('/api/admin')){
            if(body.action==='cleanup')return json({ok:true,removed:0});
            if(!claim||body.claimId!==claim.id)return json({error:'신청을 먼저 접수하세요.'},409);
            claim={...claim,status:body.decision,review_note:body.note,supplement_due_at:body.decision==='needs_info'?new Date(Date.now()+72*3600000).toISOString():null};
          }else if(body.action==='apply'){
            if(body.reason==='no_response'&&Date.parse(body.firstContactAt)>Date.now()-24*3600000)return json({error:'무응답 신청은 첫 연락 후 24시간이 지나야 가능해요.'},409);
            if(Date.parse(body.firstContactAt)<Date.parse(exchanged))return json({error:'번호교환 이후 연락한 시각을 입력해 주세요.'},409);
            captures=form.getAll('evidence');claim={id:id(500),user_id:id(1),match_id:id(10),order_id:id(100),reason:body.reason,first_contact_at:body.firstContactAt,explanation:body.explanation,status:'pending',created_at:new Date().toISOString(),review_note:null,evidence_count:captures.length,supplement_due_at:null,used_at:null,used_match_id:null};
          }else if(claim?.status==='approved'){claim={...claim,used_at:new Date().toISOString(),used_match_id:id(20)};}
          else return json({error:'먼저 관리자 화면에서 승인해 주세요.'},409);
          return json({ok:true});
        }
        if(url.pathname.startsWith('/api/admin'))return json({items:claim&&['pending','needs_info'].includes(claim.status)?[{...claim,nickname:'미리보기 회원',counterparty_name:'예시 상대',exchanged_at:exchanged}]:[],next:null});
        return json({active:true,starts_at:new Date(Date.now()-3600000).toISOString(),claim,payments:!claim||['rejected','needs_info'].includes(claim.status)?[{id:id(10),name:'예시 상대',order_id:id(100),exchanged_at:exchanged}]:[],matches:claim?.status==='approved'&&!claim.used_at?[{id:id(20),name:'다음 예시 상대'}]:[]});
      }
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><title>짐툴 연락처 교환 지원 · 로컬 미리보기</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
    }catch{json({error:'미리보기 입력을 확인해 주세요.'},400);}
  });
  const port=Number(process.env.CONTACT_CARE_PREVIEW_PORT||3182);
  server.listen(port,'127.0.0.1',()=>console.log(`Local mock preview: http://127.0.0.1:${port} — no real claims, payments or grants`));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
