/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const webpack = require('webpack'), { chromium } = require('./test-browser-runtime.cjs');
const root = path.resolve(__dirname, '..');
async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-contact-intro-browser-'));
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'fixtures/contact-intro-browser.tsx'),
      output: { path: output, filename: 'fixture.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'fixtures/profile-ux-loader.cjs') }] } });
    compiler.run((err, stats) => { compiler.close(() => {}); if (err || stats.hasErrors()) reject(err || Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const cssRoot = process.env.CONTACT_CONVERSION_CSS_DIR || path.join(root, '.next/static/css');
  const css = fs.readdirSync(cssRoot).filter(p => p.endsWith('.css')).map(p => fs.readFileSync(path.join(cssRoot, p), 'utf8')).join('\n');
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); }
    else if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ ...(process.env.TEST_BROWSER_CHANNEL ? { channel: process.env.TEST_BROWSER_CHANNEL } : {}), headless: true });
    const context = await browser.newContext();
    let scenario = 'discount', reads = 0;
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      assert.equal(url.origin, origin, 'No external requests');
      if (!url.pathname.startsWith('/api/')) return route.continue();
      assert.equal(req.method(), 'GET', 'Rendering/focusing MUST NOT initiate payments'); reads++;
      assert.equal(url.pathname, '/api/dating/1on1/contact-intro-offer');
      const matchId = url.searchParams.get('matchId');
      const offer = { offerId: '00000000-0000-4000-8000-000000000001', matchId, amount: 15000, originalAmount: 20000,
        expiresAt: new Date(Date.now() + 3600000).toISOString(), serverNow: new Date().toISOString(), active: true, hasOrder: false };
      if (scenario === 'slow') await new Promise(resolve => setTimeout(resolve, 350));
      await route.fulfill({ status: scenario === 'error' ? 503 : 200, json: { offer:
        scenario === 'none' || scenario === 'error' || matchId.endsWith('3') ? null :
          scenario === 'invalid' ? { ...offer, amount: 1 } : scenario === 'existing' ? { ...offer, active: false, hasOrder: true } : offer } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const width of [320, 390, 768]) {
      scenario = 'discount'; await page.setViewportSize({ width, height: 900 }); await page.goto(origin);
      const button = page.getByRole('button', { name: '연락처 교환 · 15,000원', exact: true }); await button.waitFor();
      assert.equal(await page.getByLabel('전달한 요청').innerText(), '');
      assert((await button.boundingBox()).height >= 44);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert(!(await page.locator('body').innerText()).includes('\ufffd'));
      await page.screenshot({ path: path.join(output, `discount-${width}.png`), fullPage: true });
      await button.click(); const sent = JSON.parse(await page.getByLabel('전달한 요청').innerText());
      assert.equal(sent.offerId, '00000000-0000-4000-8000-000000000001');
      await page.getByLabel('기존 무료 혜택').check(); await page.getByRole('button', { name: '무료로 번호교환', exact: true }).click();
      assert.equal(JSON.parse(await page.getByLabel('전달한 요청').innerText()).offerId, undefined);
    }
    for (const state of ['none', 'error', 'invalid']) {
      scenario = state; await page.goto(origin); await page.getByRole('button', { name: '연락처 교환 · 20,000원', exact: true }).waitFor();
      await page.waitForTimeout(150); assert.equal(await page.getByText('첫 교환 25% 할인', { exact: false }).count(), 0);
      await page.getByRole('button', { name: '연락처 교환 · 20,000원', exact: true }).click();
      assert.equal(JSON.parse(await page.getByLabel('전달한 요청').innerText()).offerId, undefined);
    }
    scenario = 'existing'; await page.goto(origin); await page.getByText('진행 중인 할인 주문 · 기존 금액 유지').waitFor();
    await page.getByRole('button', { name: '연락처 교환 · 15,000원', exact: true }).waitFor();
    scenario = 'slow'; await page.goto(origin); await page.getByLabel('다른 매칭').check();
    await page.waitForTimeout(550); assert.equal(await page.getByRole('button', { name: '연락처 교환 · 15,000원', exact: true }).count(), 0);
    await page.getByRole('button', { name: '연락처 교환 · 20,000원', exact: true }).click();
    assert.equal(JSON.parse(await page.getByLabel('전달한 요청').innerText()).matchId, '00000000-0000-4000-8000-000000000003');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, widths: [320, 390, 768], states: ['discount', 'free', 'none', 'error', 'invalid', 'existing', 'late-other-match'], automaticPayments: 0, reads, screenshots: output }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
