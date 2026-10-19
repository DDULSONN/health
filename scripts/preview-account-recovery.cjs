/* eslint-disable @typescript-eslint/no-require-imports */
// Every Auth operation is an isolated fixture: no real accounts, email, OTP or tokens.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), webpack = require('webpack');
async function startPreview(port = 0) {
  const root = path.resolve(__dirname, '..'), output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-account-recovery-'));
  const adapter = path.join(__dirname, 'fixtures/account-recovery-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'fixtures/account-recovery-browser.tsx'),
      output: { path: output, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { 'next/link': adapter, 'next/navigation': adapter, '@/lib/supabase/client': adapter, '@': root } },
      plugins: [new webpack.DefinePlugin({ 'process.env.NEXT_PUBLIC_SITE_URL': JSON.stringify('https://fixture.invalid') })],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs') }] },
    });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const cssDir = path.join(root, '.next/static/css');
  const css = fs.readdirSync(cssDir).filter(p => p.endsWith('.css')).map(p => fs.readFileSync(path.join(cssDir, p), 'utf8')).join('\n');
  const recoveryReads = new Map();
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    if (req.method !== 'GET') { res.writeHead(405); res.end('Fixture writes are disabled'); return; }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
    if (url.pathname.startsWith('/api/')) {
      const referrer = new URL(req.headers.referer || '/', 'http://localhost');
      const scenario = referrer.searchParams.get('scenario');
      const reads = (recoveryReads.get(referrer.href) || 0) + 1;
      recoveryReads.set(referrer.href, reads);
      const recovered = scenario === 'transient-session' && reads > 2;
      const rejected = scenario === 'mismatch-session';
      res.writeHead(recovered ? 200 : rejected ? 409 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(recovered ? { ok: true } : { ok: false, code: rejected ? 'RECOVERY_ACCOUNT_MISMATCH' : 'RECOVERY_CHECK_FAILED' })); return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><p style="text-align:center;font:12px sans-serif">로컬 검사 · 실제 로그인·메일·문자 발송 없음</p><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, origin: 'http://127.0.0.1:' + server.address().port, output };
}
module.exports = { startPreview };
if (require.main === module) startPreview(Number(process.env.ACCOUNT_RECOVERY_PREVIEW_PORT || 3148)).then(({ origin }) => console.log(origin + '/account-recovery'));
