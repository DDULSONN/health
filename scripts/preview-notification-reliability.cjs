/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated browser preview: actual React UI, synthetic reads and read acknowledgements only.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), webpack = require('webpack');
const root = path.resolve(__dirname, '..');
async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-notification-preview-'));
  const adapter = path.join(__dirname, 'fixtures/notification-reliability-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'fixtures/notification-reliability-browser.tsx'),
      output: { path: output, filename: 'fixture.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
        'next/link': adapter, 'next/navigation': adapter, '@/lib/supabase/client': adapter, '@': root,
      } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs') }] } });
    compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true })));
      else resolve();
    });
  });
  const cssDir = path.join(root, '.next/static/css');
  const css = fs.readdirSync(cssDir).filter(p => p.endsWith('.css')).map(p => fs.readFileSync(path.join(cssDir, p), 'utf8')).join('\n');
  const rows = new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      const scenario = new URL(req.headers.referer || 'http://localhost').searchParams.get('scenario') || 'normal';
      if (!rows.has(scenario)) rows.set(scenario, [
        { id: 'notice-1', title: '매칭 이름님이 1:1 요청을 보냈어요', body: '상대 프로필을 확인해 주세요.', link: '/dating/1on1', is_read: false },
        { id: 'notice-2', title: '지원이 취소됐습니다', body: '도착했던 지원이 취소되어 현재 지원자 목록에는 보이지 않습니다.', link: null, is_read: false },
      ].map(row => ({ ...row, created_at: '2026-10-05T01:30:00Z', actor_profile: null })));
      const items = rows.get(scenario);
      if (url.pathname === '/api/notifications' && req.method === 'PATCH') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        let body; try { body = JSON.parse(raw); } catch { body = {}; }
        // Intentional local delay verifies acknowledgement after inbox unmount.
        await new Promise(resolve => setTimeout(resolve, 350));
        if (scenario === 'read-error') { res.statusCode = 503; res.end('{"error":"가상 읽음 실패"}'); return; }
        for (const row of items) if (body.mark_all === true || body.id === row.id) row.is_read = true;
        res.end('{"ok":true}'); return;
      }
      if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return; }
      if (url.pathname === '/api/notifications') {
        if (scenario === 'count-error') { res.statusCode = 503; res.end('{"error":"가상 알림 수 조회 실패"}'); return; }
        res.end(JSON.stringify({ items, unread_count: items.filter(row => !row.is_read).length })); return;
      }
      if (url.pathname === '/api/admin/me') { res.end('{"isAdmin":false}'); return; }
      res.statusCode = 404; res.end('{}'); return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
  });
  await new Promise(resolve => server.listen(3157, '127.0.0.1', resolve));
  console.log('http://127.0.0.1:3157/notifications');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
