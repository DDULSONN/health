/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../lib/dating-open-quick-pass.ts"), "utf8");
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject });
const {
  OPEN_QUICK_PASS,
  createOpenQuickPass: create,
  getOpenQuickPassBenefits: benefits,
  updateOpenQuickPass: update,
  getOpenQuickPassNearbyCards: nearby,
} = exportsObject;

const start = Date.parse("2026-11-23T14:50:00+09:00");
const day = 86_400_000;
const term = OPEN_QUICK_PASS.durationDays * day;
const publication = (id, overrides = {}) => ({
  type: "record-instant-publish", publicationId: id, published: true, ...overrides,
});
const application = (id, overrides = {}) => ({
  type: "record-application", cardId: id, submitted: true, ...overrides,
});
const like = (id, overrides = {}) => ({
  type: "record-like", cardId: id, sent: true, ...overrides,
});
const setAreas = (areas) => ({ type: "set-preferred-areas", areas });

function apply(state, action, now = start) {
  const result = update(state, action, now);
  assert.equal(result.outcome, "applied");
  assert.notEqual(result.state, state);
  return result.state;
}

function preserve(state, action, expected, now = start) {
  const result = update(state, action, now);
  assert.equal(result.outcome, expected);
  assert.equal(result.state, state);
}

test("30-day preview is immediately available, excludes the exact expiration boundary, and never auto-renews", () => {
  const state = create(start);
  assert.equal(benefits(state, start - 1).active, false);
  assert.equal(benefits(state, start).active, true);
  assert.equal(benefits(state, start).expiresAtMs, start + 30 * day);
  assert.equal(benefits(state, start).instantRemaining, 4);
  assert.equal(benefits(state, start).extraApplicationsRemaining, 40);
  assert.equal(benefits(state, start).likesRemaining, 50);
  assert.equal(benefits(state, start + term - 1).active, true);
  assert.equal(benefits(state, start + term).active, false);
  assert.equal(benefits(state, start + term + 2 * day).active, false);
});

test("none of the preview actions can change benefits before activation or after expiration", () => {
  const state = create(start);
  const actions = [publication("first"), application("example"), like("example"), setAreas(["서울 마포구"])];
  for (const action of actions) {
    preserve(state, action, "inactive", start - 1);
    preserve(state, action, "inactive", start + term);
  }
  const expired = benefits(state, start + term);
  assert.equal(expired.instantRemaining, 0);
  assert.equal(expired.extraApplicationsRemaining, 0);
  assert.equal(expired.likesRemaining, 0);
  assert.equal(expired.canInstantPublish, false);
});

test("invalid or backdated operations cannot create fresh benefits", () => {
  for (const time of [Infinity, NaN, -1, 0.5, 8_640_000_000_000_000]) {
    assert.throws(() => create(time), { name: "RangeError" });
  }
  const state = apply(create(start), setAreas(["서울 마포구"]), start + 15_000);
  preserve(state, application("card"), "invalid", start);
  preserve(state, application("card"), "invalid", NaN);
  assert.equal(benefits(state, NaN).active, false);
});

test("instant publication requires a successful outcome and no other visible card", () => {
  const state = create(start);
  preserve(state, publication("draft", { published: false }), "not-completed");
  preserve(state, publication("blocked", { alreadyHasVisibleCard: true }), "visible-card");
  preserve(state, publication(" "), "invalid");
  assert.equal(benefits(state, start).canInstantPublish, true);
  assert.equal(benefits(state, start).instantRemaining, 4);
  const published = apply(state, publication("done"));
  assert.equal(benefits(published, start).instantRemaining, 3);
  assert.equal(benefits(state, start).instantRemaining, 4);
});

test("instant publication is idempotent and no new publication is counted until seven full days", () => {
  const state = apply(create(start), publication("operation-1"));
  assert.equal(benefits(state, start).nextInstantPublishAtMs, start + 7 * day);
  preserve(state, publication("operation-1"), "duplicate", start + 7 * day);
  preserve(state, publication("operation-2"), "cooldown", start + 7 * day - 1);
  const next = apply(state, publication("operation-2"), start + 7 * day);
  assert.equal(benefits(next, start + 7 * day).instantRemaining, 2);
});

test("at most four successful instant publications per pass", () => {
  let state = create(start);
  for (let i = 0; i < 4; i += 1) state = apply(state, publication("operation-" + i), start + i * 7 * day);
  preserve(state, publication("fifth"), "limit", start + 28 * day);
  assert.equal(benefits(state, start + 28 * day).nextInstantPublishAtMs, null);
  assert.equal(benefits(state, start + 28 * day).canInstantPublish, false);
});

test("a cooldown that reaches beyond the term does not promise another timed use", () => {
  const state = apply(create(start), publication("late"), start + 23 * day);
  assert.equal(benefits(state, start + 29 * day).instantRemaining, 3);
  assert.equal(benefits(state, start + 29 * day).nextInstantPublishAtMs, null);
  assert.equal(benefits(state, start + 29 * day).canInstantPublish, false);
  preserve(state, publication("never"), "inactive", start + term);
});

test("40 bonus applications are term-wide, not a daily grant; failed and duplicate submissions are not counted", () => {
  let state = create(start);
  preserve(state, application("try", { submitted: false }), "not-completed");
  preserve(state, application(""), "invalid");
  state = apply(state, application("one"));
  preserve(state, application(" one "), "duplicate", start + 3 * day);
  for (let i = 1; i < 40; i += 1) state = apply(state, application("card-" + i), start + 3 * day);
  assert.equal(benefits(state, start + 3 * day).extraApplicationsRemaining, 0);
  preserve(state, application("over"), "limit", start + 4 * day);
  assert.equal(benefits(state, start + 4 * day).likesRemaining, 50);
});

test("only sent likes count; daily quota reopens at midnight in Korea and never duplicates a card", () => {
  const midnight = Date.parse("2026-11-24T00:00:00+09:00");
  let state = create(start);
  preserve(state, like("failed", { sent: false }), "not-completed");
  for (let i = 0; i < 50; i += 1) state = apply(state, like("card-" + i), midnight - 1);
  preserve(state, like("over"), "limit", midnight - 1);
  assert.equal(benefits(state, midnight - 1).likesRemaining, 0);
  assert.equal(benefits(state, midnight).likesRemaining, 50);
  preserve(state, like("card-1"), "duplicate", midnight);
  state = apply(state, like("new"), midnight);
  assert.equal(benefits(state, midnight).likesRemaining, 49);
  assert.equal(benefits(state, midnight).extraApplicationsRemaining, 40);
});

test("exactly two preferred areas can be selected without creating any card access", () => {
  const state = create(start);
  preserve(state, setAreas(["서울 마포구", "서울 서대문구", "경기 고양시"]), "limit");
  preserve(state, setAreas(["서울 마포구", " 서울 마포구 "]), "invalid");
  preserve(state, setAreas(["   "]), "invalid");
  const selected = apply(state, setAreas([" 서울 마포구 ", "서울 서대문구"]));
  assert.deepEqual(Array.from(benefits(selected, start).preferredAreas), ["서울 마포구", "서울 서대문구"]);
  const cleared = apply(selected, setAreas([]));
  assert.equal(benefits(cleared, start).preferredAreas.length, 0);
});

test("nearby browse shows eligible waiting cards first, then live public cards in the selected areas", () => {
  const state = create(start);
  const selected = apply(state, setAreas(["서울 마포구", "서울 서대문구"]));
  const card = (id, extra = {}) => ({
    id, area: "서울 마포구", status: "published",
    registeredAtMs: start - 2 * day, publishedAtMs: start - day, expiresAtMs: start + day,
    canView: true, ...extra,
  });
  const queued = (id, extra = {}) => card(id, { status: "queued", publishedAtMs: null, expiresAtMs: null, ...extra });
  const cards = [
    card("old"),
    queued("waiting-older", { expiresAtMs: start + day }),
    queued("waiting-newer", { area: "서울 서대문구", registeredAtMs: start - 1 }),
    card("hidden", { status: "hidden" }),
    card("rejected", { status: "rejected" }),
    card("blocked", { canView: false }),
    queued("waiting-ineligible", { canView: false }),
    queued("waiting-hidden", { status: "hidden" }),
    queued("waiting-rejected", { status: "rejected" }),
    queued("waiting-expired", { expiresAtMs: start }),
    queued("waiting-invalid-expiry", { expiresAtMs: Infinity }),
    queued("waiting-late", { registeredAtMs: start + 1 }),
    queued("waiting-invalid-registration", { registeredAtMs: NaN }),
    queued("waiting-invalid-status", { publishedAtMs: start - 1 }),
    queued("waiting-other-area", { area: "경기 고양시" }),
    card("expired", { expiresAtMs: start }),
    card("future", { publishedAtMs: start + 1 }),
    card("no-date", { publishedAtMs: null }),
    card("no-expiry", { expiresAtMs: null }),
    card("published-before-registration", { registeredAtMs: start - 1 }),
    card("other-area", { area: "경기 고양시" }),
    card("new", { area: "서울 서대문구", publishedAtMs: start - 1 }),
  ];
  assert.deepEqual(Array.from(nearby(selected, cards, start), (item) => item.id), ["waiting-newer", "waiting-older", "new", "old"]);
  assert.equal(nearby(state, cards, start).length, 0);
  assert.equal(nearby(selected, cards, start - 1).length, 0);
  assert.equal(nearby(selected, cards, start + term).length, 0);
  assert.equal(cards.find((item) => item.id === "waiting-newer").status, "queued");
});
