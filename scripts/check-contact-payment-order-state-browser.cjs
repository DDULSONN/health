/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const webpack = require("webpack");
const { chromium } = require("./test-browser-runtime.cjs");

async function main() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "gymtools-payment-order-status-"));
  const root = path.resolve(__dirname, "..");
  const adapter = path.join(__dirname, "fixtures/payment-confirmation-adapters.tsx");
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: "development", devtool: false,
      entry: path.join(__dirname, "fixtures/contact-payment-order-state-browser.tsx"),
      output: { path: out, filename: "fixture.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], alias: { "@": root, "next/link": adapter } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, "fixtures/profile-ux-loader.cjs") }] },
    });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true })));
      else resolve();
    }));
  });
  const cssPath = process.env.CONTACT_CONVERSION_CSS_DIR || path.join(root, ".next/static/css");
  const css = fs.readdirSync(cssPath).filter(n => n.endsWith(".css")).map(n => fs.readFileSync(path.join(cssPath, n), "utf8")).join("\n");
  const server = http.createServer((req, res) => {
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(out, "fixture.js")));
    } else if (req.url === "/fixture.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(css);
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390]) {
      for (const [state, status, expected, link] of [
        ["retry", 200, "완료된 결제가 확인되지 않았어요", true],
        ["paid", 200, "추가로 결제하지 마세요", true],
        ["pending", 200, "중복 결제를 피하려면 추가로 결제하지 마세요", false],
        ["unavailable", 200, "결제하지 말고 나중에 다시 확인", false],
        [null, 404, "주문번호와 함께 문의", false],
        [null, 503, "결제하지 말고 나중에 다시 확인", false],
      ]) {
        const context = await browser.newContext({ viewport: { width, height: 820 } });
        const page = await context.newPage();
        const requests = [], errors = [];
        page.on("pageerror", error => errors.push(error.message));
        let release;
        const pending = new Promise(resolve => { release = resolve; });
        await context.route("**/*", async route => {
          const req = route.request(), url = new URL(req.url());
          if (url.origin !== origin) { errors.push("external request"); return route.abort(); }
          if (url.pathname === "/api/payments/toss/contact-recovery") {
            requests.push({ method: req.method(), params: Object.fromEntries(url.searchParams) });
            await pending;
            return route.fulfill({ status, json: status === 200 ? { ok: true, state } : { ok: false } });
          }
          if (url.pathname.startsWith("/api/")) { errors.push("unexpected api"); return route.abort(); }
          return route.continue();
        });
        try {
          await page.goto(origin);
          const first = page.getByRole("button", { name: "기존 주문 상태 확인" });
          await first.waitFor();
          assert.deepEqual(requests, []);
          assert((await first.boundingBox()).height >= 44, "44px touch target");
          await first.click();
          const waiting = page.getByRole("button", { name: "결제 상태 확인 중…" });
          await waiting.waitFor();
          assert(await waiting.isDisabled());
          release();
          await page.getByText(new RegExp(expected)).waitFor();
          const resume = page.getByRole("link", { name: "이 매칭 확인" });
          assert.equal(await resume.count(), link ? 1 : 0);
          if (link) assert.match(await resume.getAttribute("href"), /^\/community\/dating\/cards\?tab=one_on_one&matchId=/);
          assert.deepEqual(requests, [{ method: "GET", params: { orderId: "fixture_order_123", view: "order-status" } }]);
          assert.deepEqual(errors, []);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile width");
        } finally { release(); await context.close(); }
      }
    }
    console.log("Contact payment status browser: 12 mobile fixture cases, GET only, no external requests.");
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
