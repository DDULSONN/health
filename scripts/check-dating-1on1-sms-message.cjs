const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const source = fs.readFileSync(path.join(process.cwd(), "lib/dating-1on1-sms.ts"), "utf8");
const match = source.match(/ONE_ON_ONE_SELECTION_SMS_TEXT\s*=\s*("(?:[^"\\]|\\.)*")/);

test("1:1 request SMS stays valid Korean UTF-8 and concise", () => {
  assert.ok(match, "SMS constant was not found");
  const message = JSON.parse(match[1]);
  assert.equal(
    message,
    "[짐툴] 1:1 요청이 도착했어요. 마이페이지에서 확인해주세요.\nhelchang.com/mypage",
  );
  assert.equal(Buffer.from(message, "utf8").toString("utf8"), message);
  assert.equal(message.includes("�"), false);
  assert.ok(message.length <= 80, `SMS is too long: ${message.length} characters`);
});

function loadSmsModule(overrides) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    throw new Error(`Unexpected SMS test import: ${name}`);
  };
  new Function("require", "module", "exports", output)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

function createDeliveryAdmin() {
  const deliveries = new Map();
  const statusUpdates = [];
  return {
    deliveries,
    statusUpdates,
    from(table) {
      assert.equal(table, "dating_1on1_sms_deliveries");
      const query = { filters: [] };
      const builder = {
        insert(values) { query.insert = values; return builder; },
        select() { return builder; },
        update(values) { query.update = values; return builder; },
        eq(key, value) { query.filters.push([key, value]); return builder; },
        async maybeSingle() {
          const key = `${query.insert.match_id}:${query.insert.recipient_user_id}:${query.insert.event_kind}`;
          if (deliveries.has(key)) return { data: null, error: { code: "23505", message: "duplicate" } };
          const row = { id: `delivery-${deliveries.size + 1}`, ...query.insert };
          deliveries.set(key, row);
          return { data: { id: row.id }, error: null };
        },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (query.update) statusUpdates.push(query.update);
            return { data: null, error: null };
          }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function createSmsHarness({ memberBlocked = false, contactBlocked = false, unsubscribed = false, providerFails = false } = {}) {
  const admin = createDeliveryAdmin();
  const sent = [];
  const sms = loadSmsModule({
    "@/lib/dating-1on1": {
      getProfilePhoneVerification: async () => ({ phoneVerified: true, phoneE164: "+821012345678" }),
    },
    "@/lib/dating-blocks": { hasDatingBlockBetween: async () => memberBlocked },
    "@/lib/dating-contact-blocks": { hasDatingContactPhoneBlockBetween: async () => contactBlocked },
    "@/lib/marketing-email": {
      fetchMarketingUnsubscribedUserIds: async () => unsubscribed ? new Set(["recipient"]) : new Set(),
    },
    "@/lib/solapi-phone-verification": {
      isSolapiPhoneOtpConfigured: () => true,
      sendSolapiTextMessage: async (payload) => {
        sent.push(payload);
        if (providerFails) throw new Error("provider unavailable");
      },
    },
  });
  return { admin, sent, send: () => sms.sendOneOnOneSelectionSms(admin, {
    matchId: "match-1",
    sourceUserId: "source",
    recipientUserId: "recipient",
  }) };
}

test("1:1 SMS is sent once and duplicate delivery is suppressed", async () => {
  const harness = createSmsHarness();
  assert.equal(await harness.send(), true);
  assert.equal(await harness.send(), false);
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].text, JSON.parse(match[1]));
  assert.equal(harness.admin.statusUpdates.at(-1).status, "sent");
});

test("1:1 SMS respects member, contact and notification opt-out blocks", async () => {
  for (const option of [{ memberBlocked: true }, { contactBlocked: true }, { unsubscribed: true }]) {
    const harness = createSmsHarness(option);
    assert.equal(await harness.send(), false);
    assert.equal(harness.sent.length, 0);
    assert.equal(harness.admin.deliveries.size, 0);
  }
});

test("SMS provider failure never fails matching and is recorded", async () => {
  const harness = createSmsHarness({ providerFails: true });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await harness.send(), false);
  } finally {
    console.error = originalError;
  }
  assert.equal(harness.admin.statusUpdates.at(-1).status, "failed");
});
