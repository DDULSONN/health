/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../lib/dating-open-card-activity.ts");
const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loadedModule = { exports: {} };
new Function("require", "module", "exports", output)(require, loadedModule, loadedModule.exports);
const { getOpenCardActivityDecision, latestActivityIso } = loadedModule.exports;

const day = 24 * 60 * 60 * 1000;
const hour = 60 * 60 * 1000;
const nowMs = Date.parse("2026-09-01T00:00:00.000Z");
const isoBefore = (ms) => new Date(nowMs - ms).toISOString();

test("recent site activity keeps a twice-requeued card in the normal queue", () => {
  assert.equal(getOpenCardActivityDecision({
    nowMs,
    lastActivityAt: isoBefore(2 * day),
    noticeSentAt: null,
    noticeBaselineAt: null,
    deferredAt: null,
  }), "none");
});

test("an inactive member receives a notice before any queue demotion", () => {
  assert.equal(getOpenCardActivityDecision({
    nowMs,
    lastActivityAt: isoBefore(20 * day),
    noticeSentAt: null,
    noticeBaselineAt: null,
    deferredAt: null,
  }), "send_notice");
});

test("the full 72-hour grace period is preserved", () => {
  const base = {
    nowMs,
    lastActivityAt: isoBefore(20 * day),
    noticeBaselineAt: isoBefore(20 * day),
    deferredAt: null,
  };
  assert.equal(getOpenCardActivityDecision({ ...base, noticeSentAt: isoBefore(71 * hour) }), "none");
  assert.equal(getOpenCardActivityDecision({ ...base, noticeSentAt: isoBefore(72 * hour) }), "defer");
});

test("new activity after notice restores the normal queue state", () => {
  assert.equal(getOpenCardActivityDecision({
    nowMs,
    lastActivityAt: isoBefore(hour),
    noticeSentAt: isoBefore(4 * day),
    noticeBaselineAt: isoBefore(20 * day),
    deferredAt: isoBefore(day),
  }), "restore");
});

test("a dormant member is not repeatedly processed without a new activity signal", () => {
  assert.equal(getOpenCardActivityDecision({
    nowMs,
    lastActivityAt: isoBefore(20 * day),
    noticeSentAt: isoBefore(5 * day),
    noticeBaselineAt: isoBefore(20 * day),
    deferredAt: isoBefore(day),
  }), "none");
});

test("the latest valid activity timestamp wins", () => {
  assert.equal(
    latestActivityIso("invalid", "2026-08-01T00:00:00Z", "2026-08-30T00:00:00+00:00"),
    "2026-08-30T00:00:00.000Z"
  );
});
