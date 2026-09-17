/* eslint-disable @typescript-eslint/no-require-imports */
// Offline regression checks only: no real API, account, payment or cron execution.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const sharp = require("sharp");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const asset = "/mascot/jimnyang-guide-v2.webp";
const originalPath = path.join(root, "public/mascot/jimnyang-guide-v2.png");
const optimizedPath = path.join(root, "public", asset);

test("only the retired BodyBattle schedule is removed", () => {
  const config = JSON.parse(read("vercel.json"));
  assert.equal(config.buildCommand, "next build --webpack");
  assert.deepEqual(config.crons, [
    { path: "/api/cron/weekly-winners", schedule: "0 15 * * 0" },
    { path: "/api/cron/admin-outreach-mail-jobs", schedule: "* * * * *" },
    { path: "/api/cron/duplicate-phone-notices", schedule: "* * * * *" },
    { path: "/api/cron/community-fit-room-cleanup", schedule: "17 */6 * * *" },
    { path: "/api/cron/dating-apply-photo-backups-cleanup", schedule: "43 18 * * *" },
    { path: "/api/cron/dating-application-reminders", schedule: "8 * * * *" },
    { path: "/api/cron/dating-1on1-match-reminders", schedule: "18 * * * *" },
    { path: "/api/cron/dating-registration-reminders", schedule: "28 * * * *" },
    { path: "/api/cron/dating-open-card-activity", schedule: "38 */3 * * *" },
    { path: "/api/cron/dating-1on1-card-review", schedule: "0 */12 * * *" },
    { path: "/api/cron/nickname-review", schedule: "15 15 * * *" },
    { path: "/api/cron/public-reactions", schedule: "0 0 * * *" },
  ]);
});

test("the retired endpoint still returns Gone for old callers", () => {
  assert.match(read("app/api/cron/bodybattle-season/route.ts"), /status:\s*410/);
  assert.match(read("middleware.ts"), /pathname === "\/api\/cron\/bodybattle-season"/);
});

for (const file of [
  "lib/site-guide-mascot.ts",
  "components/SiteGuideBubble.tsx",
  "app/community/dating/cards/page.tsx",
  "app/mypage/page.tsx",
]) {
  test("WebP is used in " + file, () => {
    assert.ok(read(file).includes(asset));
    assert.ok(!read(file).includes("/mascot/jimnyang-guide-v2.png"));
  });
}

test("only the pre-optimized default mascot skips runtime image transformations", () => {
  assert.ok(read("components/SiteGuideBubble.tsx").includes(
    "unoptimized={mascotSrc === DEFAULT_MASCOT_SRC}"
  ));
});

const compiled = ts.transpileModule(read("lib/site-guide-mascot.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", compiled)(
  (name) => {
    assert.equal(name, "@/lib/supabase/server");
    return { createAdminClient: () => { throw new Error("No database calls permitted"); } };
  },
  mod,
  mod.exports
);
const { normalizeSiteGuideMascotSetting: normalize } = mod.exports;

for (const value of [null, {}, { selectedId: "default" }, { id: "default" }, { selectedId: "missing" }]) {
  test("existing/default settings resolve the optimized mascot: " + JSON.stringify(value), () => {
    const result = normalize(value);
    assert.equal(result.selectedId, "default");
    assert.equal(result.selected.src, asset);
  });
}
for (const selectedId of ["summer", "rain"]) {
  test("seasonal selection is preserved: " + selectedId, () => {
    const result = normalize({ selectedId });
    assert.equal(result.selectedId, selectedId);
    assert.equal(result.selected.src, "/mascot/jimnyang-" + selectedId + ".webp");
  });
}

test("uploaded mascot selection is unchanged", () => {
  const option = {
    id: "custom-fixture",
    label: "Fixture",
    src: "/i/public-lite/community/site-guide-mascots/fixture.webp",
  };
  const result = normalize({ selectedId: option.id, customOptions: [option] });
  assert.deepEqual(result.selected, option);
});

test("old PNG stays available and WebP is under 10% of its byte size", async () => {
  const original = await sharp(originalPath).metadata();
  const optimized = await sharp(optimizedPath).metadata();
  assert.equal(original.format, "png");
  assert.equal(optimized.format, "webp");
  assert.equal(optimized.width, 512);
  assert.equal(optimized.height, 768);
  assert.equal(optimized.width / optimized.height, original.width / original.height);
  assert.equal(optimized.hasAlpha, original.hasAlpha);
  const oldBytes = fs.statSync(originalPath).size;
  const newBytes = fs.statSync(optimizedPath).size;
  assert.ok(newBytes < oldBytes * 0.1);
  assert.ok(newBytes < 50 * 1024);
  console.log(JSON.stringify({
    originalBytes: oldBytes,
    optimizedBytes: newBytes,
    reductionPercent: Number(((1 - newBytes / oldBytes) * 100).toFixed(2)),
  }));
});

test("compression preserves transparency and low pixel error without cropping", async () => {
  const reference = await sharp(originalPath).resize({ width: 512 }).ensureAlpha().raw().toBuffer();
  const optimized = await sharp(optimizedPath).ensureAlpha().raw().toBuffer();
  assert.equal(optimized.length, reference.length);
  let totalError = 0;
  let alphaMaxError = 0;
  for (let index = 0; index < optimized.length; index++) {
    const error = Math.abs(reference[index] - optimized[index]);
    totalError += error;
    if (index % 4 === 3) alphaMaxError = Math.max(alphaMaxError, error);
  }
  assert.ok(totalError / optimized.length < 6, "Unexpected visual loss");
  assert.ok(alphaMaxError <= 1, "Transparency changed");
});
