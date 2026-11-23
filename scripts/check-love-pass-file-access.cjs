/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const userId = "10000000-0000-4000-8000-000000000001";
const ownerId = "10000000-0000-4000-8000-000000000002";
const cardId = "20000000-0000-4000-8000-000000000001";
const rawPath = `cards/${ownerId}/raw/mock-0.jpg`;
const litePath = `cards/${ownerId}/lite/mock-0.webp`;

function loadRoute(file, mocks) {
  const moduleShim = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  new Function("require", "module", "exports", compiled)((moduleId) => {
    if (!Object.hasOwn(mocks, moduleId)) throw new Error(`Unexpected import: ${moduleId}`);
    return mocks[moduleId];
  }, moduleShim, moduleShim.exports);
  return moduleShim.exports;
}

function photoFixture(options = {}) {
  const calls = [];
  const snapshot = { owner_user_id: ownerId, photo_visibility: "public", photo_paths: [rawPath] };
  const image = options.image ?? new Blob([Buffer.alloc(64)], { type: "image/jpeg" });
  const admin = {
    async rpc(name, args) {
      calls.push(name);
      assert.equal(name, "get_dating_love_pass_card_photo_snapshot");
      assert.deepEqual(args, { p_card_id: cardId });
      return { data: options.reviewApproved === false ? null : snapshot };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "dating-card-photos");
        return { async download(path) {
          calls.push(path);
          const data = path === rawPath ? image : options.litePhoto ?? null;
          return { data, error: data ? null : new Error("missing derivative") };
        } };
      },
    },
  };
  const route = loadRoute("app/api/dating/love-pass/photo/route.ts", {
    "@/lib/dating-love-pass-access": { async hasLovePassNearbyCardAccess(internal, user, target) {
      assert.equal(internal, admin);
      assert.equal(user, userId);
      assert.equal(target, cardId);
      calls.push("authorization");
      return options.eligible !== false;
    } },
    "@/lib/dating-love-pass-photos": { getLovePassPhotoPaths(card) {
      assert.equal(card, snapshot);
      return card.photo_paths;
    } },
    "@/lib/request-rate-limit": { async checkRouteRateLimit() {
      calls.push("limit");
      return { allowed: options.limited !== true, retryAfterSec: 20 };
    }, extractClientIp() { return "127.0.0.1"; } },
    "@/lib/supabase/request": { async getRequestAuthContext() { return { user: options.guest ? null : { id: userId } }; } },
    "@/lib/supabase/server": { createAdminClient() { return admin; } },
  });
  return { calls, request: () => route.GET(new Request(`http://localhost/api/dating/love-pass/photo?cardId=${cardId}&slot=0`)) };
}

test("only a currently authorized viewer can read an already-reviewed photograph, never cache it", async () => {
  const fixture = photoFixture();
  const response = await fixture.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(fixture.calls, ["limit", "get_dating_love_pass_card_photo_snapshot", "authorization", rawPath]);

  for (const [options, status, calls] of [
    [{ guest: true }, 404, []],
    [{ limited: true }, 429, ["limit"]],
    [{ reviewApproved: false }, 404, ["limit", "get_dating_love_pass_card_photo_snapshot"]],
    [{ eligible: false }, 404, ["limit", "get_dating_love_pass_card_photo_snapshot", "authorization"]],
  ]) {
    const fixture = photoFixture(options);
    const response = await fixture.request();
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(fixture.calls, calls);
  }
});

test("large stored images use a private smaller derivative without exposing a storage URL", async () => {
  const fixture = photoFixture({
    image: new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: "image/jpeg" }),
    litePhoto: new Blob([Buffer.alloc(64)], { type: "image/webp" }),
  });
  const response = await fixture.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/webp");
  assert.deepEqual(fixture.calls.slice(-2), [rawPath, litePath]);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

function uploadFixture({ status = "pending", legacy = false, pass = false } = {}) {
  const calls = [];
  const card = { id: cardId, owner_user_id: ownerId, sex: "female", region: "서울", status, expires_at: "2099-01-01" };
  const admin = {
    from(table) {
      assert.equal(table, "dating_cards");
      const query = { select: () => query, eq: () => query, single: async () => ({ data: card }) };
      return query;
    },
    storage: { from() { return { async upload(objectPath) { calls.push(objectPath); return { error: null }; } }; } },
  };
  const route = loadRoute("app/api/dating/cards/upload/route.ts", {
    "@/lib/supabase/server": { createAdminClient() { return admin; } },
    "@/lib/dating-more-view": { async hasMoreViewAccess() { return false; } },
    "@/lib/dating-city-view": { async hasCityViewCardAccess() { return legacy; } },
    "@/lib/dating-love-pass-access": { async hasLovePassNearbyCardAccess(internal, id, target) {
      assert.equal(internal, admin);
      assert.equal(id, userId);
      assert.equal(target, cardId);
      calls.push("pass gate");
      return pass;
    } },
    "next/server": { NextResponse: Response },
    "@/lib/supabase/request": { async getRequestAuthContext() { return { user: { id: userId } }; } },
    "@/lib/request-origin": { ensureAllowedMutationOrigin() { return null; } },
    sharp() { const result = { rotate: () => result, resize: () => result, webp: () => result, toBuffer: async () => Buffer.alloc(20) }; return result; },
  });
  return { calls, async request() {
    const form = new FormData();
    form.set("cardId", cardId);
    form.set("file", new File([Buffer.alloc(12)], "test.jpg", { type: "image/jpeg" }));
    return route.POST(new Request("http://localhost/api/dating/cards/upload", { method: "POST", body: form }));
  } };
}

test("application photo upload accepts a pass-only eligible pending card and does not change old routes", async () => {
  for (const [options, status, gate] of [
    [{}, 400, true],
    [{ pass: true }, 201, true],
    [{ legacy: true }, 201, false],
    [{ status: "public" }, 201, false],
  ]) {
    const fixture = uploadFixture(options);
    const response = await fixture.request();
    assert.equal(response.status, status);
    assert.equal(fixture.calls.includes("pass gate"), gate);
    const stored = fixture.calls.filter(call => call.startsWith(`card-applications/${userId}/${cardId}/`));
    assert.equal(stored.length, status === 201 ? 1 : 0);
  }
});
