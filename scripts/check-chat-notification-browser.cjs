/* eslint-disable @typescript-eslint/no-require-imports */
// Actual React screens. Synthetic identities, local APIs only; never touches live chats.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const webpack = require('webpack');
const root = path.resolve(__dirname, '..');
const runtime = process.env.CODEX_NODE_PACKAGES || 'C:/Users/DDULSONN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(path.join(runtime, 'playwright'));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const bubble = (page, content) => page.locator('p.whitespace-pre-wrap.break-words').filter({ hasText: new RegExp('^' + content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') });
const time = '2026-09-27T00:00:00Z';
const message = (id, text) => ({ id: id + '-' + text, thread_id: id, sender_id: 'peer-' + id, receiver_id: 'fixture-member', content: text, is_read: false, created_at: time });
const detail = (id, text = '대화 ' + id) => ({ ok: true, thread: { id, source_kind: 'open', source_id: 'source-' + id,
  current_user_id: 'fixture-member', user_a_id: 'fixture-member', user_b_id: 'peer-' + id,
  user_a_nickname: '테스트', user_b_nickname: id + '회원', status: 'open', created_at: time }, messages: [message(id, text)] });
const inbox = ['A', 'B'].map(id => ({ thread_id: id, source_kind: 'open', source_id: 'source-' + id,
  peer_user_id: 'peer-' + id, peer_nickname: id + '회원', status: 'open', unread_count: 1,
  last_message: '목록 미리보기', last_message_at: time, created_at: time }));
const notification = { id: 'notice-1', actor_id: 'peer', type: 'dating_application_received', post_id: null,
  is_read: false, created_at: time, actor_profile: { nickname: '검증회원' }, title: '한글 매칭 알림', body: '한글 안내 내용입니다.', link: '/mypage?section=matching#open-card-received' };
const profile = name => ({ ok: true, profile: { name, age: 29, region: '서울', height_cm: 175, job: '회사원', training_years: 2,
  intro_text: '서로 배려하면서 편하게 이야기하고 싶어요.', strengths_text: '잘 웃고 이야기를 잘 들어요.', ideal_type: '다정한 사람', photo_urls: [] } });
const history = Array.from({ length: 125 }, (_, i) => ({ ...message('A', '지난 대화 ' + i), id: 'history-' + String(i).padStart(3, '0'), created_at: new Date(Date.parse(time) + i * 1000).toISOString() }));
const pageOf = (rows, more) => ({ ...detail('A'), messages: rows, pagination: { older_cursor: rows[0]?.id ?? null, has_more: more } });
async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-chat-notification-browser-'));
  console.log('Browser artifacts: ' + output);
  const adapter = path.join(__dirname, 'fixtures/chat-notification-adapters.tsx');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'fixtures/chat-notification-browser.tsx'),
      output: { path: output, filename: 'fixture.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
        'next/link': adapter, 'next/navigation': adapter, '@/lib/supabase/client': adapter, '@': root,
      } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs') }] } });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const cssRoot = path.join(root, '.next/static/css');
  const css = fs.readdirSync(cssRoot).filter(n => n.endsWith('.css')).map(n => fs.readFileSync(path.join(cssRoot, n), 'utf8')).join('\n') + '\n:root{--font-geist-sans:Arial;--font-geist-mono:monospace}';
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); }
    else if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else if (req.url.startsWith('/api/')) { res.writeHead(500); res.end('Unmocked local request'); }
    else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser, passed = 0;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    async function run(label, width, scenario, options = {}) {
      const context = await browser.newContext({ viewport: { width, height: 844 } }), page = await context.newPage();
      const errors = [], requests = [], alerts = [], routeErrors = [];
      page.setDefaultTimeout(10000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', async d => { alerts.push(d.message()); await d.accept(); });
      await context.addInitScript(opts => { window.fixtureIgnoreAbort = !!opts.ignoreAbort; window.fixtureFastTimeout = !!opts.fastTimeout; }, options);
      let handler = async () => false;
      await context.route('**/*', async route => {
        try {
          const req = route.request(), url = new URL(req.url());
          assert.equal(url.origin, origin, 'production request prohibited');
          if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
          requests.push({ path: url.pathname, method: req.method(), body: req.postData() ? JSON.parse(req.postData()) : null });
          if (await handler(route, url, req)) return;
          let body = { ok: true };
          if (url.pathname === '/api/dating/chat/inbox') body = { ok: true, items: inbox, unreadCount: 2 };
          else if (url.pathname === '/api/dating/chat/available') body = { ok: true, items: [{ sourceKind: 'open', sourceId: 'source-C', peerUserId: 'peer-C', peerNickname: 'C회원', title: '새 연결', createdAt: time }] };
          else if (url.pathname === '/api/dating/chat/thread') body = detail(url.searchParams.get('thread_id'));
          else if (url.pathname === '/api/dating/chat/read') assert.equal(req.method(), 'POST');
          else if (url.pathname === '/api/notifications') body = req.method() === 'GET' ? { items: [notification], unread_count: 1 } : { ok: true };
          else throw Error('unexpected API: ' + url.pathname);
          await route.fulfill({ json: body });
        } catch (error) { if (!context.pages().length) return; routeErrors.push(error.message); await route.abort().catch(() => {}); }
      });
      try {
        await scenario({ page, requests, alerts, context, setHandler: fn => { handler = fn; } });
        assert.deepEqual(errors, [], label); assert.deepEqual(routeErrors, [], label);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
        passed++; console.log('PASS ' + width + ' ' + label);
      } catch (error) { await page.screenshot({ path: path.join(output, 'FAIL-' + width + '-' + label + '.png'), fullPage: true }); throw error; }
      finally { await context.close(); }
    }
    for (const width of [360, 1280]) {
      for (const variant of ['late-success', 'late-404', 'late-failure', 'a-b-a']) await run(variant, width, async ({ page, requests, setHandler }) => {
        const slow = gate(), started = gate(), finished = gate(); let hold = true;
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/dating/chat/thread' || url.searchParams.get('thread_id') !== 'A') return false;
          if (!hold) { await route.fulfill({ json: detail('A', '새 A 대화') }); return true; }
          started.resolve(); await slow.promise;
          await route.fulfill({ status: variant === 'late-404' ? 404 : variant === 'late-failure' ? 503 : 200, json: detail('A', '오래된 A 응답') }); finished.resolve(); return true;
        });
        await page.goto(origin + '/chat'); await started.promise;
        await page.getByRole('button', { name: /B회원/ }).click(); await bubble(page, '대화 B').waitFor();
        if (variant === 'a-b-a') { hold = false; await page.getByRole('button', { name: /A회원/ }).click(); await bubble(page, '새 A 대화').waitFor(); }
        slow.resolve(); await finished.promise; await page.waitForLoadState('networkidle');
        assert.equal(await bubble(page, '오래된 A 응답').count(), 0);
        assert.equal(await page.getByRole('button', { name: '대화 다시 불러오기' }).count(), 0);
        assert.ok(await bubble(page, variant === 'a-b-a' ? '새 A 대화' : '대화 B').isVisible());
        if (variant !== 'a-b-a') assert.equal(requests.filter(r => r.path.endsWith('/read') && r.body.thread_id === 'A').length, 0);
      }, { ignoreAbort: true });

      for (const variant of ['503', 'invalid', 'timeout']) await run('chat-' + variant, width, async ({ page, setHandler }) => {
        let recovered = false; const slow = gate();
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/dating/chat/thread' || recovered) return false;
          if (variant === 'timeout') { await slow.promise; await route.abort(); return true; }
          await route.fulfill({ status: variant === '503' ? 503 : 200, json: variant === 'invalid' ? detail('wrong-room') : { message: '조회 실패 테스트' } }); return true;
        });
        await page.goto(origin + '/chat'); await page.getByRole('button', { name: '대화 다시 불러오기' }).waitFor();
        await page.getByPlaceholder('메시지를 입력해 주세요').fill('잘못된 방에는 보내지 않음');
        assert.equal(await page.getByRole('button', { name: '보내기', exact: true }).isEnabled(), false);
        await page.screenshot({ path: path.join(output, 'chat-error-' + width + '.png'), fullPage: true, animations: 'disabled' });
        recovered = true; slow.resolve(); await page.getByRole('button', { name: '대화 다시 불러오기' }).click();
        await bubble(page, '대화 A').waitFor();
        assert.equal(await page.getByRole('button', { name: '보내기', exact: true }).isEnabled(), true);
      }, { fastTimeout: true });

      await run('late-realtime', width, async ({ page, requests }) => {
        await page.goto(origin + '/chat'); await bubble(page, '대화 A').waitFor();
        await page.getByRole('button', { name: /B회원/ }).click(); await bubble(page, '대화 B').waitFor();
        const before = requests.filter(r => r.path.endsWith('/read') && r.body.thread_id === 'A').length;
        await page.evaluate(row => window.fixtureEmit('INSERT', 'A', row, true), message('A', '늦은 실시간 A'));
        await page.evaluate(() => window.fixtureEmit('UPDATE', 'A', { id: 'A', status: 'closed' }, true));
        assert.equal(await bubble(page, '늦은 실시간 A').count(), 0);
        assert.equal(requests.filter(r => r.path.endsWith('/read') && r.body.thread_id === 'A').length, before);
        await page.getByPlaceholder('메시지를 입력해 주세요').fill('B 메시지');
        assert.equal(await page.getByRole('button', { name: '보내기', exact: true }).isEnabled(), true);
      });

      for (const variant of ['send-failure', 'new-thread']) await run(variant, width, async ({ page, requests, alerts, setHandler }) => {
        const slow = gate(), started = gate();
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/dating/chat/send') return false;
          started.resolve(); await slow.promise;
          await route.fulfill({ status: variant === 'send-failure' ? 503 : 200, json: variant === 'send-failure' ? { message: 'A 전송 실패' } : { ok: true, thread_id: 'C', message_id: 'C-new', created_at: time } }); return true;
        });
        await page.goto(origin + '/chat'); await bubble(page, '대화 A').waitFor();
        if (variant === 'new-thread') await page.getByRole('button', { name: /C회원/ }).click();
        await page.getByPlaceholder('메시지를 입력해 주세요').fill('첫 메시지'); await page.getByRole('button', { name: '보내기', exact: true }).click(); await started.promise;
        await page.getByRole('button', { name: /B회원/ }).click(); await bubble(page, '대화 B').waitFor();
        await page.getByPlaceholder('메시지를 입력해 주세요').fill('B에서 작성 중'); slow.resolve(); await page.waitForLoadState('networkidle');
        assert.equal(await page.getByPlaceholder('메시지를 입력해 주세요').inputValue(), 'B에서 작성 중');
        assert.ok(await bubble(page, '대화 B').isVisible());
        const sends = requests.filter(r => r.path.endsWith('/send')); assert.equal(sends.length, 1);
        assert.deepEqual(sends[0].body, variant === 'send-failure' ? { thread_id: 'A', content: '첫 메시지' } : { source_kind: 'open', source_id: 'source-C', content: '첫 메시지' });
        if (variant === 'send-failure') assert.deepEqual(alerts, ['A 전송 실패']);
      });

      await run('current-send-success', width, async ({ page, requests, setHandler }) => {
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/dating/chat/send') return false;
          await route.fulfill({ json: { ok: true, thread_id: 'A', message_id: 'A-sent', created_at: time } }); return true;
        });
        await page.goto(origin + '/chat'); await bubble(page, '대화 A').waitFor();
        await page.getByPlaceholder('메시지를 입력해 주세요').fill('안녕하세요 테스트');
        await page.getByRole('button', { name: '보내기', exact: true }).click(); await page.waitForLoadState('networkidle');
        assert.equal(await bubble(page, '안녕하세요 테스트').count(), 1);
        assert.equal(await page.getByPlaceholder('메시지를 입력해 주세요').inputValue(), '');
        assert.equal(requests.filter(r => r.path.endsWith('/send')).length, 1);
      });
      await run('closed-status-refresh', width, async ({ page, setHandler }) => {
        let closed = false;
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/dating/chat/thread' || !closed) return false;
          const body = detail('A'); body.thread.status = 'closed'; await route.fulfill({ json: body }); return true;
        });
        await page.goto(origin + '/chat'); await bubble(page, '대화 A').waitFor();
        closed = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.getByText('이 채팅방은 종료되어 더 이상 메시지를 보낼 수 없습니다.', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '보내기', exact: true }).isEnabled(), false);
      });
      await run('chat-unmount-late', width, async ({ page, requests, setHandler }) => {
        const slow = gate(), started = gate();
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/dating/chat/thread') return false;
          started.resolve(); await slow.promise; await route.fulfill({ json: detail('A') }); return true;
        });
        await page.goto(origin + '/chat'); await started.promise;
        await page.evaluate(() => window.fixtureUnmount()); slow.resolve(); await page.waitForLoadState('networkidle');
        assert.equal(requests.filter(r => r.path.endsWith('/read')).length, 0);
        assert.equal(await page.locator('#root').innerHTML(), '');
      }, { ignoreAbort: true });
      for (const action of ['leave', 'report']) await run('late-' + action, width, async ({ page, requests, setHandler }) => {
        const slow = gate(), started = gate(); let removed = false;
        setHandler(async (route, url) => {
          if (url.pathname === '/api/dating/chat/inbox' && removed) { await route.fulfill({ json: { ok: true, items: inbox.filter(item => item.thread_id !== 'A') } }); return true; }
          if (url.pathname !== '/api/dating/chat/' + action) return false;
          started.resolve(); await slow.promise; removed = action === 'leave'; await route.fulfill({ json: { ok: true } }); return true;
        });
        await page.goto(origin + '/chat'); await bubble(page, '대화 A').waitFor();
        if (action === 'report') {
          await page.getByRole('button', { name: /문제가 있으면 신고하기/ }).click();
          await page.getByRole('button', { name: '신고 접수', exact: true }).click();
        } else await page.getByRole('button', { name: '나가기', exact: true }).click();
        await started.promise; await page.getByRole('button', { name: /B회원/ }).click(); await bubble(page, '대화 B').waitFor();
        slow.resolve(); await page.waitForLoadState('networkidle'); assert.ok(await bubble(page, '대화 B').isVisible());
        const calls = requests.filter(r => r.path.endsWith('/' + action)); assert.equal(calls.length, 1); assert.equal(calls[0].body.thread_id, 'A');
      });

      for (const variant of ['503', 'network', 'malformed']) await run('notifications-' + variant, width, async ({ page, setHandler }) => {
        let recover = false;
        setHandler(async (route, url, req) => {
          if (url.pathname !== '/api/notifications' || req.method() !== 'GET' || recover) return false;
          if (variant === 'network') await route.abort();
          else await route.fulfill({ status: variant === '503' ? 503 : 200, json: {} }); return true;
        });
        await page.goto(origin + '/notifications'); await page.getByRole('button', { name: '다시 시도', exact: true }).waitFor();
        assert.equal(await page.getByText('새 알림이 없습니다.', { exact: true }).count(), 0);
        assert.equal(await page.getByText('읽지 않은 알림 0개', { exact: true }).count(), 0);
        recover = true; await page.getByRole('button', { name: '다시 시도', exact: true }).click();
        await page.getByText('한글 매칭 알림', { exact: true }).waitFor();
      });
      await run('notifications-retain-retry', width, async ({ page, setHandler }) => {
        let fail = false;
        setHandler(async (route, url, req) => {
          if (url.pathname === '/api/notifications' && req.method() === 'GET' && fail) { await route.fulfill({ status: 503, json: {} }); return true; }
          return false;
        });
        await page.goto(origin + '/notifications'); await page.getByText('한글 매칭 알림', { exact: true }).waitFor();
        fail = true; await page.getByRole('button', { name: '새로고침', exact: true }).click();
        await page.getByText('아래는 마지막으로 불러온 알림입니다.', { exact: true }).waitFor();
        assert.ok(await page.getByText('한글 매칭 알림', { exact: true }).isVisible());
        assert.ok(await page.getByText('읽지 않은 알림 1개', { exact: true }).isVisible());
        await page.screenshot({ path: path.join(output, 'notification-error-' + width + '.png'), fullPage: true });
        fail = false; await page.getByRole('button', { name: '다시 시도', exact: true }).click();
        await page.getByRole('alert').waitFor({ state: 'detached' });
      });
      await run('notification-open-without-read-wait', width, async ({ page, requests, setHandler }) => {
        const slow = gate(), started = gate();
        setHandler(async (route, url, req) => {
          if (url.pathname !== '/api/notifications' || req.method() !== 'PATCH') return false;
          started.resolve(); await slow.promise; await route.fulfill({ status: 503, json: {} }); return true;
        });
        await page.goto(origin + '/notifications'); await page.getByRole('button', { name: /한글 매칭 알림/ }).click();
        await started.promise; assert.ok(page.url().includes('/mypage?section=matching#open-card-received'));
        slow.resolve(); await page.getByText('읽음 처리 결과를 확인하지 못했어요. 알림 내용은 계속 확인할 수 있어요.', { exact: true }).waitFor();
        assert.ok(await page.getByText('읽지 않은 알림 1개', { exact: true }).isVisible());
        assert.equal((await page.evaluate(() => window.fixtureNavigations)).length, 1);
        assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
      });
      await run('notifications-mark-all-once', width, async ({ page, requests, setHandler }) => {
        let fail = true; const slow = gate();
        setHandler(async (route, url, req) => {
          if (url.pathname !== '/api/notifications' || req.method() !== 'PATCH') return false;
          await slow.promise; await route.fulfill({ status: fail ? 503 : 200, json: fail ? {} : { ok: true } }); return true;
        });
        await page.goto(origin + '/notifications'); const all = page.getByRole('button', { name: '모두 읽음', exact: true }); await page.getByText('한글 매칭 알림', { exact: true }).waitFor();
        await all.evaluate(el => { el.click(); el.click(); }); slow.resolve();
        await page.getByRole('alert').waitFor(); assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
        assert.ok(await page.getByText('읽지 않은 알림 1개', { exact: true }).isVisible());
        fail = false; await all.click(); await page.getByText('읽지 않은 알림 0개', { exact: true }).waitFor();
        assert.equal(requests.filter(r => r.method === 'PATCH').length, 2);
        await page.getByRole('button', { name: /한글 매칭 알림/ }).click();
        assert.equal(requests.filter(r => r.method === 'PATCH').length, 2, 'read notification must not PATCH again');
      });
      await run('notifications-empty-success', width, async ({ page, setHandler }) => {
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/notifications') return false;
          await route.fulfill({ json: { items: [], unread_count: 0 } }); return true;
        });
        await page.goto(origin + '/notifications'); await page.getByText('새 알림이 없습니다.', { exact: true }).waitFor();
        assert.equal(await page.getByRole('alert').count(), 0);
      });
      for (const variant of ['once', 'timeout', 'unmount']) await run('notification-read-' + variant, width, async ({ page, requests, setHandler }) => {
        const slow = gate(), started = gate();
        setHandler(async (route, url, req) => {
          if (url.pathname !== '/api/notifications') return false;
          if (req.method() === 'GET') { await route.fulfill({ json: { items: [{ ...notification, link: null }], unread_count: 1 } }); return true; }
          started.resolve(); await slow.promise;
          if (variant === 'timeout') await route.abort(); else await route.fulfill({ json: { ok: true } }); return true;
        });
        await page.goto(origin + '/notifications'); const item = page.getByRole('button', { name: /한글 매칭 알림/ }); await item.waitFor();
        await item.evaluate(el => { el.click(); el.click(); }); await started.promise;
        if (variant === 'unmount') await page.evaluate(() => window.fixtureUnmount());
        if (variant === 'timeout') {
          await page.getByRole('alert').waitFor(); assert.ok(await page.getByText('읽지 않은 알림 1개', { exact: true }).isVisible());
          assert.ok(await item.isEnabled());
        }
        slow.resolve(); await page.waitForLoadState('networkidle');
        assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
        assert.deepEqual(await page.evaluate(() => window.fixtureNavigations), []);
        if (variant === 'once') {
          await page.getByText('읽지 않은 알림 0개', { exact: true }).waitFor(); await item.click();
          assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
        } else if (variant === 'unmount') assert.equal(await page.locator('#root').innerHTML(), '');
      }, { fastTimeout: variant === 'timeout' });

      await run('profile-lazy-dialog', width, async ({ page, requests, setHandler }) => {
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/dating/chat/profile') return false;
          await route.fulfill({ json: profile(url.searchParams.get('thread_id') === 'A' ? 'A회원의 프로필' : 'C회원의 프로필') }); return true;
        });
        await page.goto(origin + '/chat'); await bubble(page, '대화 A').waitFor();
        assert.equal(requests.filter(r => r.path.endsWith('/profile')).length, 0);
        await page.getByRole('button', { name: '프로필 보기', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '상대 프로필' }); await dialog.getByText('A회원의 프로필', { exact: true }).waitFor();
        assert.ok(await dialog.getByText('서로 배려하면서 편하게 이야기하고 싶어요.').isVisible());
        await page.screenshot({ path: path.join(output, 'chat-profile-' + width + '.png'), fullPage: true });
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth));
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: /C회원/ }).click(); await page.getByRole('button', { name: '프로필 보기', exact: true }).click();
        await dialog.getByText('C회원의 프로필').waitFor(); await dialog.getByRole('button', { name: '닫기', exact: true }).click();
      });
      await run('profile-failure-retry', width, async ({ page, setHandler }) => {
        let fail = true;
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/dating/chat/profile') return false;
          await route.fulfill({ status: fail ? 404 : 200, json: fail ? { ok: false, message: '현재 확인할 수 없는 프로필입니다.' } : profile('복구된 상대') }); return true;
        });
        await page.goto(origin + '/chat'); await bubble(page, '대화 A').waitFor(); await page.getByRole('button', { name: '프로필 보기', exact: true }).click();
        const dialog = page.getByRole('dialog'); await dialog.getByRole('alert').waitFor();
        fail = false; await dialog.getByRole('button', { name: '다시 시도' }).click(); await dialog.getByText('복구된 상대').waitFor();
        await dialog.getByRole('button', { name: '닫기', exact: true }).click(); assert.ok(await bubble(page, '대화 A').isVisible());
      });
      await run('profile-photo-fallback', width, async ({ page, setHandler }) => {
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/dating/chat/profile') return false;
          const body = profile('사진 확인'); body.profile.photo_urls = ['/i/signed/missing/1', '/i/signed/missing/2'];
          await route.fulfill({ json: body }); return true;
        });
        await page.goto(origin + '/chat'); await bubble(page, '대화 A').waitFor(); await page.getByRole('button', { name: '프로필 보기', exact: true }).click();
        const dialog = page.getByRole('dialog'); await dialog.getByText('사진을 불러오지 못했어요.', { exact: true }).first().waitFor();
        await page.waitForLoadState('networkidle'); assert.equal(await dialog.getByText('사진을 불러오지 못했어요.', { exact: true }).count(), 2);
        assert.equal(await dialog.locator('img').count(), 0); await page.keyboard.press('Escape');
      });
      await run('profile-late-response', width, async ({ page, setHandler }) => {
        const slow = gate(), started = gate();
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/dating/chat/profile') return false;
          const id = url.searchParams.get('thread_id'); if (id === 'A') { started.resolve(); await slow.promise; }
          await route.fulfill({ json: profile(id + '프로필') }); return true;
        });
        await page.goto(origin + '/chat'); await bubble(page, '대화 A').waitFor(); await page.getByRole('button', { name: '프로필 보기', exact: true }).click(); await started.promise;
        await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
        await page.getByRole('button', { name: /B회원/ }).click(); await bubble(page, '대화 B').waitFor(); await page.getByRole('button', { name: '프로필 보기', exact: true }).click();
        await page.getByRole('dialog').getByText('B프로필', { exact: true }).waitFor(); slow.resolve(); await page.waitForLoadState('networkidle');
        assert.equal(await page.getByText('A프로필', { exact: true }).count(), 0); await page.keyboard.press('Escape');
      }, { ignoreAbort: true });
      await run('history-prepend-and-realtime', width, async ({ page, requests, setHandler }) => {
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/dating/chat/thread') return false;
          const before = url.searchParams.get('before'), index = before ? history.findIndex(row => row.id === before) : history.length;
          await route.fulfill({ json: pageOf(history.slice(Math.max(0, index - 50), index), index > 50) }); return true;
        });
        await page.goto(origin + '/chat'); await bubble(page, '지난 대화 124').waitFor(); assert.equal(await page.locator('[data-message-id]').count(), 50);
        const viewport = page.getByLabel('대화 내용'); await viewport.evaluate(el => { el.scrollTop = 0; });
        const anchor = page.locator('[data-message-id="history-075"]');
        const offset = () => anchor.evaluate(el => el.getBoundingClientRect().top - el.parentElement.getBoundingClientRect().top);
        const beforeOffset = await offset(); await page.getByRole('button', { name: '이전 대화 보기', exact: true }).click(); await bubble(page, '지난 대화 25').waitFor({ state: 'attached' });
        assert.equal(await page.locator('[data-message-id]').count(), 100); assert.ok(Math.abs((await offset()) - beforeOffset) <= 2, 'prepend scroll anchor');
        await viewport.evaluate(el => { el.scrollTop = 0; }); await page.getByRole('button', { name: '이전 대화 보기', exact: true }).click(); await bubble(page, '지난 대화 0').waitFor({ state: 'attached' });
        assert.equal(await page.locator('[data-message-id]').count(), 125); assert.equal(await page.getByRole('button', { name: '이전 대화 보기', exact: true }).count(), 0);
        const top = await viewport.evaluate(el => el.scrollTop);
        const live = { ...message('A', '새 실시간 대화'), id: 'live-A', created_at: '2026-09-27T01:00:00Z' };
        await page.evaluate(row => window.fixtureEmit('INSERT', 'A', row), live); await bubble(page, '새 실시간 대화').waitFor({ state: 'attached' }); await page.waitForLoadState('networkidle');
        assert.equal(await page.locator('[data-message-id]').count(), 126); assert.ok(Math.abs(await viewport.evaluate(el => el.scrollTop) - top) <= 2, 'reading older messages must not jump to bottom');
        assert.equal(requests.filter(r => r.path.endsWith('/thread') && r.method === 'GET').length, 4);
        await page.screenshot({ path: path.join(output, 'chat-history-' + width + '.png'), fullPage: true });
      });
      for (const variant of ['failure', 'late-room-switch', 'double-click']) await run('history-' + variant, width, async ({ page, requests, setHandler }) => {
        const slow = gate(), started = gate(); let fail = variant === 'failure';
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/dating/chat/thread' || url.searchParams.get('thread_id') !== 'A') return false;
          if (!url.searchParams.has('before')) { await route.fulfill({ json: pageOf(history.slice(75), true) }); return true; }
          started.resolve(); if (variant !== 'failure') await slow.promise;
          await route.fulfill({ status: fail ? 503 : 200, json: fail ? { message: '실패' } : pageOf(history.slice(25, 75), true) }); return true;
        });
        await page.goto(origin + '/chat'); await bubble(page, '지난 대화 124').waitFor();
        const button = page.getByRole('button', { name: '이전 대화 보기', exact: true });
        if (variant === 'double-click') await button.evaluate(el => { el.click(); el.click(); }); else await button.click(); await started.promise;
        if (variant === 'late-room-switch') { await page.getByRole('button', { name: /B회원/ }).click(); await bubble(page, '대화 B').waitFor(); }
        if (variant === 'failure') { await page.getByRole('alert').waitFor(); assert.equal(await page.locator('[data-message-id]').count(), 50); fail = false; await button.click(); }
        slow.resolve(); await page.waitForLoadState('networkidle');
        assert.equal(await page.locator('[data-message-id]').count(), variant === 'late-room-switch' ? 1 : 100);
        assert.equal(requests.filter(r => r.path.endsWith('/thread')).length, variant === 'double-click' ? 2 : 3);
      }, { ignoreAbort: variant === 'late-room-switch' });
      await run('history-late-page-after-window-reset', width, async ({ page, setHandler }) => {
        const slow = gate(), started = gate(); let reset = false;
        const newWindow = history.slice(75).map(row => ({ ...row, id: 'new-' + row.id, content: '새 창 ' + row.content, created_at: row.created_at.replace('09-27', '09-28') }));
        setHandler(async (route, url) => {
          if (url.pathname !== '/api/dating/chat/thread') return false;
          if (url.searchParams.has('before')) { started.resolve(); await slow.promise; await route.fulfill({ json: pageOf(history.slice(25, 75), true) }); }
          else await route.fulfill({ json: pageOf(reset ? newWindow : history.slice(75), true) });
          return true;
        });
        await page.goto(origin + '/chat'); await bubble(page, '지난 대화 124').waitFor(); await page.getByRole('button', { name: '이전 대화 보기', exact: true }).click(); await started.promise;
        reset = true; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await bubble(page, '새 창 지난 대화 124').waitFor();
        slow.resolve(); await page.waitForLoadState('networkidle'); assert.equal(await page.locator('[data-message-id]').count(), 50); assert.equal(await bubble(page, '지난 대화 25').count(), 0);
      });
    }
    console.log(JSON.stringify({ passed, productionRequests: 0, screenshots: output }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
