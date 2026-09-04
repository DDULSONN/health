/* eslint-disable @typescript-eslint/no-require-imports -- focused regression test */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const storage = new Map();
global.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
};

const draftSource = fs.readFileSync(path.join(root, "lib/profile-draft.ts"), "utf8");
const draftOutput = ts.transpileModule(draftSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const draftModule = { exports: {} };
new Function("require", "module", "exports", draftOutput)(require, draftModule, draftModule.exports);
const drafts = draftModule.exports;

function loadBootstrapRoute(options = {}) {
  const routeSource = fs.readFileSync(path.join(root, "app/api/dating/profile-bootstrap/route.ts"), "utf8");
  const routeOutput = ts.transpileModule(routeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const results = {
    profiles: { data: { nickname: "테스터", phone_verified: true, swipe_profile_visible: false }, error: null },
    dating_cards: { data: [{ id: "card-1", status: "pending", display_nickname: "테스터", created_at: "2026-09-04T00:00:00Z" }], error: null },
    dating_1on1_cards: { data: null, error: null },
    site_settings: { data: { value_json: { enabled: true } }, error: null },
    dating_open_card_first_queue_boosts: { data: null, error: null },
    ...(options.results ?? {}),
  };
  let profileResultIndex = 0;
  let viewerSexCalls = 0;
  const resultFor = (table) => {
    if (table === "profiles" && Array.isArray(options.profileResults)) {
      const index = Math.min(profileResultIndex, options.profileResults.length - 1);
      profileResultIndex += 1;
      return options.profileResults[index];
    }
    return results[table];
  };
  const admin = {
    from(table) {
      const builder = {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle() { return Promise.resolve(resultFor(table)); },
        then(resolve, reject) { return Promise.resolve(resultFor(table)).then(resolve, reject); },
      };
      return builder;
    },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", routeOutput)(
    (name) => {
      if (name === "next/server") return require("next/server");
      if (name === "@/lib/admin") return { isAllowedAdminUser: () => options.isAdmin === true };
      if (name === "@/lib/dating-1on1-metrics") return { countCumulativeOneOnOneApplicants: async () => options.totalApplications ?? 42 };
      if (name === "@/lib/dating-1on1") return { getDatingOneOnOneWriteStatus: async () => options.writeStatus ?? "approved" };
      if (name === "@/lib/open-card-repost") return { recoverOpenCardRepostEntitlement: async () => undefined };
      if (name === "@/lib/dating-viewer-sex") return { resolveDatingViewerSex: async () => {
        viewerSexCalls += 1;
        if (options.viewerSexError) throw options.viewerSexError;
        return options.viewerSexResolution ?? { status: "resolved", viewerSex: "male", targetSex: "female", source: "metadata" };
      } };
      if (name === "@/lib/supabase/server") return { createAdminClient: () => admin };
      if (name === "@/lib/supabase/request") return { getRequestAuthContext: async () => ({ user: options.user === null ? null : { id: "user-1", email: "test@example.com" } }) };
      return require(name);
    },
    loaded,
    loaded.exports,
  );
  loaded.exports.__getTestStats = () => ({ profileResultIndex, viewerSexCalls });
  return loaded.exports;
}

function loadBootstrapClient(fetchImpl) {
  const source = fs.readFileSync(path.join(root, "lib/dating-profile-bootstrap-client.ts"), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "fetch", output)(require, loaded, loaded.exports, fetchImpl);
  return loaded.exports;
}

test("profile drafts are isolated per account, expire, and clear safely", () => {
  storage.clear();
  const now = Date.UTC(2026, 8, 4, 12, 0, 0);
  assert.equal(drafts.writeProfileDraft("one-on-one", "user-a", { name: "테스트" }, now), true);
  assert.equal(drafts.readProfileDraft("one-on-one", "user-a", now + 1_000).value.name, "테스트");
  assert.equal(drafts.readProfileDraft("one-on-one", "user-b", now + 1_000), null);
  assert.equal(drafts.readProfileDraft("one-on-one", "user-a", now + drafts.PROFILE_DRAFT_TTL_MS + 1), null);
  assert.equal(storage.size, 0);

  assert.equal(drafts.writeProfileDraft("one-on-one", "user-a", { name: "future" }, now + 10 * 60 * 1000), true);
  assert.equal(drafts.readProfileDraft("one-on-one", "user-a", now), null);

  drafts.writeProfileDraft("open-card", "user-a", { region: "서울" }, now);
  drafts.clearProfileDraft("open-card", "user-a");
  assert.equal(drafts.readProfileDraft("open-card", "user-a", now), null);

  drafts.writeProfileDraft("open-card", "user-a", { region: "서울" }, now);
  const storedKey = [...storage.keys()][0];
  storage.set(storedKey, "{broken-json");
  assert.equal(drafts.readProfileDraft("open-card", "user-a", now), null);
  assert.equal(storage.size, 0);

  const workingStorage = global.window.localStorage;
  global.window.localStorage = {
    getItem() { throw new Error("storage blocked"); },
    setItem() { throw new Error("storage blocked"); },
    removeItem() { throw new Error("storage blocked"); },
  };
  assert.equal(drafts.readProfileDraft("open-card", "user-a", now), null);
  assert.equal(drafts.writeProfileDraft("open-card", "user-a", { region: "서울" }, now), false);
  assert.doesNotThrow(() => drafts.clearProfileDraft("open-card", "user-a"));
  global.window.localStorage = workingStorage;
});

test("bootstrap client deduplicates only concurrent requests and refetches later", async () => {
  let calls = 0;
  let releaseFirst;
  const response = { ok: true, json: async () => ({ profile: {}, openCards: {}, oneOnOne: {}, openWrite: {} }) };
  const client = loadBootstrapClient(() => {
    calls += 1;
    if (calls === 1) return new Promise((resolve) => { releaseFirst = () => resolve(response); });
    return Promise.resolve(response);
  });

  const first = client.loadDatingProfileBootstrap();
  const duplicate = client.loadDatingProfileBootstrap();
  assert.equal(calls, 1);
  releaseFirst();
  await Promise.all([first, duplicate]);
  await client.loadDatingProfileBootstrap();
  assert.equal(calls, 2);
});

test("home profile state is consolidated into one deduplicated request", () => {
  const route = fs.readFileSync(path.join(root, "app/api/dating/profile-bootstrap/route.ts"), "utf8");
  const client = fs.readFileSync(path.join(root, "lib/dating-profile-bootstrap-client.ts"), "utf8");
  const home = fs.readFileSync(path.join(root, "app/community/dating/cards/page.tsx"), "utf8");
  const onboarding = fs.readFileSync(path.join(root, "app/onboarding/dating/page.tsx"), "utf8");
  const guide = fs.readFileSync(path.join(root, "components/SiteGuideBubble.tsx"), "utf8");

  assert.equal((route.match(/getRequestAuthContext\(req\)/g) ?? []).length, 1);
  assert.match(route, /select\("nickname,phone_verified,swipe_profile_visible"\)/);
  assert.match(route, /select\("nickname,phone_verified"\)/);
  assert.match(route, /select\("id,status,display_nickname,created_at"\)/);
  assert.match(route, /getDatingOneOnOneWriteStatus\(admin\)/);
  assert.match(route, /resolveDatingViewerSex\(admin, user\)/);
  assert.doesNotMatch(route, /photo_paths|photo_preview_urls/);
  assert.match(client, /let inFlight:/);
  assert.match(client, /if \(!options\?\.force && inFlight\) return inFlight/);
  assert.match(home, /loadDatingProfileBootstrap\(\)/);
  assert.doesNotMatch(home, /fetch\("\/api\/dating\/1on1\/write-status"/);
  assert.match(onboarding, /loadDatingProfileBootstrap\(\)/);
  assert.match(guide, /loadDatingProfileBootstrap\(\)/);
});

test("profile bootstrap rejects guests and returns only compact member state", async () => {
  const guestRoute = loadBootstrapRoute({ user: null });
  const guestResponse = await guestRoute.GET(new Request("https://helchang.com/api/dating/profile-bootstrap"));
  assert.equal(guestResponse.status, 401);

  const route = loadBootstrapRoute();
  const response = await route.GET(new Request("https://helchang.com/api/dating/profile-bootstrap"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(body.profile.profile.phone_verified, true);
  assert.equal(body.profile.profile.swipe_profile_visible, false);
  assert.equal(body.oneOnOne.canWrite, true);
  assert.equal(body.oneOnOne.totalApplications, 42);
  assert.equal(body.openCards.items[0].can_first_queue_boost, true);
  assert.equal(body.audience.targetSex, "female");
  assert.equal("photo_paths" in body.openCards.items[0], false);
});

test("profile bootstrap keeps safe behavior across schema and state variants", async () => {
  const fallbackRoute = loadBootstrapRoute({
    profileResults: [
      { data: null, error: { message: "column swipe_profile_visible does not exist" } },
      { data: { nickname: "구형", phone_verified: true }, error: null },
    ],
  });
  const fallbackResponse = await fallbackRoute.GET(new Request("https://helchang.com/api/dating/profile-bootstrap"));
  const fallbackBody = await fallbackResponse.json();
  assert.equal(fallbackResponse.status, 200);
  assert.equal(fallbackBody.profile.profile.swipe_profile_visible, true);
  assert.equal(fallbackRoute.__getTestStats().profileResultIndex, 2);

  const inactiveRoute = loadBootstrapRoute({
    results: {
      profiles: { data: { nickname: "미인증", phone_verified: false, swipe_profile_visible: true }, error: null },
      dating_1on1_cards: { data: { status: "approved" }, error: null },
      site_settings: { data: null, error: { message: "temporary settings failure" } },
      dating_open_card_first_queue_boosts: { data: null, error: { code: "42P01", message: "missing table" } },
    },
  });
  const inactiveResponse = await inactiveRoute.GET(new Request("https://helchang.com/api/dating/profile-bootstrap"));
  const inactiveBody = await inactiveResponse.json();
  assert.equal(inactiveResponse.status, 200);
  assert.equal(inactiveBody.openWrite.enabled, true);
  assert.equal(inactiveBody.oneOnOne.canWrite, false);
  assert.equal(inactiveBody.oneOnOne.reason, "PHONE_NOT_VERIFIED");

  const unavailableRoute = loadBootstrapRoute({
    viewerSexResolution: { status: "unavailable", viewerSex: null, targetSex: null, source: null },
  });
  const unavailableResponse = await unavailableRoute.GET(new Request("https://helchang.com/api/dating/profile-bootstrap"));
  const unavailableBody = await unavailableResponse.json();
  assert.equal(unavailableResponse.status, 200);
  assert.equal(unavailableBody.audience.status, "unavailable");

  const adminRoute = loadBootstrapRoute({ isAdmin: true });
  const adminResponse = await adminRoute.GET(new Request("https://helchang.com/api/dating/profile-bootstrap"));
  const adminBody = await adminResponse.json();
  assert.equal(adminResponse.status, 200);
  assert.equal(adminBody.audience.status, "admin");
  assert.equal(adminBody.audience.canSwitchSex, true);
  assert.equal(adminRoute.__getTestStats().viewerSexCalls, 0);

  const requiredFailureRoute = loadBootstrapRoute({
    results: { dating_cards: { data: null, error: { message: "required query failed" } } },
  });
  const requiredFailureResponse = await requiredFailureRoute.GET(new Request("https://helchang.com/api/dating/profile-bootstrap"));
  assert.equal(requiredFailureResponse.status, 500);
  assert.equal(requiredFailureResponse.headers.get("cache-control"), "private, no-store");
});

test("1:1 home panel is a separate lazy chunk and ad settings use CDN caching", () => {
  const home = fs.readFileSync(path.join(root, "app/community/dating/cards/page.tsx"), "utf8");
  const panel = fs.readFileSync(path.join(root, "components/dating/OneOnOneHomePanel.tsx"), "utf8");
  const headerRoute = fs.readFileSync(path.join(root, "app/api/site/header-ad/route.ts"), "utf8");
  const adRoute = fs.readFileSync(path.join(root, "app/api/site/ad-inquiry/route.ts"), "utf8");
  const mascotRoute = fs.readFileSync(path.join(root, "app/api/site-guide/mascot/route.ts"), "utf8");
  const guide = fs.readFileSync(path.join(root, "components/SiteGuideBubble.tsx"), "utf8");

  assert.match(home, /dynamic\(\(\) => import\("@\/components\/dating\/OneOnOneHomePanel"\)/);
  assert.doesNotMatch(home, /function OneOnOneHomePanel\(/);
  assert.match(home, /homeFeatureTabReady/);
  assert.match(home, /homeFeatureTab !== "open_cards"/);
  assert.match(home, /homeFeatureTab !== "quick_match"/);
  assert.match(home, /homeFeatureTab !== "one_on_one"/);
  assert.match(panel, /export default function OneOnOneHomePanel\(/);
  assert.match(headerRoute, /sMaxAge: 60, staleWhileRevalidate: 300/);
  assert.match(adRoute, /sMaxAge: 60, staleWhileRevalidate: 300/);
  assert.match(mascotRoute, /sMaxAge: 60,[\s\S]*staleWhileRevalidate: 300/);
  assert.doesNotMatch(guide, /site-guide\/mascot", \{ cache: "no-store" \}/);
});

test("all profile forms keep valid Korean and expose resume controls", () => {
  for (const file of [
    "app/onboarding/dating/page.tsx",
    "app/dating/1on1/page.tsx",
    "app/community/dating/cards/new/page.tsx",
  ]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(source.includes("�"), false, `${file} contains a replacement character`);
    assert.match(source, /이어서 작성/);
    assert.match(source, /사진은 개인정보 보호를 위해 저장하지 않아요/);
    assert.match(source, /clearProfileDraft/);
  }
  assert.match(fs.readFileSync(path.join(root, "app/onboarding/dating/page.tsx"), "utf8"), /step > 0/);
  assert.match(fs.readFileSync(path.join(root, "app/dating/1on1/page.tsx"), "utf8"), /formStep > 1/);
  assert.match(fs.readFileSync(path.join(root, "app/community/dating/cards/new/page.tsx"), "utf8"), /formStep > 1/);
});
