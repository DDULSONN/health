/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated browser fixture: no production credentials, no real members, every external request blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const webpack = require('webpack');
const root = path.resolve(__dirname, '..');
const runtime = process.env.CODEX_NODE_PACKAGES || 'C:/Users/DDULSONN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(path.join(runtime, 'playwright'));
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-contact-close-browser-'));
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false,
      entry: path.join(__dirname, 'fixtures/admin-contact-exchanges-browser.tsx'),
      output: { path: output, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/mypage-navigation-loader.cjs') }] },
    });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const cssRoot = path.join(root, '.next/static/css');
  const css = fs.readdirSync(cssRoot).filter(name => name.endsWith('.css')).map(name => fs.readFileSync(path.join(cssRoot, name), 'utf8')).join('\n');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'");
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); }
    else if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else if (req.url.startsWith('/api/')) { res.writeHead(500); res.end('Unmocked fixture request'); }
    else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser, passed = 0;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const width of [360, 1280]) for (const scenario of ['success', 'cancel', 'slow-post', 'lost-post', 'timeout-post', 'bad-response', 'server-error', 'load-error', 'pagination', 'switch-read', 'switch-post', 'empty']) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = []; let posts = 0, gets = 0, blocked = 0, closed = false, release;
      const gate = new Promise(resolve => { release = resolve; });
      page.on('pageerror', error => errors.push(error.message));
      if (scenario === 'timeout-post') await page.addInitScript(() => {
        const original = window.setTimeout;
        window.setTimeout = (fn, delay, ...args) => original(fn, delay === 30000 ? 300 : delay, ...args);
      });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) { blocked++; await route.abort(); return; }
        if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
        assert.match(url.pathname, /^\/api\/admin\/users\//);
        const oldMember = url.pathname.includes('/' + uid(1) + '/');
        if (req.method() === 'POST') {
          assert.equal(url.pathname, `/api/admin/users/${uid(1)}/contact-exchanges/${uid(10)}/close`);
          posts++;
          if (['slow-post', 'switch-post'].includes(scenario)) await gate;
          if (scenario === 'server-error') { await route.fulfill({ status: 409, json: { error: '매칭 상태가 변경됐습니다. 목록을 다시 조회해 주세요.' } }); return; }
          closed = true;
          if (scenario === 'lost-post') { await route.abort(); return; }
          if (scenario === 'timeout-post') return;
          await route.fulfill({ json: { ok: true, match_id: scenario === 'bad-response' ? uid(999) : uid(10), state: 'admin_canceled', contact_exchange_status: 'canceled' } });
          return;
        }
        assert.equal(req.method(), 'GET'); gets++;
        if (scenario === 'load-error' && gets === 1) { await route.fulfill({ status: 503, json: { error: '번호 교환 내역을 불러오지 못했습니다.' } }); return; }
        if (scenario === 'switch-read' && oldMember) await gate;
        const second = url.searchParams.has('before_id');
        if (second) assert.equal(url.searchParams.get('before_id'), uid(10));
        const items = scenario === 'empty' || (closed && oldMember) ? [] : [{ id: second ? uid(9) : uid(10), own_name: '조회한 회원',
          counterpart_name: oldMember ? (second ? '이전상대' : '검증상대') : '다른회원상대',
          counterpart_nickname: '아주긴닉네임으로모바일줄바꿈도검증합니다', approved_at: '2026-09-27T01:00:00Z', created_at: '2026-09-26T00:00:00.123456+00:00' }];
        await route.fulfill({ json: { ok: true, items, next_cursor: scenario === 'pagination' && !second ? { id: uid(10), created_at: items[0].created_at } : null } });
      });
      try {
        await page.goto(origin);
        const load = page.getByRole('button', { name: '번호 교환 내역 보기', exact: true }); await load.waitFor();
        assert.equal(gets, 0, 'lazy panel must not load on member search');
        await load.evaluate(el => { el.click(); el.click(); });
        if (scenario === 'switch-read') {
          await page.getByRole('button', { name: '조회 중...' }).waitFor();
          await page.getByRole('button', { name: '다른 회원 조회' }).click();
          await page.getByRole('button', { name: '번호 교환 내역 보기', exact: true }).click();
          await page.getByText('상대: 다른회원상대', { exact: true }).waitFor(); release();
          assert.equal(await page.getByText('상대: 검증상대', { exact: true }).count(), 0);
        } else if (scenario === 'empty') {
          await page.getByText('현재 열려 있는 번호 교환 완료 내역이 없습니다.').waitFor();
          assert.equal(await page.getByRole('button', { name: '닫기', exact: true }).count(), 0);
        } else {
          if (scenario === 'load-error') { await page.getByRole('alert').waitFor(); await page.getByRole('button', { name: '목록 다시 조회' }).click(); }
          await page.getByText('상대: 검증상대', { exact: true }).waitFor();
          if (scenario === 'pagination') {
            await page.getByRole('button', { name: '이전 내역 더 보기' }).click();
            await page.getByText('상대: 이전상대', { exact: true }).waitFor();
            assert.equal(await page.getByRole('button', { name: '닫기', exact: true }).count(), 2);
          } else {
            await page.getByRole('button', { name: '닫기', exact: true }).click();
            await page.getByText('검증상대님과의 번호 교환을 닫을까요?').waitFor();
            await page.getByText(/자동 환불되지 않습니다/).waitFor();
            assert.equal(posts, 0, 'opening the confirmation must not mutate');
            if (scenario === 'success') await page.screenshot({ path: path.join(output, `confirm-${width}.png`), fullPage: true });
            if (scenario === 'cancel') {
              await page.getByRole('button', { name: '취소', exact: true }).click();
              assert.equal(await page.getByRole('button', { name: '번호 공개 종료' }).count(), 0); assert.equal(posts, 0);
            } else {
              await page.getByRole('button', { name: '번호 공개 종료', exact: true }).evaluate(el => { el.click(); el.click(); });
              if (scenario === 'slow-post') {
                await page.getByRole('button', { name: '닫는 중...' }).waitFor();
                assert.equal(await page.getByRole('button', { name: '닫기', exact: true }).isDisabled(), true); assert.equal(posts, 1); release();
              }
              if (scenario === 'switch-post') {
                await page.getByRole('button', { name: '닫는 중...' }).waitFor();
                await page.getByRole('button', { name: '다른 회원 조회' }).click();
                await page.getByRole('button', { name: '번호 교환 내역 보기', exact: true }).click();
                await page.getByText('상대: 다른회원상대', { exact: true }).waitFor(); release();
                assert.equal(await page.locator('[data-testid="closed-id"]').textContent(), '');
              } else if (['lost-post', 'timeout-post', 'bad-response', 'server-error'].includes(scenario)) {
                await page.getByRole('alert').waitFor(); assert.equal(posts, 1);
                assert.equal(await page.getByRole('button', { name: '닫기', exact: true }).isDisabled(), true);
                assert.equal(await page.locator('[data-testid="closed-id"]').textContent(), '');
                await page.getByRole('button', { name: '목록 다시 조회' }).click();
                await page.getByRole('button', { name: '목록 다시 조회' }).waitFor();
                if (scenario === 'server-error') { await page.getByRole('button', { name: '닫기', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '닫기', exact: true }).isEnabled(), true); }
                else await page.getByText('현재 열려 있는 번호 교환 완료 내역이 없습니다.').waitFor();
                assert.equal(posts, 1, 'recovery is GET only');
              } else {
                await page.getByRole('status').waitFor();
                assert.equal(await page.locator('[data-testid="closed-id"]').textContent(), uid(10));
                assert.equal(await page.getByRole('button', { name: '닫기', exact: true }).count(), 0);
                assert.equal(posts, 1);
              }
            }
          }
        }
        assert.equal(errors.length, 0, errors.join('\n')); assert.equal(blocked, 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
        assert.ok(!(await page.locator('body').innerText()).includes('\ufffd'));
        console.log(JSON.stringify({ width, scenario, passed: true })); passed++;
      } catch (error) { await page.screenshot({ path: path.join(output, `failed-${width}-${scenario}.png`), fullPage: true }); throw error; }
      finally { release(); await context.close(); }
    }
    console.log(JSON.stringify({ passed, output }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
