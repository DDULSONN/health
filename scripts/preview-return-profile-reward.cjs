/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated preview. No live service credentials or real reward grants.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const webpack = require('webpack');
const root = path.resolve(__dirname, '..');
async function startPreview(port = 0) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-return-reward-preview-'));
  const adapter = path.join(__dirname,'fixtures/return-reward-adapters.tsx');
  await new Promise((resolve,reject) => {
    const compiler = webpack({ mode: 'development', devtool: false,
      entry: path.join(__dirname,'fixtures/return-reward-browser.tsx'), output: { path: output, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx','.ts','.js'], alias: { 'next/link': adapter,'next/navigation': adapter,'@/lib/supabase/client': adapter,'@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname,'fixtures/profile-ux-loader.cjs') }] },
    });
    compiler.run((error,stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false,errors: true }))); else resolve(); });
  });
  const cssRoot = process.env.PROFILE_UX_CSS_DIR || path.join(root,'.next/static/css');
  const css = fs.readdirSync(cssRoot).filter(p=>p.endsWith('.css')).map(p=>fs.readFileSync(path.join(cssRoot,p),'utf8')).join('\n')+'\n:root{--font-geist-sans:Arial;--font-geist-mono:monospace}';
  const server = http.createServer((req,res) => {
    res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    const url = new URL(req.url,'http://localhost');
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type','text/javascript; charset=utf-8'); res.end(fs.readFileSync(path.join(output,'fixture.js'))); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type','text/css; charset=utf-8'); res.end(css); return; }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname !== '/api/return-profile-reward') { res.writeHead(404); res.end(); return; }
      const preview = new URL(req.headers.referer || 'http://localhost').searchParams.get('preview');
      const state = req.method === 'POST' || preview === 'rewarded' ? 'rewarded' : preview === 'ready' ? 'ready' : 'eligible';
      res.setHeader('Content-Type','application/json; charset=utf-8');
      res.end(JSON.stringify({ userId:'return-member', reward:{ campaignKey:'return-profile-2026-10',credits:5,state } })); return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><aside style="font:12px sans-serif;text-align:center;padding:8px;background:#f5f5f5">로컬 미리보기 · 가상 회원 · 실제 지급 없음</aside><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return { server,output,origin:'http://127.0.0.1:'+server.address().port };
}
module.exports={startPreview};
if(require.main===module) startPreview(Number(process.env.RETURN_REWARD_PREVIEW_PORT || 3142))
  .then(({origin,output})=>console.log(JSON.stringify({preview:origin+'/community/dating/cards',output})))
  .catch(error=>{console.error(error);process.exitCode=1;});
