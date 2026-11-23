/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const ts = require("typescript");
const file = path.join(__dirname, "../lib/dating-read-recovery.ts");
const moduleUnderTest = { exports: {} };
new Function("exports", ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(moduleUnderTest.exports);
const { resolveOneOnOneHomeReads, datingAuthSessionMissing } = moduleUnderTest.exports;

const result = (status, body = null) => ({ status: "fulfilled", value: { response: { ok: status >= 200 && status < 300, status }, body } });
const rejected = { status: "rejected", reason: new TypeError("fixture networking error") };
const status = result(200, { loggedIn: true, canWrite: false });
const profile = result(200, { items: [{ id: "profile" }], plus: { contact_exchange_included: true } });
const matches = result(200, { items: [{ id: "match", contact_exchange_status: "approved" }] });

test("profile transport or service failures cannot replace successful authorized match reads", () => {
  const value = resolveOneOnOneHomeReads(rejected, result(503), matches);
  assert.deepEqual(value, { profileStatus: null, profileCards: null, matches: matches.value.body.items });
  const withPlus = resolveOneOnOneHomeReads(result(429), profile, matches);
  assert.strictEqual(withPlus.profileCards, profile.value.body);
  assert.strictEqual(withPlus.profileStatus, null);
  assert.deepEqual(resolveOneOnOneHomeReads(status, profile, result(200, { items: [] })).matches, []);
});

test("explicit auth or permission errors on any settled response fail closed", () => {
  for (const denied of [result(401), result(403)]) {
    assert.throws(() => resolveOneOnOneHomeReads(denied, profile, matches), /로그인/);
    assert.throws(() => resolveOneOnOneHomeReads(status, denied, matches), /로그인/);
    assert.throws(() => resolveOneOnOneHomeReads(status, profile, denied), /로그인/);
  }
  assert.throws(() => resolveOneOnOneHomeReads(result(200, { loggedIn: false }), profile, matches), /로그인/);
});

test("no valid fresh match response means no matching or contact payload", () => {
  for (const unavailable of [result(503), rejected, result(200), result(200, { items: {} })]) {
    assert.throws(() => resolveOneOnOneHomeReads(status, profile, unavailable), /매칭 상태/);
  }
});

test("transport, rate limiting and server errors do not masquerade as missing session", () => {
  for (const transient of [{ name: "TypeError" }, { status: 503 }, { status: 429 }]) assert.equal(datingAuthSessionMissing(transient), false);
  for (const missing of [{ name: "AuthSessionMissingError" }, { status: 401 }, { code: "session_not_found" }]) assert.equal(datingAuthSessionMissing(missing), true);
});
