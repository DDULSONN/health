/* eslint-disable @typescript-eslint/no-require-imports */
// Builds the actual MyPage UI with local-only read fixtures. Never loads .env.
// Open /mypage?section=matching&fixture=populated|empty|error in a browser.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const webpack = require('webpack');
const root = path.resolve(__dirname, '..');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-mypage-navigation-'));
  const adapter = path.join(__dirname, 'fixtures/mypage-navigation-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false,
      entry: path.join(__dirname, 'fixtures/mypage-navigation-browser.tsx'),
      output: { path: output, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
        'next/link': adapter, 'next/image': adapter, 'next/navigation': adapter,
        '@/lib/supabase/client': adapter, '@': root,
      } },
      plugins: [new webpack.DefinePlugin({ 'process.env.NEXT_PUBLIC_OPENKAKAO_URL': 'undefined' })],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/,
        use: path.join(__dirname, 'fixtures/mypage-navigation-loader.cjs') }] },
    });
    compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true })));
      else resolve();
    });
  });
  const cssRoot = process.env.NAVIGATION_UX_CSS_DIR || path.join(root, '.next/static/css');
  const css = fs.existsSync(cssRoot) ? fs.readdirSync(cssRoot).filter(p => p.endsWith('.css'))
    .map(p => fs.readFileSync(path.join(cssRoot, p), 'utf8')).join('\n') : '';
  const now = new Date().toISOString();
  const openCard = { id: 'fixture-open', sex: 'female', display_nickname: '검증 오픈카드', age: 29,
    region: '서울', photo_visibility: 'public', status: 'public', applicant_count: 1,
    auto_requeue_count: 0, created_at: now, published_at: now,
    expires_at: new Date(Date.now() + 86400000).toISOString() };
  const profile = { id: 'fixture-one', name: '검증 프로필', sex: 'female', age: 29, birth_year: 1997,
    height_cm: 165, job: '회사원', region: '서울', intro_text: '반갑습니다. 로컬 검증용 프로필입니다.',
    strengths_text: '배려하는 편이에요.', preferred_partner_text: '대화가 잘 통하는 분', smoking: 'non_smoker',
    workout_frequency: '3_4', status: 'approved', created_at: now, photo_signed_urls: ['/fixture-photo.png'] };
  let failures = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') { res.writeHead(405); res.end('Fixture is read-only'); return; }
    const url = new URL(req.url, 'http://fixture.invalid');
    const populated = url.searchParams.get('fixture') === 'populated';
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (url.searchParams.get('fixture') === 'error' && url.pathname === '/api/dating/cards/my/received' && failures++ === 0) {
        res.statusCode = 503; res.end(JSON.stringify({ error: '검증용 조회 실패' })); return;
      }
      let body = { ok: true, items: [], cards: [], applications: [] };
      switch (url.pathname) {
        case '/api/mypage/summary': body = { profile: { email: 'fixture@example.invalid', nickname: '검증회원',
          nickname_changed_count: 0, nickname_change_credits: 0, phone_verified: true, swipe_profile_visible: true },
          account: { is_banned: false }, isAdmin: false, weekly_win_count: 0, bodycheck_posts: [] }; break;
        case '/api/dating/cards/my/received': body = { cards: populated ? [openCard] : [], applications: populated ? [{
          id: 'fixture-application', card_id: openCard.id, applicant_user_id: 'fixture-applicant',
          applicant_display_nickname: '검증 지원자', age: 30, height_cm: 178, region: '서울', job: '회사원',
          training_years: 2, intro_text: '실제 데이터가 아닌 검증용 지원서입니다.', status: 'submitted',
          created_at: now, instagram_id: null, photo_signed_urls: ['/fixture-photo.png'],
        }] : [] }; break;
        case '/api/dating/1on1/my': body = { items: populated ? [profile] : [] }; break;
        case '/api/dating/cards/write-enabled': body = { enabled: true }; break;
        case '/api/dating/apply-credits/status': body = { creditsRemaining: 5 }; break;
        case '/api/dating/cards/my/swipe-status': body = { outgoing_likes: [], incoming_likes: [], summary: { incoming_pending: 0, outgoing_pending: 0 } }; break;
      }
      res.end(JSON.stringify(body)); return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
    if (url.pathname === '/fixture-photo.png') { res.setHeader('Content-Type', 'image/png'); res.end(fs.readFileSync(path.join(root, 'public/icon-192x192.png'))); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
  });
  await new Promise(resolve => server.listen(Number(process.env.NAVIGATION_UX_PORT || 3115), '127.0.0.1', resolve));
  console.log(`Local UI fixture: http://127.0.0.1:${server.address().port}/mypage?section=matching&fixture=populated`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
