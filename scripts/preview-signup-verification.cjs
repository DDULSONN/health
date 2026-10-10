/* eslint-disable @typescript-eslint/no-require-imports */
// Local fake auth only. No production credentials, real signup, mail or SMS.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const webpack = require('webpack'), root = path.resolve(__dirname, '..');
async function startPreview(port = 0) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-signup-verification-'));
  const adapter = path.join(__dirname, 'fixtures/signup-verification-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false,
      entry: path.join(__dirname, 'fixtures/signup-verification-browser.tsx'),
      output: { path: output, filename: 'fixture.js', publicPath: '/' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { 'next/link': adapter, 'next/image': adapter, 'next/navigation': adapter, '@/lib/supabase/client': adapter, '@': root } },
      plugins: [new webpack.DefinePlugin({ 'process.env.NEXT_PUBLIC_SITE_URL': JSON.stringify('http://127.0.0.1') })],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs') }] },
    });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const cssRoot = process.env.PROFILE_UX_CSS_DIR || path.join(root, '.next/static/css');
  const css = fs.readdirSync(cssRoot).filter(p => p.endsWith('.css')).map(p => fs.readFileSync(path.join(cssRoot, p), 'utf8')).join('\n');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
    if (/^\/landing\/reviews\/review-\d{2}\.webp$/.test(url.pathname)) { res.setHeader('Content-Type', 'image/webp'); res.end(fs.readFileSync(path.join(root, 'public', url.pathname))); return; }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__fixture/')) {
      res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Tests must supply fake responses.' })); return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, output, origin: 'http://127.0.0.1:' + server.address().port };
}
module.exports = { startPreview };
