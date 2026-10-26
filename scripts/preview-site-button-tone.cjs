/* eslint-disable @typescript-eslint/no-require-imports */
// Real member pages; loopback synthetic API only. No env, credentials or external calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), webpack = require('webpack');
const root = path.resolve(__dirname, '..');
async function start({ port = 0 } = {}) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-button-tone-'));
  const adapter = path.join(__dirname, 'fixtures/recommendation-refresh-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'fixtures/site-button-tone-browser.tsx'),
      output: { path: output, filename: 'fixture.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], fallback: { crypto: false }, alias: {
        'next/link': adapter, 'next/image': adapter, 'next/navigation': adapter, '@/lib/supabase/client': adapter, '@/components/DatingAdultNotice': adapter, '@': root,
      } }, plugins: [new webpack.DefinePlugin({ 'process.env.NEXT_PUBLIC_OPENKAKAO_URL': 'undefined' })],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/mypage-navigation-loader.cjs') }] } });
    compiler.run((err, stats) => { compiler.close(() => {}); if (err || stats.hasErrors()) reject(err || Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const css = (await require('postcss')([require('@tailwindcss/postcss')({ base: root })]).process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css + '\n:root{--font-geist-sans:Arial;--font-geist-mono:monospace}';
  const stamp = new Date().toISOString(), writes = [], flags = { fail: false, archived: false };
  const profile = { id: 'fixture-one', user_id: 'fixture-member', name: '서연', sex: 'female', age: 29, birth_year: 1998, height_cm: 165,
    job: '회사원', region: '서울', intro_text: '퇴근 후 운동하고 주말에는 산책해요. 서로 편하게 이야기 나누고 싶어요.', strengths_text: '약속을 잘 지켜요.',
    preferred_partner_text: '대화가 잘 통하는 분', smoking: 'non_smoker', status: 'submitted', created_at: stamp, photo_signed_urls: ['/fixture-photo.svg', '/fixture-photo.svg'] };
  const peer = { ...profile, id: 'fixture-peer', user_id: 'peer-member', name: '지후', sex: 'male', height_cm: 178 };
  const card = { id: 'fixture-open', user_id: 'fixture-member', display_nickname: '서연', sex: 'female', age: 29, height_cm: 165, job: '회사원',
    region: '서울', training_years: 2, ideal_type: '다정한 분', strengths_text: '약속을 잘 지켜요.', instagram_id: 'preview_only',
    status: 'expired', applicant_count: 1, created_at: stamp, published_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-02T00:00:00Z', photo_visibility: 'blur' };
  const application = { id: 'fixture-application', card_id: card.id, applicant_display_nickname: '지후', age: 29, height_cm: 178, region: '서울', job: '회사원',
    training_years: 3, status: 'submitted', intro_text: '이야기를 나눠보고 싶어요. 주말에는 가볍게 산책하고 운동해요.', created_at: stamp, photo_signed_urls: ['/fixture-photo.svg', '/fixture-photo.svg'] };
  const match = { id: 'fixture-match', role: 'source', state: 'mutual_accepted', contact_exchange_status: 'approved', source_card_id: profile.id,
    source_user_id: profile.user_id, candidate_card_id: peer.id, candidate_user_id: peer.user_id, source_card: profile, candidate_card: peer, counterparty_card: peer,
    counterparty_phone: '010-0000-0000', created_at: stamp, updated_at: stamp, matched_at: stamp, contact_exchanged_at: stamp };
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (req.headers.host !== new URL(origin).host) { res.writeHead(403); return res.end(); }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    const url = new URL(req.url, origin);
    try {
      if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return res.end(fs.readFileSync(path.join(output, 'fixture.js'))); }
      if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css; charset=utf-8'); return res.end(css); }
      if (url.pathname === '/fixture-photo.svg') { res.setHeader('Content-Type', 'image/svg+xml'); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="300"><rect width="240" height="300" fill="#f5f5f4"/><text x="120" y="150" text-anchor="middle" font-size="20" fill="#737373">가상 프로필 사진</text></svg>'); }
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (req.method !== 'GET') {
          if (req.headers.origin && req.headers.origin !== origin) { res.statusCode = 403; return res.end('{}'); }
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 10000) throw Error('Body too large'); }
          writes.push({ method: req.method, path: url.pathname + url.search, body });
          if (url.pathname.startsWith('/api/analytics/')) { res.statusCode = 204; return res.end(); }
          if (url.pathname === '/api/dating/1on1/my' && req.method === 'DELETE' && !flags.fail) {
            flags.archived = true; return res.end(JSON.stringify({ ok: true, archived: true, message: '미리보기: 프로필 노출만 종료했습니다.' }));
          }
          res.statusCode = flags.fail ? 503 : 409;
          return res.end(JSON.stringify({ error: '로컬 미리보기에서는 실제 결제·저장을 하지 않아요.' }));
        }
        let body = { ok: true, items: [], cards: [], applications: [], loggedIn: true };
        switch (url.pathname) {
          case '/api/mypage/summary': body = { profile: { email: 'fixture@example.invalid', nickname: '서연', phone_verified: true, nickname_changed_count: 0, nickname_change_credits: 0, swipe_profile_visible: true }, account: { is_banned: false }, isAdmin: false, weekly_win_count: 0, bodycheck_posts: [] }; break;
          case '/api/dating/1on1/my': body = { items: [{ ...profile, status: flags.archived ? 'rejected' : 'submitted', archived: flags.archived }], plus: null }; break;
          case '/api/dating/1on1/write-status': body = { canWrite: false, phoneVerified: true, activeRequestStatus: 'submitted' }; break;
          case '/api/dating/1on1/matches/my': body = { items: [match] }; break;
          case '/api/dating/1on1/recommendations/my': body = { items: flags.archived ? [] : [{ source_card_id: profile.id, source_card_status: 'submitted', recommendations: [peer], admin_recommendations: [], favorite_candidates: [], refresh_limit: 1, refresh_remaining: 1, refresh_used_count: 0, can_refresh: true }] }; break;
          case '/api/dating/cards/my/received': body = { cards: [card], applications: [application] }; break;
          case '/api/dating/cards/my': body = { items: [card] }; break;
          case '/api/dating/paid/my/status': body = { card: null, checked_at: stamp }; break;
          case '/api/dating/cards/viewer-sex': body = { status: 'resolved', viewerSex: 'female', targetSex: 'male', canSwitchSex: false, requiresSexSelection: false }; break;
          case '/api/dating/cards/my/swipe-status': body = { can_dismiss_incoming: true, incoming_likes: [], outgoing_likes: [], summary: { incoming_pending: 0, outgoing_pending: 0, mutual_matches: 0 } }; break;
          case '/api/dating/cards/write-enabled': body = { enabled: true }; break;
          case '/api/dating/apply-credits/status': body = { creditsRemaining: 5 }; break;
          case '/api/dating/cards/queue-stats': body = { male: { public_count: 0, pending_count: 0, slot_limit: 45 }, female: { public_count: 0, pending_count: 0, slot_limit: 45 } }; break;
          case '/api/dating/all-pass-offer': body = { userId: 'fixture-member', offer: null }; break;
          case '/api/return-profile-reward': body = { reward: null }; break;
        }
        return res.end(JSON.stringify(body));
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>짐툴 버튼 스타일 · 로컬 미리보기</title><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
    } catch (error) { console.error(error.message); res.statusCode = 500; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, server, output, writes, flags, close: () => new Promise(resolve => server.close(resolve)) };
}
module.exports = { start };
if (require.main === module) start({ port: Number(process.argv[2] || 3176) }).then(value => console.log(JSON.stringify({ origin: value.origin, output: value.output })));
