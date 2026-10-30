/* eslint-disable @typescript-eslint/no-require-imports */
// Loopback-only preview of the real landing and signup UI. No env files or production calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const webpack = require('webpack');
const root = path.resolve(__dirname, '..');
async function startPreview(port = 0) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-landing-stories-'));
  const adapter = path.join(__dirname, 'fixtures/landing-stories-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false,
      entry: path.join(__dirname, 'fixtures/landing-stories-browser.tsx'),
      output: { path: output, filename: 'fixture.js' },
      plugins: [new webpack.DefinePlugin({ 'process.env.NEXT_PUBLIC_OPENKAKAO_URL': 'undefined', 'process.env.NEXT_PUBLIC_SITE_URL': JSON.stringify('http://127.0.0.1') })],
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
        'next/link': adapter, 'next/image': adapter, 'next/navigation': adapter,
        '@/lib/supabase/server': adapter, '@/lib/supabase/client': adapter, '@/lib/images': adapter, '@': root,
      } },
      module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs') },
        { test: /\.module\.css$/, use: path.join(__dirname, 'fixtures/landing-stories-css-loader.cjs') },
      ] },
    });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const css = (await require('postcss')([require('@tailwindcss/postcss')()]).process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css
    + '\n:root{--font-geist-sans:Arial;--font-geist-mono:monospace}\n'
    + fs.readFileSync(path.join(root, 'app/landing/LandingPage.module.css'), 'utf8');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET') { res.writeHead(405); res.end('Local preview: writes disabled'); return; }
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
    if (/^\/landing\/reviews\/review-\d{2}\.webp$/.test(url.pathname) || ['/icon-96x96.png', '/icon-192x192.png', '/landing/jimtool-store-hero.webp'].includes(url.pathname)) {
      const file = path.join(root, 'public', url.pathname);
      if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', url.pathname.endsWith('.webp') ? 'image/webp' : 'image/png'); res.end(fs.readFileSync(file)); return;
    }
    if (url.pathname.startsWith('/api/')) { res.writeHead(403); res.end('No live API in preview'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>짐툴 · 실제 후기 로컬 미리보기</title><link rel="stylesheet" href="/fixture.css"></head><body><aside style="padding:8px;text-align:center;font:11px sans-serif;color:#777;background:#fafafa">로컬 미리보기 · 실제 가입·결제 없음</aside><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, output, origin: 'http://127.0.0.1:' + server.address().port };
}
module.exports = { startPreview };
if (require.main === module) startPreview(Number(process.env.LANDING_STORIES_PREVIEW_PORT || 3197))
  .then(({ origin, output }) => console.log(JSON.stringify({ preview: origin + '/landing', output })))
  .catch(error => { console.error(error); process.exitCode = 1; });
