/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), webpack = require('webpack');
const { chromium } = require('./test-browser-runtime.cjs');
const root = path.resolve(__dirname, '..');
async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-candidate-hides-'));
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'fixtures/candidate-hides-browser.tsx'), output: { path: output, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx','.ts','.js'], alias: { '@': root } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs') }] } });
    compiler.run((e,s) => { compiler.close(() => {}); if (e || s.hasErrors()) reject(e || Error(s.toString({ all: false, errors: true }))); else resolve(); });
  });
  const cssRoot = path.join(root, '.next/static/css');
  const css = fs.readdirSync(cssRoot).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssRoot, f), 'utf8')).join('\n');
  const server = http.createServer((req,res) => {
    if (req.url === '/fixture.js') { res.setHeader('content-type','text/javascript'); res.end(fs.readFileSync(path.join(output,'fixture.js'))); }
    else if (req.url === '/fixture.css') { res.setHeader('content-type','text/css'); res.end(css); }
    else { res.setHeader('content-type','text/html; charset=utf-8'); res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let rows = [], reads = 0, writes = 0, fail = false, malformed = false;
    const errors = [];
    await context.route('**/api/**', async route => {
      const req = route.request(); const url = new URL(req.url());
      assert.equal(url.origin, origin); assert.equal(url.pathname, '/api/dating/1on1/candidate-hides', 'no payment, match or notification calls');
      if (req.method() === 'GET') { reads++; await route.fulfill({ json: { enabled: true, items: malformed ? [null] : rows } }); return; }
      writes++; const body = req.postDataJSON(); await new Promise(r => setTimeout(r, 100));
      if (fail) { await route.fulfill({ status: 503, json: { error: '숨김 상태를 확인하지 못했어요. 다시 시도해 주세요.' } }); return; }
      if (body.action === 'hide') {
        assert.equal(body.ticket, 'local-receipt'); assert.equal(body.sourceCardId, '00000000-0000-4000-8000-000000000011');
        rows = [{ id: '00000000-0000-4000-8000-000000000091', name: '예시 후보', created_at: new Date().toISOString() }];
      } else { assert.equal(body.action, 'restore'); rows = rows.filter(row => row.id !== body.id); }
      await route.fulfill({ json: { ok: true } });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin); await page.getByRole('button', { name: '숨기기', exact: true }).waitFor();
    assert.equal(reads, 0, 'collapsed manager does not fetch'); assert.equal(writes, 0);
    for (const width of [320,390,768]) {
      await page.setViewportSize({ width, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const bounds = await page.getByRole('button',{ name: '숨기기', exact: true }).boundingBox(); assert.ok(bounds.height >= 44);
      await page.screenshot({ path: path.join(output, `candidate-${width}.png`), fullPage: true });
    }
    page.once('dialog', d => d.dismiss()); await page.getByRole('button', { name: '숨기기', exact: true }).click(); assert.equal(writes, 0);
    fail = true; page.once('dialog', d => d.accept()); await page.getByRole('button', { name: '숨기기', exact: true }).click();
    await page.getByRole('alert').waitFor(); assert.equal(await page.locator('article').count(), 1, 'failure never removes the candidate');
    fail = false; page.once('dialog', d => d.accept()); await page.getByRole('button', { name: '숨기기', exact: true }).evaluate(b => { b.click(); b.click(); });
    await page.locator('article').waitFor({ state: 'hidden' }); assert.equal(writes, 2, 'one failed call plus one successful call, no duplicate');
    await page.getByRole('button', { name: '숨긴 후보 보기' }).click(); await page.getByRole('button', { name: '숨김 해제', exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: '진행 중인 매칭' }).textContent(), '서로 수락한 매칭 · 연락처 교환 가능');
    for (const width of [320,390,768]) {
      await page.setViewportSize({ width, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, `hidden-${width}.png`), fullPage: true });
    }
    fail = true; await page.getByRole('button', { name: '숨김 해제', exact: true }).click(); await page.getByRole('alert').waitFor(); assert.equal(rows.length, 1);
    fail = false; await page.getByRole('button', { name: '숨김 해제', exact: true }).click(); await page.locator('article').waitFor(); assert.equal(writes, 4);
    malformed = true; await page.getByRole('button', { name: '숨긴 후보 보기' }).click(); await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button', { name: '숨김 해제', exact: true }).count(), 0);
    malformed = false; rows = Array.from({ length: 41 }, (_, i) => ({ id: String(i), name: '긴 이름 후보 '.repeat(5), created_at: new Date().toISOString() }));
    await page.getByRole('button', { name: '다시 확인', exact: true }).click(); await page.getByRole('button', { name: '20명 더 보기' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '숨김 해제', exact: true }).count(), 20);
    await page.getByRole('button', { name: '20명 더 보기' }).click(); assert.equal(await page.getByRole('button', { name: '숨김 해제', exact: true }).count(), 40);
    await page.setViewportSize({ width: 320, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: '설치 상태 전환' }).click();
    assert.equal(await page.getByRole('button', { name: '숨기기', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: '숨긴 후보 접기' }).count(), 0);
    assert.deepEqual(errors, []); console.log(JSON.stringify({ ok: true, reads, writes, widths: [320,390,768], errors, output }));
  } finally { await browser?.close(); await new Promise(r => server.close(r)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
