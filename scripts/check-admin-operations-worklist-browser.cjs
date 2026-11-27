/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const webpack = require("webpack");
const { chromium } = require("./test-browser-runtime.cjs");

const root = path.resolve(__dirname, "..");
const pagePath = "/api/admin/operations";
const counts = {
  paymentReview: null, agedCheckout: 0, checkoutHelp: 2, vouchers: 7,
  profileReview: 3, datingReports: 4, support: 1,
};
const destinations = [
  ["승인 후 교환 확인", "/mypage?section=admin&adminTab=payment_center"],
  ["오래된 결제 대기", "/mypage?section=admin&adminTab=payment_center"],
  ["교환권 사용 문의", "/mypage?section=admin&adminTab=one_on_one_contact"],
  ["교환권 보상 신청", "/mypage?section=admin&adminTab=one_on_one_contact"],
  ["자동 프로필 검수", "/mypage?section=admin&adminTab=card_ai_review"],
  ["매칭 신고", "/admin/dating/cards"],
  ["고객 문의", "/admin/support"],
];

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "gymtools-admin-operations-browser-"));
  const link = path.join(__dirname, "fixtures/payment-confirmation-adapters.tsx");
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: "development", devtool: false,
      entry: path.join(__dirname, "fixtures/admin-operations-worklist-browser.tsx"),
      output: { path: output, filename: "fixture.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], alias: { "@": root, "next/link": link } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, "fixtures/profile-ux-loader.cjs") }] },
    });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true })));
      else resolve();
    }));
  });
  const cssPath = process.env.CONTACT_CONVERSION_CSS_DIR || path.join(root, ".next/static/css");
  const css = fs.readdirSync(cssPath).filter(n => n.endsWith(".css")).map(n => fs.readFileSync(path.join(cssPath, n), "utf8")).join("\n");
  assert.ok(css.length, "built CSS required for geometry checks");
  const server = http.createServer((req, res) => {
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(output, "fixture.js")));
    } else if (req.url === "/fixture.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(css);
    } else if (req.url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 820 } });
      const page = await context.newPage();
      page.setDefaultTimeout(6_000);
      const errors = [];
      const calls = [];
      const pending = Array.from({ length: 3 }, () => {
        let release;
        const promise = new Promise(resolve => { release = resolve; });
        return { promise, release };
      });
      page.on("pageerror", error => errors.push(error.message));
      await context.route("**/*", async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin || (url.pathname.startsWith("/api/") && url.pathname !== pagePath)) {
          errors.push("unexpected request: " + url.pathname);
          return route.abort();
        }
        if (url.pathname !== pagePath) return route.continue();
        const step = calls.length;
        calls.push({ method: request.method(), path: url.pathname, search: url.search });
        if (!pending[step] || request.method() !== "GET") {
          errors.push("unexpected operations request");
          return route.abort();
        }
        await pending[step].promise;
        if (step === 1) return route.abort("failed");
        return route.fulfill({
          json: {
            counts: step === 0 ? counts : { ...counts, paymentReview: 5, agedCheckout: null, vouchers: 8 },
            checkedAt: "2026-11-27T01:30:00Z",
          },
        });
      });

      try {
        await page.goto(origin);
        const panel = page.getByRole("region", { name: "오늘 처리할 일" });
        const busy = panel.getByRole("status").filter({ hasText: "업무 건수를 확인하고 있어요." });
        const refresh = panel.getByRole("button", { name: "다시 확인", exact: true });
        const item = label => panel.getByRole("link", { name: new RegExp(label) });
        await busy.waitFor();
        assert(await refresh.isDisabled());
        assert.equal(await panel.getByRole("link").count(), 0);
        pending[0].release();
        await item("승인 후 교환 확인").getByText("확인 필요", { exact: true }).waitFor();
        await item("오래된 결제 대기").getByText("0건", { exact: true }).waitFor();
        assert((await refresh.boundingBox()).height >= 44);
        for (const [label, href] of destinations) assert.equal(await item(label).getAttribute("href"), href);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile width before retry");

        await refresh.click();
        await busy.waitFor();
        assert(await refresh.isDisabled());
        assert.equal(await panel.getByRole("link").count(), 0, "do not keep old order counts during refresh");
        pending[1].release();
        const alert = panel.getByRole("alert");
        await alert.waitFor();
        assert.match(await alert.innerText(), /불러오지 못했어요/);
        assert.equal(await panel.getByRole("link").count(), 0, "do not display stale counts after network failure");
        assert(await refresh.isEnabled());

        await refresh.click();
        await busy.waitFor();
        pending[2].release();
        await item("승인 후 교환 확인").getByText("5건", { exact: true }).waitFor();
        await item("오래된 결제 대기").getByText("확인 필요", { exact: true }).waitFor();
        await item("교환권 보상 신청").getByText("8건", { exact: true }).waitFor();
        assert.equal(await alert.count(), 0);
        assert.deepEqual(calls, Array.from({ length: 3 }, () => ({ method: "GET", path: pagePath, search: "" })));
        assert.deepEqual(errors, []);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile width after retry");
      } finally {
        for (const gate of pending) gate.release();
        await context.close();
      }
    }
    console.log("Admin operations browser: 320/390px, 7 real links, zero vs unavailable, loading/failure/retry, GET only.");
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
