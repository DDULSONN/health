/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
function plainModule(file) {
  const mod={exports:{}};
  new Function('exports', ts.transpileModule(fs.readFileSync(path.join(process.cwd(),file),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText)(mod.exports);
  return mod.exports;
}

const source = fs.readFileSync(path.join(process.cwd(), "lib/dating-1on1-sms.ts"), "utf8");
const match = source.match(/ONE_ON_ONE_SELECTION_SMS_TEXT\s*=\s*("(?:[^"\\]|\\.)*")/);

test("1:1 request SMS stays valid Korean UTF-8 and concise", () => {
  assert.ok(match, "SMS constant was not found");
  const message = JSON.parse(match[1]);
  assert.equal(
    message,
    "[짐툴] 1:1 요청이 도착했어요. 상대 프로필을 확인해 주세요.\nhelchang.com/mypage?section=matching",
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
    matchState: 'source_selected',
    from(table) {
      if (table === 'dating_1on1_match_proposals') return {
        select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{source_user_id:'source',candidate_user_id:'recipient',state:this.matchState},error:null}),
      };
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

function createSmsHarness({ memberBlocked = false, contactBlocked = false, unsubscribed = false, providerFails = false, deleted = false, missing = false, authError = false, unsafe = false, accepted = false, phoneChanged = false } = {}) {
  const admin = createDeliveryAdmin();
  admin.auth = { admin: { getUserById: async (id) => {
    assert.equal(id, "recipient");
    return { data: { user: missing ? null : { id, deleted_at: deleted ? "2026-09-07" : null } }, error: authError ? new Error("unavailable") : null };
  } } };
  const sent = [];
  let phoneReads = 0;
  const sms = loadSmsModule({
    '@/lib/dating-1on1-delivery-guard': { canDeliverOneOnOneNotification: async () => !unsafe },
    '@/lib/dating-1on1-match-navigation': plainModule('lib/dating-1on1-match-navigation.ts'),
    '@/lib/dating-1on1-notification-guard': plainModule('lib/dating-1on1-notification-guard.ts'),
    "@/lib/dating-1on1": {
      getProfilePhoneVerification: async () => ({ phoneVerified: true, phoneE164: phoneChanged && ++phoneReads > 1 ? "+821087654321" : "+821012345678" }),
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
  if (accepted) admin.matchState = 'mutual_accepted';
  return { admin, sent, send: () => (accepted ? sms.sendOneOnOneAcceptedSms : sms.sendOneOnOneSelectionSms)(admin, {
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

test("deleted, missing and unverifiable accounts never receive SMS", async () => {
  for (const option of [{ deleted: true }, { missing: true }, { authError: true }]) {
    const harness = createSmsHarness(option);
    assert.equal(await harness.send(), false);
    assert.equal(harness.sent.length, 0);
    assert.equal(harness.admin.statusUpdates.at(-1).provider_error, "RECIPIENT_UNAVAILABLE");
  }
});

test('request ended after reservation never sends an obsolete SMS',async()=>{
  const harness=createSmsHarness();harness.admin.matchState='source_skipped';
  assert.equal(await harness.send(),false);assert.equal(harness.sent.length,0);
  assert.equal(harness.admin.statusUpdates.at(-1).provider_error,'MATCH_NO_LONGER_PENDING');
});
test('real match SMS stays short, UTF-8 and leads to its own match',()=>{
  const {buildOneOnOneSelectionSms}=loadSmsModule({
    '@/lib/dating-1on1-delivery-guard':{},
    '@/lib/dating-1on1-match-navigation':plainModule('lib/dating-1on1-match-navigation.ts'),
    '@/lib/dating-1on1-notification-guard':{}, '@/lib/dating-1on1':{},'@/lib/dating-blocks':{},'@/lib/dating-contact-blocks':{},'@/lib/marketing-email':{},'@/lib/solapi-phone-verification':{},
  });
  const id='00000000-0000-4000-8000-000000000012',text=buildOneOnOneSelectionSms(id);
  assert.ok(text.length<=80);assert.equal(Buffer.from(text).toString(),text);assert.ok(text.endsWith('/m/'+id));
});

test('acceptance adds a separate deduplicated SMS without changing an existing match', async () => {
  const f = createSmsHarness({ accepted: true });
  assert.equal(await f.send(), true); assert.equal(await f.send(), false);
  assert.equal(f.sent.length, 1); assert.match(f.sent[0].text, /상대가 수락/);
  assert.equal([...f.admin.deliveries.values()][0].event_kind, 'match_accepted');
  assert.equal(f.admin.matchState, 'mutual_accepted');
});
test('late account/block/preference safety failure suppresses both SMS types', async () => {
  for (const accepted of [true, false]) {
    const f = createSmsHarness({ accepted, unsafe: true });
    assert.equal(await f.send(), false); assert.equal(f.sent.length, 0);
  }
});
test('a phone change during sending does not notify a previously verified number', async () => {
  const f = createSmsHarness({ phoneChanged: true });
  assert.equal(await f.send(), false); assert.equal(f.sent.length, 0);
  assert.equal(f.admin.statusUpdates.at(-1).provider_error, 'RECIPIENT_PHONE_CHANGED');
});
