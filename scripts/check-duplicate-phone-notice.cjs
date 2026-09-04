const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const source = fs.readFileSync(path.join(process.cwd(), "lib/duplicate-phone-notice.ts"), "utf8");
const cronSource = fs.readFileSync(
  path.join(process.cwd(), "app/api/cron/duplicate-phone-notices/route.ts"),
  "utf8",
);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", output)(require, loaded, loaded.exports);
const notice = loaded.exports;

test("duplicate phone notice is delayed for two minutes", () => {
  assert.equal(notice.DUPLICATE_PHONE_NOTICE_DELAY_MS, 120_000);
});

test("notice contains no email hint and keeps valid Korean UTF-8", () => {
  const message = notice.DUPLICATE_PHONE_NOTICE_TEXT;
  assert.equal(Buffer.from(message, "utf8").toString("utf8"), message);
  assert.equal(message.includes("�"), false);
  assert.equal(message.includes("@"), false);
  assert.equal(message.includes("이메일"), false);
  assert.match(message, /본인이 아니라면 무시/);
  assert.match(message, /https:\/\/helchang\.com\/account-recovery/);
});

test("queue metadata never stores the phone number or email", () => {
  const queuedAt = Date.parse("2026-09-04T00:00:00.000Z");
  const meta = notice.buildDuplicatePhoneNoticeMeta("owner-id", queuedAt);
  assert.deepEqual(meta, {
    duplicate_notice_status: "pending",
    duplicate_notice_delay_seconds: 120,
    duplicate_notice_scheduled_for: "2026-09-04T00:02:00.000Z",
    duplicate_phone_owner_user_id: "owner-id",
  });
  assert.equal(notice.isDuplicatePhoneNoticeDue(meta, queuedAt + 119_999), false);
  assert.equal(notice.isDuplicatePhoneNoticeDue(meta, queuedAt + 120_000), true);
  assert.equal(JSON.stringify(meta).includes("phone_e164"), false);
  assert.equal(JSON.stringify(meta).includes("email"), false);
});

test("delivery verifies the current phone and suppresses repeats", () => {
  assert.match(cronSource, /owner\.data\?\.phone_verified/);
  assert.match(cronSource, /hashPhoneForVerificationStorage\(phoneE164\) !== row\.phone_hash/);
  assert.match(cronSource, /COOLDOWN_24H/);
  assert.match(cronSource, /SOURCE_COOLDOWN_24H/);
  assert.match(cronSource, /duplicate_notice_status: "pending"/);
});
