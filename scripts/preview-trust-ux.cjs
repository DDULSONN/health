/* eslint-disable @typescript-eslint/no-require-imports */
// Loopback-only, synthetic fixtures. No env files, external services or real mutations.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), webpack = require('webpack');
const root = path.resolve(__dirname, '..');
async function startPreview(port = 0) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-trust-ux-'));
  const adapter = path.join(__dirname, 'fixtures/recommendation-refresh-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'fixtures/trust-ux-browser.tsx'),
      output: { path: output, filename: 'fixture.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], fallback: { crypto: false }, alias: {
        'next/link': adapter, 'next/navigation': adapter, '@/lib/supabase/client': adapter, '@': root,
      } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs') }] } });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const css = (await require('postcss')([require('@tailwindcss/postcss')()]).process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css + '\n:root{--font-geist-sans:Arial;--font-geist-mono:monospace}';
  const writes = [];
  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(fs.readFileSync(path.join(output, 'fixture.js'))); }
      if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
      if (url.pathname === '/fixture-photo.svg') { res.setHeader('Content-Type', 'image/svg+xml'); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="300"><rect width="240" height="300" fill="#f5f5f4"/><text x="120" y="150" text-anchor="middle" font-size="20" fill="#737373">미리보기 사진</text></svg>'); }
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (req.method !== 'GET') {
          let body = ''; for await (const chunk of req) body += chunk;
          writes.push({ path: url.pathname, body });
          if (url.pathname === '/api/dating/user-reports') {
            const input = JSON.parse(body), blocked = !String(input.detail || '').includes('차단실패');
            return res.end(JSON.stringify({ ok: true, blocked, blocked_user_id: '00000000-0000-4000-8000-000000000020', blocked_card_id: input.target_id,
              message: blocked ? '신고가 접수됐습니다. 상대 회원을 차단했습니다.' : '신고는 접수됐지만 차단하지 못했습니다. 다시 시도해 주세요.' }));
          }
          if (url.pathname.startsWith('/api/analytics/')) { res.statusCode = 204; return res.end(); }
          res.statusCode = 405; return res.end(JSON.stringify({ error: '로컬 미리보기에서는 실제 저장·결제를 하지 않아요.' }));
        }
        let body = { ok: true, items: [] };
        if (url.pathname === '/api/dating/1on1/contact-intro-offer') body = { offer: null };
        if (url.pathname === '/api/dating/all-pass-offer') body = { userId: 'fixture-member', offer: null };
        if (url.pathname === '/api/dating/cards/write-enabled') body = { enabled: true };
        if (url.pathname === '/api/dating/cards/my') body = { items: [{ id: '00000000-0000-4000-8000-000000000001', sex: 'female', age: 29, region: '경기 수원', height_cm: 165, job: 'IT 서비스 개발자', training_years: 2,
          ideal_type: '다정한 분', strengths_text: '약속을 잘 지켜요.', instagram_id: 'fixture.test', photo_visibility: 'blur', status: 'pending',
          photo_paths: ['cards/fixture/raw/old-0.webp', 'cards/fixture/raw/old-1.webp'], blur_paths: ['cards/fixture/blur/old-0.webp', 'cards/fixture/blur/old-1.webp'],
          blur_thumb_path: 'cards/fixture/blur/old-0.webp', photo_preview_urls: ['/fixture-photo.svg', '/fixture-photo.svg'] }] };
        return res.end(JSON.stringify(body));
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><aside style="padding:10px;text-align:center;font:12px sans-serif;color:#737373">로컬 미리보기 · 가상 회원 · 실제 등록·결제·신고 없음</aside><div id="root"></div><script src="/fixture.js"></script></body></html>');
    } catch { res.statusCode = 500; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, output, writes, origin: `http://127.0.0.1:${server.address().port}` };
}
module.exports = { startPreview };
if (require.main === module) startPreview(Number(process.env.TRUST_UX_PREVIEW_PORT || 3160)).then(({ origin, output }) => console.log(JSON.stringify({ origin, output })));
