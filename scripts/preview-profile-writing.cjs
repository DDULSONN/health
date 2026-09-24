/* eslint-disable @typescript-eslint/no-require-imports */
// Local fake-service host. No env credentials, real accounts, OTP, uploads or purchases.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const webpack = require('webpack');
const root = path.resolve(__dirname, '..');
async function startPreview(port = 0) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-writing-preview-'));
  const adapter = path.join(__dirname, 'fixtures/profile-ux-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false,
      entry: path.join(__dirname, 'fixtures/profile-writing-browser.tsx'),
      output: { path: output, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], fallback: { crypto: false }, alias: {
        'next/link': adapter, 'next/image': adapter, 'next/navigation': adapter,
        '@/lib/supabase/client': adapter, '@/components/DatingAdultNotice': adapter, '@': root,
      } },
      plugins: [new webpack.DefinePlugin({ 'process.env.NEXT_PUBLIC_OPENKAKAO_URL': 'undefined' })],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs') }] },
    });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const cssRoot = process.env.PROFILE_UX_CSS_DIR || path.join(root, '.next/static/css');
  // RootLayout normally defines these via next/font; retain its Korean system-font fallback locally.
  const css = fs.readdirSync(cssRoot).filter(p => p.endsWith('.css')).map(p => fs.readFileSync(path.join(cssRoot, p), 'utf8')).join('\n') + '\n:root{--font-geist-sans:Arial;--font-geist-mono:monospace}';
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/analytics/onboarding') { res.writeHead(204); res.end(); return; }
      if (req.method !== 'GET') { res.writeHead(405, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '로컬 미리보기에서는 실제 등록을 하지 않아요.' })); return; }
      let body = { ok: true, items: [], cards: [], applications: [], loggedIn: true };
      if (url.pathname === '/api/mypage/summary') body = { profile: { nickname: '테스트', phone_verified: true }, isAdmin: false };
      if (url.pathname === '/api/dating/1on1/write-status') body = { phoneVerified: true, canWrite: true, writeStatus: 'approved', activeRequestStatus: null };
      if (url.pathname === '/api/dating/cards/write-enabled') body = { enabled: true };
      if (url.pathname === '/api/dating/cards/queue-stats') body = { male: { public_count: 0, pending_count: 0, slot_limit: 45 }, female: { public_count: 0, pending_count: 0, slot_limit: 45 } };
      if (url.pathname === '/api/dating/cards/viewer-sex') body = { status: 'resolved', viewerSex: 'female', targetSex: 'male', source: 'metadata', canSwitchSex: false, requiresSexSelection: false };
      if (url.pathname === '/api/site/ad-inquiry') body = { enabled: false };
      res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><aside style="padding:8px 12px;background:#f5f5f5;color:#525252;font:12px sans-serif;text-align:center">로컬 미리보기 · 가상 회원 · 실제 등록/결제 없음</aside><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, output, origin: 'http://127.0.0.1:' + server.address().port };
}
module.exports = { startPreview };
if (require.main === module) startPreview(Number(process.env.PROFILE_WRITING_PREVIEW_PORT || 3138))
  .then(({ origin, output }) => console.log(JSON.stringify({ preview: origin + '/community/dating/cards?tab=one_on_one&preview=resume', output })))
  .catch(error => { console.error(error); process.exitCode = 1; });
