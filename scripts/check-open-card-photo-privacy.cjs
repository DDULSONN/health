/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const owner = "fixture-owner";
const viewer = "fixture-viewer";
const blur = `cards/${owner}/blur/mock.webp`;
const raw = `cards/${owner}/raw/mock.jpg`;
const lite = `cards/${owner}/lite/mock.webp`;

function load(file, mocks = {}, fetchMock = () => assert.fail("Unexpected upstream fetch")) {
  const out = {};
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  new Function("exports", "require", "fetch", "console", outputText)(out, name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === "@/lib/images" || name === "@/lib/dating-card-photo-visibility") return load(name.slice(2) + ".ts");
    assert.fail(`Unexpected import: ${name}`);
  }, fetchMock, { log() {}, warn() {} });
  return out;
}

function fixture({ visibility = "blur", blurredPaths = [blur], blurredThumb = null, status = "pending", allowed = true, dbError = null, viewerId = viewer, missingLite = false } = {}) {
  const row = { id: "card", owner_user_id: owner, sex: "female", status, region: "서울", expires_at: "2099-01-01", photo_visibility: visibility, photo_paths: [raw], blur_paths: blurredPaths, blur_thumb_path: blurredThumb };
  const calls = [];
  const admin = { from(table) {
    const chain = { select: () => chain, eq: () => chain, or: () => chain, limit: async () => ({data: table === "dating_cards" ? [row] : []}) };
    chain.single = async () => dbError ? { data: null, error: dbError } : { data: row };
    chain.maybeSingle = async () => ({ data: table === "profiles" ? { phone_verified: true } : null });
    return chain;
  }, storage: { from: () => ({ getPublicUrl: key => ({ data: { publicUrl: `https://fixture.invalid/${key}` } }) }) } };
  const mocks = {
    "next/server": { NextResponse: Response },
    "@/lib/supabase/request": { getRequestAuthContext: async () => ({ user: viewerId ? { id: viewerId } : null }) },
    "@/lib/supabase/server": { createAdminClient: () => admin },
    "@/lib/dating-more-view": { hasMoreViewAccess: async () => allowed, normalizeCardSex: s => s },
    "@/lib/dating-city-view": { hasCityViewCardAccess: async () => false },
    "@/lib/dating-blocks": { hasDatingBlockBetween: async () => false },
    "@/lib/dating-contact-blocks": { hasDatingContactBlockBetween: async () => false },
    "@/lib/dating-love-pass-access": { hasLovePassNearbyCardAccess: async () => false },
    "@/lib/dating-love-pass-photos": { getLovePassPhotoPaths: () => [] },
    "@/lib/request-rate-limit": { checkRouteRateLimit: async () => ({ allowed: true }), extractClientIp: () => null },
    "@/lib/edge-kv": { kvGetString: async () => null, kvSetString: async () => {} },
    "@/lib/admin": { isAllowedAdminUser: () => false },
    "@/lib/signed-url-cache": {
      getCachedSignedUrlWithBucket: async ({ bucket, path: key }) => {
        calls.push([bucket, key]);
        return { url: missingLite && key === lite ? "" : `https://fixture.invalid/${key}` };
      },
    },
    sharp: () => assert.fail("Unexpected image processing"),
  };
  const detail = load("app/api/dating/cards/[id]/route.ts", mocks);
  const proxy = load("app/i/[...slug]/route.ts", mocks, async (url, {method}) => new Response(method === "HEAD" ? null : url, { headers: { "Content-Type": "image/webp" } }));
  return {
    calls,
    detail: () => detail.GET(new Request("https://fixture.invalid/api/dating/cards/card"), { params: Promise.resolve({ id: "card" }) }),
    image: (key, { method = "GET", mode = "signed", bucket = "dating-card-photos", preview = false } = {}) =>
      proxy[method](new Request("https://fixture.invalid/i/photo" + (preview ? "?preview=1" : ""), { method }), {
        params: Promise.resolve({ slug: [mode, bucket, ...key.split("/")] }),
      }),
  };
}

test("missing or invalid blur metadata yields no visible image rather than an unblurred fallback", async () => {
  for (const metadata of [{ blurredPaths: [] }, { blurredPaths: [raw], blurredThumb: lite }, { blurredPaths: [blur.replace(owner, "other-owner")] }]) {
    const response = await fixture(metadata).detail();
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).card.image_urls, []);
  }
  const response = await fixture().detail();
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual((await response.json()).card.image_urls.map(url => new URL(url, "https://fixture.invalid").pathname), ["/i/signed/dating-card-photos/" + blur]);
});

test("permitted photo reads remain no-store on both GET and HEAD", async () => {
  const f = fixture();
  for (const method of ["GET", "HEAD"]) {
    const response = await f.image(blur, { method });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.match(response.headers.get("Vary"), /Authorization/);
  }
  assert.deepEqual(f.calls, [["dating-card-photos", blur], ["dating-card-photos", blur]]);
});

test("non-public photos require a genuine blurred asset; alternate image sizes do not change permission", async () => {
  const f = fixture();
  for (const photo of [raw, lite]) {
    const response = await f.image(photo);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  assert.deepEqual(f.calls, []);
  assert.equal((await fixture({ allowed: false }).image(blur)).status, 404);
});

test("an explicitly public photo continues to show using an optimized protected preview", async () => {
  const f = fixture({ visibility: "public", status: "public" });
  const response = await f.detail();
  assert.match((await response.json()).card.image_urls[0], /preview=1/);
  const preview = await f.image(raw, { preview: true });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(f.calls, [["dating-card-photos", lite]]);
  const ownerView = fixture({ viewerId: owner });
  assert.equal((await ownerView.image(raw)).status, 200);
  assert.deepEqual(ownerView.calls, [["dating-card-photos", raw]]);
});

test("authorized previously public photographs without a derivative still render", async () => {
  const f = fixture({ visibility: "public", status: "public", missingLite: true });
  const response = await f.image(raw, { preview: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(f.calls, [["dating-card-photos", lite], ["dating-card-photos", raw]]);
});

test("Quick Match uses genuine blurred images for previews without public or connection access", () => {
  const { pickPreviewImage } = load("lib/dating-swipe.ts", {
    "@/lib/dating-open": {},
    "@/lib/dating-blocks": {},
    "@/lib/dating-contact-blocks": {},
    "@/lib/supabase/server": {},
    "@/lib/marketing-email": {},
    "@/lib/dating-open-quick-pass": { OPEN_QUICK_PASS: { swipe: { likeLimit: 50 } } },
  });
  const card = { owner_user_id: owner, photo_visibility: "public", expires_at: "2099-01-01", photo_paths: [raw], blur_paths: [blur] };
  assert.match(pickPreviewImage({ ...card, status: "public" }), /preview=1/);
  assert.match(pickPreviewImage({ ...card, status: "pending" }), /\/blur\//);
  assert.match(pickPreviewImage({ ...card, status: "pending" }, true), /preview=1/);
  assert.equal(pickPreviewImage({ ...card, photo_visibility: "blur", status: "public", blur_paths: [lite] }), null);
});

test("temporary card read failure is retryable while a missing card stays missing", async () => {
  assert.equal((await fixture({ dbError: { code: "57014" } }).detail()).status, 503);
  assert.equal((await fixture({ dbError: { code: "PGRST116" } }).detail()).status, 404);
});

test("service worker sends signed and admin images to the network before generic caching", () => {
  const config = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
  assert.match(config, /urlPattern: [^\n]*admin-preview[^\n]*\n\s*handler: "NetworkOnly"/);
  assert.ok(config.indexOf('"NetworkOnly"') < config.indexOf('"StaleWhileRevalidate"'));
});
