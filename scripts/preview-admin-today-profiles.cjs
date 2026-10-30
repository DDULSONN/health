/* eslint-disable @typescript-eslint/no-require-imports */
// Real administrator UI, synthetic local data only. No auth credentials or production requests.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const webpack = require('webpack');
const root = path.resolve(__dirname, '..');
async function startPreview(port = 0) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-admin-today-'));
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false,
      entry: path.join(__dirname, 'fixtures/admin-contact-review-browser.js'), output: { path: output, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/mypage-navigation-loader.cjs') }] },
    });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const css = (await require('postcss')([require('@tailwindcss/postcss')()]).process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css;
  const snapshot = { contentFingerprint: 'a'.repeat(64), findingsFingerprint: 'b'.repeat(64) };
  const items = Array.from({ length: 23 }, (_, index) => ({ sourceType: index < 20 ? 'open_card' : index === 20 ? 'paid_card' : 'one_on_one',
    cardId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, userId: `fixture-user-${index}`, displayName: `미리보기 회원 ${index + 1}`,
    age: 30, region: '서울', status: index === 22 ? 'hidden' : 'approved', createdAt: '2026-10-30T01:00:00Z',
    previewUrls: ['/fixture-photo.png', '/fixture-photo.png?second'], texts: { job: '회사원', strengths: '약속을 잘 지키고 상대의 이야기를 잘 들어요.', idealType: '편안하게 대화할 수 있는 분을 만나고 싶어요.' },
    suspicion_level: index % 5 ? 'clear' : 'medium', summary: index % 5 ? '일반 검수상 특이사항 없음 · 사진은 직접 확인해 주세요.' : '자기소개 내용 확인 필요',
    flags: index % 5 ? [] : ['소개글 확인'], confirmationSnapshot: snapshot, reviewNotSaved: true, confirmationCurrent: false,
  }));
  const calls = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'");
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(fs.readFileSync(path.join(output, 'fixture.js'))); }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
    if (url.pathname === '/fixture-photo.png') { res.setHeader('Content-Type', 'image/png'); return res.end(fs.readFileSync(path.join(root, 'public/icon-96x96.png'))); }
    if (url.pathname.startsWith('/api/')) {
      calls.push({ path: url.pathname, method: req.method, query: url.search });
      if (url.pathname === '/api/admin/dating/automatic-review' && req.method === 'GET') return json({ items: [], total: 0 });
      if (url.pathname !== '/api/admin/dating/card-ai-review') return json({ ok: false, message: 'Unexpected local API' }, 403);
      if (req.method === 'PATCH') {
        let input = ''; for await (const chunk of req) input += chunk;
        const body = JSON.parse(input), item = items.find(x => x.sourceType === body.sourceType && x.cardId === body.cardId);
        if (!item || !['confirm_normal', 'undo_confirmation'].includes(body.action)) return json({ ok: false, message: 'No live moderation in preview' }, 403);
        item.confirmationCurrent = body.action === 'confirm_normal'; item.reviewNotSaved = false;
        item.confirmationId = item.confirmationCurrent ? '00000000-0000-4000-8000-000000000090' : null;
        return json({ ok: true, sourceType: item.sourceType, cardId: item.cardId, confirmationId: item.confirmationId, message: item.confirmationCurrent ? '정상 확인 완료 (로컬)' : '정상 확인 취소 (로컬)' });
      }
      if (req.method !== 'GET') return json({ ok: false, message: 'No scan or production writes' }, 403);
      if (url.searchParams.get('view') !== 'today') return json({ ok: true, items: [] });
      const source = url.searchParams.get('source') || 'all';
      const filtered = items.filter(item => source === 'all' || item.sourceType === source);
      const offset = url.searchParams.get('cursor') === 'page-2' ? 20 : 0;
      const counts = {}; for (const item of filtered) counts[item.sourceType] = (counts[item.sourceType] || 0) + 1;
      return json({ ok: true, items: filtered.slice(offset, offset + 20), total: filtered.length, counts, day: '2026-10-30',
        cursor: offset ? 'page-2' : 'page-1', nextCursor: filtered.length > offset + 20 ? 'page-2' : null });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>오늘 신규 프로필 · 관리자 미리보기</title><link rel="stylesheet" href="/fixture.css"><aside style="padding:10px;text-align:center;font-size:12px;color:#666">로컬 미리보기 · 가상 프로필 · 운영 데이터 변경 없음</aside><div id="root"></div><script src="/fixture.js"></script></html>');
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, origin: 'http://127.0.0.1:' + server.address().port, output, calls };
}
module.exports = { startPreview };
if (require.main === module) startPreview(Number(process.env.ADMIN_TODAY_PREVIEW_PORT || 3200)).then(result => console.log(JSON.stringify({ preview: result.origin, output: result.output }))).catch(error => { console.error(error); process.exitCode = 1; });
