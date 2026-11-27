/* eslint-disable @typescript-eslint/no-require-imports */
// Execute the real proxy handler with synthetic storage responses; no network.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const applicant = "00000000-0000-4000-8000-000000000001";
const publicPhoto = "example/photo.jpg";
const applicationPhoto = `card-applications/${applicant}/photo.jpg`;
const routeSource = fs.readFileSync(path.join(__dirname, "../app/i/[...slug]/route.ts"), "utf8");
const { outputText } = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
});
const original = Uint8Array.of(255, 216, 255, 224, 100, 101, 255, 217);
const optimized = Uint8Array.of(82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80);

function fixture({ userId, admin = false, failTransform = false, failRead = false } = {}) {
  const calls = [];
  const url = "https://storage.invalid/signed";
  const exports = {};
  const modules = {
    "@/lib/signed-url-cache": { getCachedSignedUrlWithBucket: async ({ bucket, path: objectPath }) => {
      calls.push(["sign", bucket, objectPath]);
      return { url };
    } },
    "@/lib/supabase/request": { getRequestAuthContext: async () => ({ user: userId ? { id: userId } : null }) },
    "@/lib/supabase/server": { createAdminClient: () => ({}) },
    "@/lib/admin": { isAllowedAdminUser: () => admin },
    "@/lib/dating-blocks": {},
    "@/lib/dating-contact-blocks": {},
    "@/lib/dating-city-view": {},
    "@/lib/dating-more-view": {},
    "@/lib/dating-card-photo-visibility": {},
    "@/lib/images": {},
    sharp: (bytes, options) => {
      assert.deepEqual(Uint8Array.from(bytes), original);
      assert.equal(options.limitInputPixels, 33_000_000);
      calls.push(["optimize"]);
      const transform = {
        rotate: () => transform,
        resize: () => transform,
        webp: () => transform,
        toBuffer: async () => {
          if (failTransform) throw new Error("fixture conversion failure");
          return Buffer.from(optimized);
        },
      };
      return transform;
    },
  };
  const fetch = async (signedUrl, options) => {
    assert.equal(signedUrl, url);
    assert.equal(options.cache, "no-store");
    calls.push(["fetch", options.method]);
    const body = failRead ? new ReadableStream({ start(controller) {
      controller.enqueue(original.subarray(0, 3));
      controller.error(new Error("fixture truncated store response"));
    } }) : original;
    return new Response(options.method === "HEAD" ? null : body, {
      headers: { "Content-Type": "image/jpeg", "Content-Length": String(original.byteLength),
        ETag: '"fixture-etag"', "Set-Cookie": "upstream=fixture" },
    });
  };
  new Function("exports", "require", "fetch", "console", outputText)(exports, name => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`);
    return modules[name];
  }, fetch, { log() {}, warn() {} });
  return {
    calls,
    get(bucket = "community", target = publicPhoto, { method = "GET", query = "" } = {}) {
      return exports[method](new Request("https://fixture.invalid/i/signed/" + bucket + "/" + target + query, { method }), {
        params: Promise.resolve({ slug: ["signed", bucket, ...target.split("/")] }),
      });
    },
  };
}

test("a failed optimization returns the exact consumed original bytes without fetching it again", async () => {
  const f = fixture({ failTransform: true });
  const res = await f.get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "image/jpeg");
  assert.equal(res.headers.get("Content-Length"), String(original.byteLength));
  assert.equal(res.headers.get("ETag"), '"fixture-etag"');
  assert.equal(res.headers.get("Set-Cookie"), null);
  assert.match(res.headers.get("Cache-Control"), /^public, max-age=86400,/);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), original);
  assert.deepEqual(f.calls, [["sign", "community", publicPhoto], ["fetch", "GET"], ["optimize"]]);
});

test("a failed upstream read returns a no-store 502 instead of a partial image or disturbed stream", async () => {
  const f = fixture({ failRead: true });
  const res = await f.get();
  assert.equal(res.status, 502);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.doesNotMatch(res.headers.get("Content-Type"), /^image\//);
  assert.equal(await res.text(), "Bad Gateway");
  assert.deepEqual(f.calls, [["sign", "community", publicPhoto], ["fetch", "GET"]]);
});

test("a successful conversion, opt-out of optimization, and HEAD keep existing behavior", async () => {
  const f = fixture();
  const converted = await f.get();
  assert.equal(converted.headers.get("Content-Type"), "image/webp");
  assert.deepEqual(new Uint8Array(await converted.arrayBuffer()), optimized);
  const full = await f.get("community", publicPhoto, { query: "?full=1" });
  assert.equal(full.headers.get("Content-Type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), original);
  const head = await f.get("community", publicPhoto, { method: "HEAD" });
  assert.equal(head.headers.get("Content-Length"), String(original.byteLength));
  assert.equal(head.body, null);
  assert.deepEqual(f.calls.filter(v => v[0] === "optimize"), [["optimize"]]);
});

test("only authorized application photos can fall back and still cannot be cached across accounts", async () => {
  const bucket = "dating-apply-photos";
  const guest = fixture({ failTransform: true });
  assert.equal((await guest.get(bucket, applicationPhoto)).status, 404);
  assert.deepEqual(guest.calls, []);
  const owner = fixture({ userId: applicant, failTransform: true });
  const res = await owner.get(bucket, applicationPhoto);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  assert.match(res.headers.get("Vary"), /Authorization/);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), original);
  const staff = fixture({ userId: applicant, admin: true, failTransform: true });
  assert.equal((await staff.get(bucket, "admin-application-backups/fixture.jpg")).status, 404);
  assert.deepEqual(staff.calls, []);
});
