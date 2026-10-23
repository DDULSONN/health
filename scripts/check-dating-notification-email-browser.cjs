/* eslint-disable @typescript-eslint/no-require-imports */
// Render the actual email payload locally. Intercept every network request;
// this script cannot send mail or visit a live member's matching page.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript');
const { chromium } = require('./test-browser-runtime.cjs');
const root = path.resolve(__dirname, '..'), read = p => fs.readFileSync(path.join(root, p), 'utf8');
function load(file) {
  const mod = { exports: {} };
  new Function('require', 'exports', ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)
    (name => load(name.slice(2) + '.ts'), mod.exports); return mod.exports;
}
async function renderEmail(subject, text) {
  const ast = ts.createSourceFile('email.ts', read('lib/dating-swipe.ts'), ts.ScriptTarget.Latest, true);
  const names = ['sendDatingEmailToAddressDetailed', 'sanitizeOutgoingEmailCopy', 'looksLikeBrokenKoreanCopy', 'normalizeIdempotencyKey'];
  const src = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text) ||
    ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'MOJIBAKE_MARKERS')).map(n => n.getText(ast)).join('\n');
  const mod = { exports: {} }; let payload;
  new Function('exports', 'process', 'fetch', 'delay', ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(
    mod.exports, { env: { RESEND_API_KEY: 'synthetic', NOTIFY_FROM_EMAIL: 'sender@example.invalid' } },
    async (url, options) => { assert.equal(url, 'https://api.resend.com/emails'); payload = JSON.parse(options.body); return new Response('', { status: 200 }); }, async () => {});
  await mod.exports.sendDatingEmailToAddressDetailed('recipient@example.invalid', subject,
    text + '\n\n-----\n알림 수신 설정을 변경할 수 있어요.\nhttps://helchang.com/api/email/unsubscribe?uid=test&campaign=dating_notifications&token=synthetic-test');
  return payload;
}
(async () => {
  const templates = load('lib/dating-email-templates.ts'), id = '00000000-0000-4000-8000-000000000001';
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtools-notification-email-'));
  const samples = [
    ['request', templates.buildOneOnOneSelectionReceivedNotification('미리보기 회원', '내 프로필', id), '매칭 상태 확인', `https://helchang.com/community/dating/cards?tab=one_on_one&matchId=${id}#selected-one-on-one-match`],
    ['accepted', templates.buildOneOnOneAcceptedNotification('미리보기 회원', id), '매칭 상태 확인'],
    ['reminder', templates.buildOneOnOnePendingReminder(id, 'selection_pending_24h'), '매칭 상태 확인'],
    ['open-received', templates.buildDatingApplicationReceivedNotification('미리보기 회원'), '지원 내역 확인', 'https://helchang.com/mypage?section=matching#open-card-received'],
    ['open-accepted', templates.buildDatingApplicationAcceptedNotification('미리보기 회원'), '지원 내역 확인', 'https://helchang.com/mypage?section=matching#open-card-applied'],
  ];
  let browser, checked = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390, 768]) {
      const context = await browser.newContext({ viewport: { width, height: 850 } });
      await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html lang="ko"><body>로컬 이동 확인</body></html>' }));
      const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      for (const [name, message, cta, expected] of samples) {
        const payload = await renderEmail(message.emailSubject, message.emailText);
        assert.equal(Buffer.from(payload.html).toString('utf8'), payload.html);
        await page.goto('about:blank');
        await page.setContent(payload.html);
        const link = page.getByRole('link', { name: cta, exact: true }); await link.waitFor();
        const href = await link.getAttribute('href'); if (expected) assert.equal(href, expected);
        assert.equal(await page.getByRole('link', { name: '알림 수신거부' }).count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.doesNotMatch(await page.locator('body').innerText(), /�/);
        await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
        await link.click(); await page.getByText('로컬 이동 확인').waitFor();
        assert.equal(page.url(), href); checked++;
      }
      assert.deepEqual(errors, []); await context.close();
    }
    console.log(JSON.stringify({ checked, output, liveSends: 0, liveRequests: 0 }));
  } finally { await browser?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
