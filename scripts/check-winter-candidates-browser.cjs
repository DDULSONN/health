/* eslint-disable @typescript-eslint/no-require-imports */
// Actual Home 1:1 panel, served on loopback with fake APIs and all external traffic blocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const webpack = require("webpack");
const { chromium } = require("./test-browser-runtime.cjs");

const root = path.resolve(__dirname, "..");
const expand = "/api/dating/1on1/recommendations/expand";
const alert = expand + "/alert";
const profileId = "00000000-0000-4000-8000-000000000001";
const widths = [320, 390];
const scenarios = ["two", "empty", "changed", "claimed", "empty-claimed", "not-repeated", "preview-unavailable"];

async function build(output) {
  const adapter = path.join(__dirname, "fixtures/recommendation-refresh-adapters.tsx");
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: "development", devtool: false,
      entry: path.join(__dirname, "fixtures/recommendation-refresh-browser.tsx"),
      output: { path: output, filename: "fixture.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], fallback: { crypto: false }, alias: {
        "next/link": adapter, "next/image": adapter, "next/navigation": adapter,
        "@/lib/supabase/client": adapter, "@/components/DatingAdultNotice": adapter, "@": root,
      } },
      plugins: [new webpack.DefinePlugin({ "process.env.NEXT_PUBLIC_OPENKAKAO_URL": "undefined" })],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/,
        use: { loader: path.join(__dirname, "fixtures/mypage-navigation-loader.cjs"), options: { renderAdminCounts: false } } }] },
    });
    compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error || stats.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true })));
      else resolve();
    });
  });
}

async function runCase(browser, origin, output, width, scenario) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [], unexpected = [], posts = [], requests = [], dialogs = [];
  let previews = 0, opened = false, alertsOn = false;
  const day = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const profile = { id: profileId, user_id: "fixture-member", name: "검증 프로필", sex: "female", age: 29, birth_year: 1998,
    height_cm: 165, job: "회사원", region: "서울", intro_text: "로컬 테스트용 프로필이에요.", status: "approved",
    created_at: new Date().toISOString(), photo_signed_urls: ["/fixture-photo.png", "/fixture-photo.png"] };
  const candidate = (name, id) => ({ ...profile, name, id, user_id: "other-" + id, sex: "male" });
  const winter = [candidate("겨울 후보 가나다", "winter-one"), candidate("겨울 후보 라마바", "winter-two")];
  const ordinary = [candidate("일반 추가 후보", "ordinary-extra")];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => { dialogs.push(dialog.type()); return dialog.dismiss(); });
  const payload = candidates => ({ source_card_id: profile.id, day_key: day(), candidates, expires_at: new Date(Date.now() + 3600000).toISOString() });

  await context.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (url.origin !== origin) { unexpected.push(method + " " + url.origin); await route.abort(); return; }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
    requests.push([method, url.pathname]);
    let body = { ok: true, items: [], cards: [], applications: [], loggedIn: true };
    if (method !== "GET") {
      const data = req.postDataJSON();
      posts.push([method, url.pathname, data]);
      if (method !== "POST" || ![expand, alert].includes(url.pathname)) {
        unexpected.push(method + " " + url.pathname);
        await route.fulfill({ status: 405, json: { error: "Unexpected fixture mutation" } }); return;
      }
      if (url.pathname === alert) {
        alertsOn = data?.enabled === true; body = { enabled: alertsOn };
      } else if (data?.mode === "winter") {
        opened = true;
        body = payload(scenario === "changed" ? [] : winter);
      } else {
        body = payload(ordinary);
      }
      await route.fulfill({ json: body }); return;
    }
    switch (url.pathname) {
      case expand: {
        previews++;
        if (url.searchParams.get("mode") !== "winter" || url.searchParams.get("source_card_id") !== profile.id)
          unexpected.push("Wrong winter preview query");
        if (scenario === "preview-unavailable") { await route.fulfill({ status: 503, json: {} }); return; }
        const hasTwo = ["two", "changed"].includes(scenario) && !opened;
        body = { source_card_id: profile.id, day_key: day(), count: hasTwo ? 2 : 0,
          repeated: !["claimed", "not-repeated"].includes(scenario) && !(scenario === "two" && opened),
          claimed: ["claimed", "empty-claimed"].includes(scenario) || (scenario === "two" && opened) };
        break;
      }
      case alert:
        if (url.searchParams.get("source_card_id") !== profile.id) unexpected.push("Wrong alert settings query");
        body = { enabled: alertsOn }; break;
      case "/api/mypage/summary":
        body = { profile: { email: "fixture@example.invalid", nickname: "검증회원", phone_verified: true,
          nickname_changed_count: 0, nickname_change_credits: 0, swipe_profile_visible: true },
        account: { is_banned: false }, isAdmin: false, weekly_win_count: 0, bodycheck_posts: [] }; break;
      case "/api/dating/1on1/my":
        body = { items: [profile] }; break;
      case "/api/dating/1on1/write-status":
        body = { canWrite: false, phoneVerified: true, writeStatus: "approved", activeRequestStatus: "approved" }; break;
      case "/api/dating/1on1/recommendations/my":
        body = { items: [{ source_card_id: profile.id, source_card_status: "approved", candidate_pool_count: 8,
          recommendations: [candidate("기존 기본 추천", "main")], admin_recommendations: [], favorite_candidates: [],
          refresh_limit: 1, refresh_used_count: 0, refresh_remaining: 1, can_refresh: true, refresh_used_at: null,
          expansion_enabled: true, new_candidate_notice: scenario === "not-repeated" ? null : { state: "waiting", new_candidate_count: 0 } }] };
        break;
      case "/api/dating/cards/viewer-sex":
        body = { status: "resolved", viewerSex: "female", targetSex: "male", source: "one_on_one", canSwitchSex: false, requiresSexSelection: false }; break;
      case "/api/dating/cards/my/swipe-status":
        body = { outgoing_likes: [], incoming_likes: [], summary: { incoming_pending: 0, outgoing_pending: 0 } }; break;
      case "/api/dating/cards/write-enabled": body = { enabled: true }; break;
      case "/api/dating/apply-credits/status": body = { creditsRemaining: 5 }; break;
    }
    await route.fulfill({ json: body });
  });

  try {
    const home = origin + "/community/dating/cards?tab=one_on_one";
    await page.goto(home);
    const refresh = page.getByRole("button", { name: /후보 새로고침 · 1회/ }).first();
    const panel = page.getByRole("region", { name: "후보 범위 넓히기" });
    const more = panel.getByRole("button", { name: "후보 넓혀보기" });
    const seasonal = panel.getByText("겨울 동네 소개", { exact: true });
    const open = panel.getByRole("button", { name: "새 후보 보기", exact: true });
    const startAlert = panel.getByRole("button", { name: "새 후보 생기면 알려줘요", exact: true });
    const stopAlert = panel.getByRole("button", { name: "새 후보 알림 끄기", exact: true });
    await refresh.waitFor();
    await more.waitFor();
    assert.deepEqual(posts, [], "initial display is entirely read-only");
    if (scenario === "two" || scenario === "changed") {
      await panel.getByText("아직 안 본 근처 후보 2명이 있어요", { exact: true }).waitFor();
      assert.equal(await startAlert.count(), 0);
      assert.ok((await open.boundingBox()).height >= 44, "new action has a mobile-sized hit target");
      await open.evaluate(button => { button.click(); button.click(); });
      if (scenario === "two") {
        await panel.getByText(/겨울 후보 가나다/).waitFor();
        await panel.getByText(/겨울 후보 라마바/).waitFor();
        assert.equal(await panel.locator("article").count(), 2);
        assert.equal(await panel.getByText(/희망 나이대에 맞는 근처 후보만/).count(), 1);
        await seasonal.waitFor({ state: "hidden" });
        await panel.getByRole("button", { name: "추가 후보 접기" }).click();
        await more.waitFor();
        await page.reload();
        await more.waitFor();
        await seasonal.waitFor({ state: "hidden" });
      } else {
        await panel.getByText(/지금은 조건에 맞는 새 후보가 없어요/).waitFor();
        await startAlert.waitFor();
        await seasonal.waitFor({ state: "hidden" });
        assert.equal(await panel.locator("article").count(), 0);
        await panel.getByRole("button", { name: "추가 후보 접기" }).click();
      }
      assert.deepEqual(posts, [["POST", expand, { source_card_id: profile.id, mode: "winter" }]]);
    } else if (scenario === "empty" || scenario === "empty-claimed") {
      await startAlert.waitFor();
      await seasonal.waitFor({ state: "hidden" });
      assert.equal(await startAlert.getAttribute("aria-pressed"), "false");
      await startAlert.evaluate(button => { button.click(); button.click(); });
      await stopAlert.waitFor();
      assert.equal(await stopAlert.getAttribute("aria-pressed"), "true");
      await panel.getByRole("status").filter({ hasText: "사이트 알림으로 한 번" }).waitFor();
      await page.reload();
      await stopAlert.waitFor();
      await stopAlert.click();
      await startAlert.waitFor();
      await panel.getByRole("status").filter({ hasText: "새 후보 알림을 껐어요." }).waitFor();
      assert.deepEqual(posts, [
        ["POST", alert, { source_card_id: profile.id, enabled: true }],
        ["POST", alert, { source_card_id: profile.id, enabled: false }],
      ]);
    } else {
      await seasonal.waitFor({ state: "hidden" });
      assert.equal(await startAlert.count(), 0);
      if (scenario === "not-repeated") assert.equal(previews, 0);
    }

    if (["empty", "not-repeated", "preview-unavailable"].includes(scenario)) {
      await more.click();
      await panel.getByText(/일반 추가 후보/).waitFor();
      assert.deepEqual(posts.at(-1), ["POST", expand, { source_card_id: profile.id }]);
    }
    await refresh.waitFor();
    await page.getByText(/기존 기본 추천/).first().waitFor();
    assert.ok(requests.some(([method, route]) => method === "GET" && route === alert));
    assert.deepEqual(unexpected, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(dialogs, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal page overflow");
    assert.ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth), "no horizontal panel overflow");
    console.log(JSON.stringify({ width, scenario, previews, writes: posts.map(([, endpoint, data]) => [endpoint, data.mode ?? data.enabled ?? "ordinary"]), passed: true }));
  } catch (error) {
    await page.screenshot({ path: path.join(output, `winter-failed-${width}-${scenario}.png`), fullPage: true });
    console.error({ width, scenario, errors, unexpected, output });
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "gymtools-winter-browser-"));
  await build(output);
  const cssRoot = process.env.CONTACT_CONVERSION_CSS_DIR || path.join(root, ".next/static/css");
  const css = fs.readdirSync(cssRoot).filter(name => name.endsWith(".css"))
    .map(name => fs.readFileSync(path.join(cssRoot, name), "utf8")).join("\n");
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(fs.readFileSync(path.join(output, "fixture.js"))); }
    else if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
    else if (req.url === "/fixture-photo.png") { res.setHeader("Content-Type", "image/png"); res.end(fs.readFileSync(path.join(root, "public/icon-192x192.png"))); }
    else if (req.url.startsWith("/api/")) { res.writeHead(500); res.end("Unmocked fixture API"); }
    else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const origin = "http://127.0.0.1:" + server.address().port;
    for (const width of widths) for (const scenario of scenarios) await runCase(browser, origin, output, width, scenario);
    console.log(JSON.stringify({ passed: widths.length * scenarios.length, productionRequests: 0 }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
