/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
function load(file, imports, extra = "") {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8") + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", output)(imports, mod, mod.exports);
  return mod.exports;
}
const policy = load("lib/dating-city-view-policy.ts", require);
const region = { extractProvinceFromRegion: (s) => s?.split(" ")[0] ?? null, getNearbyProvinceFallbackOrder: (s) => [s] };
const city = load("lib/dating-city-view.ts", (id) => id.endsWith("region-city") ? region : policy);
let writes = 0;
function dbFor(result) {
  return { from(table) {
    const q = { then(resolve, reject) { return Promise.resolve(result(table)).then(resolve, reject); } };
    for (const key of ["select", "eq", "in", "gt", "order", "limit", "maybeSingle", "single"]) q[key] = () => q;
    q.update = () => { writes++; return q; };
    return q;
  } };
}
const ids = Array.from({ length: 35 }, (_, i) => `card-${i}`);
const grantRow = { id: "grant", city: "서울", access_expires_at: "2099-01-01", note: policy.WEEKLY_CITY_VIEW_NOTE, snapshot_card_ids: ids.slice(0, 10) };
const rows = ids.map((id) => ({ id, owner_user_id: id, sex: "female", region: "서울", status: "pending", created_at: "2026-01-01", photo_paths: [] }));
let grant;
let db;
const list = load("app/api/dating/cards/city-view/list/route.ts", (id) => {
  if (id === "next/server") return require(id);
  if (id.endsWith("dating-city-view-candidates")) return {
    fetchCityViewCandidateRows: async () => rows,
    sortCityViewCandidates: (values) => values,
    buildRegionFirstCityViewCardIds: (values, _, existing, count) => [...new Set([...existing, ...values.map((row) => row.id)])].slice(0, count),
  };
  if (id.endsWith("dating-city-view")) return { ...city, getActiveCityViewGrant: async () => grant, getCityViewTargetSex: async () => "female" };
  if (id.endsWith("dating-city-view-policy")) return policy;
  if (id.endsWith("region-city")) return region;
  if (id.endsWith("supabase/request")) return { getRequestAuthContext: async () => ({ user: { id: "viewer" } }) };
  if (id.endsWith("supabase/server")) return { createAdminClient: () => db };
  if (id.endsWith("dating-blocks")) return { getDatingBlockedUserIds: async () => new Set() };
  if (id.endsWith("dating-contact-blocks")) return { filterDatingCardsByContactBlocks: async (_, __, values) => values };
  return {};
});
(async () => {
  const accessDb = dbFor(() => ({ data: [grantRow], error: null }));
  assert.equal(await city.hasCityViewCardAccess(accessDb, "viewer", ids[0], "서울"), true);
  assert.equal(await city.hasCityViewCardAccess(accessDb, "viewer", ids[10], "서울"), false);
  assert.equal(await city.hasCityViewCardAccess(dbFor(() => ({ data: [{ ...grantRow, note: "paid" }], error: null })), "viewer", ids[0], "서울"), true);
  assert.equal(await city.hasCityViewCardAccess(dbFor(() => ({ data: [{ ...grantRow, note: "paid" }], error: null })), "viewer", ids[10], "서울"), false);
  assert.equal(await city.hasCityViewCardAccess(dbFor(() => ({ data: null, error: { code: "42703" } })), "viewer", ids[0], "서울"), false);
  assert.equal((await city.getActiveCityViewGrant(accessDb, "viewer", "서울")).preview, true);
  let schemaReads = 0;
  const oldSchema = dbFor(() => ++schemaReads === 1
    ? { data: null, error: { code: "42703" } }
    : { data: [grantRow], error: null });
  assert.equal((await city.getActiveCityViewGrant(oldSchema, "viewer", "서울")).preview, true);
  assert.equal((await city.getActiveCityViewGrant(dbFor(() => ({ data: [{ ...grantRow, note: "weekly open card benefit" }], error: null })), "viewer", "서울")).preview, false);
  grant = { requestId: "grant", preview: true, snapshotCardIds: ids.slice(0, 10), snapshotSeenCardIds: [], targetSex: "female", accessExpiresAt: "2099-01-01" };
  db = dbFor((table) => ({ data: table === "dating_cards" ? rows : [], error: null }));
  let response = await list.GET(new Request("https://local.test/?province=서울"));
  let body = await response.json();
  assert.equal(body.items.length, 10);
  assert.equal(body.limit, 10);
  assert.equal(writes, 0);
  assert.match(response.headers.get("cache-control"), /no-store/);
  grant.snapshotCardIds = ["removed", ...ids.slice(0, 9)];
  body = await (await list.GET(new Request("https://local.test/?province=서울"))).json();
  assert.equal(body.items.length, 9, "Removed cards must not refill a free snapshot");
  assert.equal(writes, 0);
  grant.preview = false;
  body = await (await list.GET(new Request("https://local.test/?province=서울"))).json();
  assert.equal(body.items.length, 30, "Paid and legacy benefits retain 30");
  grant.snapshotCardIds = ids;
  body = await (await list.GET(new Request("https://local.test/?province=서울"))).json();
  assert.equal(body.items.length, 35, "Accumulated paid candidates must not be truncated to 30");
  const publicSource = fs.readFileSync(path.join(root, "app/api/dating/cards/public/route.ts"), "utf8");
  assert.equal((publicSource.match(/\.order\("published_at"/g) ?? []).length, 2);
  assert.ok(!publicSource.includes('.order("created_at"'));
  assert.ok(publicSource.includes('lastItem.published_at ?? "0001-01-01T00:00:00.000Z"'));
  const page = fs.readFileSync(path.join(root, "app/community/dating/cards/page.tsx"), "utf8");
  assert.ok(page.includes("const pinnedPaidItems = paidItems;"));
  assert.ok(!page.includes("instantPaidItems.map"));
  const cursors = load("app/api/dating/cards/public/route.ts", () => ({}), "\nexport { parseCursorTs, parseCursorId };");
  assert.equal(cursors.parseCursorTs("2026-09-06T00:00:00.123456+00:00"), "2026-09-06T00:00:00.123456+00:00");
  assert.equal(cursors.parseCursorId("bad,query"), null);
  assert.equal(cursors.parseCursorTs("not a date"), null);
  const fulfillment = load("lib/dating-purchase-fulfillment.ts", (id) => {
    if (id.endsWith("dating-city-view-candidates")) return { fetchCityViewCandidateRows: async () => [], sortCityViewCandidates: (values) => values };
    if (id.endsWith("dating-city-view")) return { ...city, getCityViewTargetSex: async () => "female" };
    if (id.endsWith("dating-city-view-policy")) return policy;
    if (id.endsWith("region-city")) return region;
    if (id.endsWith("dating-blocks")) return { getDatingBlockedUserIds: async () => new Set() };
    if (id.endsWith("dating-contact-blocks")) return { filterDatingCardsByContactBlocks: async (_, __, values) => values };
    return {};
  });
  await assert.rejects(fulfillment.grantCityViewAccess(dbFor(() => ({ data: [], error: null })), { userId: "viewer", city: "서울", note: policy.WEEKLY_CITY_VIEW_NOTE, bonusCredits: 0 }), /후보가 없습니다/);
  await assert.rejects(fulfillment.grantCityViewAccess(accessDb, { userId: "viewer", city: "서울", note: policy.WEEKLY_CITY_VIEW_NOTE, bonusCredits: 0 }), /이미 열람 중/);
  let reserved = false;
  let grants = 0;
  let failGrant = false;
  let openCount = 1;
  let oneOnOneCount = 1;
  let registrationError = null;
  const weekly = load("lib/dating-city-view-weekly.ts", (id) => {
    if (id.endsWith("dating-1on1")) return { DATING_ONE_ON_ONE_ACTIVE_STATUSES: ["submitted", "reviewing", "approved"] };
    if (id.endsWith("region-city")) return region;
    if (id.endsWith("dating-city-view-policy")) return policy;
    if (id.endsWith("dating-city-view")) return city;
    if (id.endsWith("weekly")) return { getKstWeekId: () => "2026-W36", getKstWeekRange: () => ({ startUtcIso: "2026-09-01", endUtcIso: "2026-09-08" }) };
    if (id.endsWith("dating-purchase-fulfillment")) return { grantCityViewAccess: async (_, options) => { grants++; if (failGrant) throw new Error("no candidates"); assert.equal(options.note, policy.WEEKLY_CITY_VIEW_NOTE); return { requestId: "grant", accessExpiresAt: "2099-01-01" }; } };
    return {};
  });
  const weeklyDb = { from(table) {
    let insert = false;
    const q = { then(resolve, reject) {
      const registration = table === "dating_cards" || table === "dating_1on1_cards";
      let result = { data: null, error: registration ? registrationError : null, count: table === "dating_cards" ? openCount : table === "dating_1on1_cards" ? oneOnOneCount : 0 };
      if (insert) {
        result = reserved ? { error: { code: "23505" } } : { data: { id: "claim" }, error: null };
        reserved = true;
      }
      return Promise.resolve(result).then(resolve, reject);
    } };
    for (const key of ["select", "eq", "in", "gte", "lt", "order", "limit", "maybeSingle", "update"]) q[key] = () => q;
    q.in = (column, values) => {
      if (table === "dating_1on1_cards") assert.deepEqual(values, ["submitted", "reviewing", "approved"], "Deleted/rejected profiles must not qualify");
      return q;
    };
    q.insert = () => { insert = true; return q; };
    q.delete = () => { reserved = false; return q; };
    return q;
  } };
  for (const [open, one] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    openCount = open;
    oneOnOneCount = one;
    const status = await weekly.getCityViewWeeklyBenefitStatus(weeklyDb, "viewer");
    assert.equal(status.hasOpenCard, Boolean(open));
    assert.equal(status.hasOneOnOneCard, Boolean(one));
    assert.equal(status.canClaim, Boolean(open && one));
    if (!status.eligible) {
      await assert.rejects(weekly.claimCityViewWeeklyBenefit(weeklyDb, { userId: "viewer", province: "서울" }), /모두 등록해야/);
      assert.equal(reserved, false);
      assert.equal(grants, 0);
    }
  }
  registrationError = { code: "42703" };
  await assert.rejects(weekly.claimCityViewWeeklyBenefit(weeklyDb, { userId: "viewer", province: "서울" }));
  assert.equal(reserved, false, "Lookup errors must not consume or grant benefits");
  registrationError = null;
  const claims = await Promise.allSettled([1, 2].map(() => weekly.claimCityViewWeeklyBenefit(weeklyDb, { userId: "viewer", province: "서울" })));
  assert.equal(claims.filter((claim) => claim.status === "fulfilled").length, 1);
  assert.equal(grants, 1, "Concurrent claims must only grant once");
  reserved = false;
  failGrant = true;
  await assert.rejects(weekly.claimCityViewWeeklyBenefit(weeklyDb, { userId: "viewer", province: "서울" }), /no candidates/);
  assert.equal(reserved, false, "Failed grant must release the weekly claim");
  console.log("PASS: free 10, no refill, direct-access restriction, paid/legacy 30, schema failure, private cache, publication ordering wiring");
})().catch((error) => { console.error(error); process.exitCode = 1; });
