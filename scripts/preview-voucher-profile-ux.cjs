/* eslint-disable @typescript-eslint/no-require-imports */
// Loopback only. Synthetic read-only data; never loads .env or contacts a service.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), webpack = require('webpack');
const root = path.resolve(__dirname, '..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function start(port = Number(process.env.VOUCHER_PROFILE_PREVIEW_PORT || 3197)) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-voucher-profile-preview-'));
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'fixtures/voucher-profile-preview.tsx'),
      output: { path: output, filename: 'fixture.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
        '@': root, 'next/navigation': path.join(__dirname, 'fixtures/contact-care-navigation.ts'),
        'next/link': path.join(__dirname, 'fixtures/recommendation-refresh-adapters.tsx'),
      } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs') }] } });
    compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true })));
      else resolve();
    });
  });
  const cssRoot = process.env.CONTACT_CONVERSION_CSS_DIR || path.join(root, '.next/static/css');
  const css = fs.readdirSync(cssRoot).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssRoot, f), 'utf8')).join('\n');
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (body, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(fs.readFileSync(path.join(output, 'fixture.js'))); }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') return json({ error: '로컬 미리보기에서는 실제 교환권을 사용하거나 신청하지 않아요.' }, 403);
      if (url.pathname !== '/api/dating/1on1/contact-care') return json({ error: '미리보기에서 제공하지 않는 경로입니다.' }, 404);
      const view = new URL(req.headers.referer || 'http://127.0.0.1').searchParams.get('view');
      const remaining = view === 'apply' ? 0 : 2;
      if (url.searchParams.get('summary') === '1') return json({ remaining });
      return json({ active: true, claim: null, manual_remaining: remaining, manual_history: [],
        payments: [{ id: id(10), order_id: id(100), name: '예시 상대', exchanged_at: new Date(Date.now() - 48 * 3600000).toISOString() }],
        matches: remaining ? [{ id: id(20), name: '지윤' }, { id: id(21), name: '서연' }] : [] });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="ko"><title>짐툴 교환권·프로필 안내 미리보기</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}`, output };
}
module.exports = { start };
if (require.main === module) start().then(({ origin }) => console.log(`Local-only preview: ${origin}/?view=vouchers&care=1`)).catch(error => { console.error(error); process.exitCode = 1; });
