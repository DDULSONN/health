/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
function load(file, extra = "", imports = require) {
  const source = fs.readFileSync(path.join(root, file), "utf8") + extra;
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", output)(imports, mod, mod.exports);
  return mod.exports;
}
const { combineReview } = load("lib/dating-review.ts");
const review = (level) => ({ suspicionLevel: level, flags: [level], summary: level, photoFlags: [], textFlags: [], raw: {} });
for (const rules of ["clear", "low", "medium", "high"]) {
  for (const ai of ["clear", "low", "medium", "high"]) {
    const levels = ["clear", "low", "medium", "high"];
    assert.equal(combineReview(review(rules), review(ai), [], {}).suspicionLevel, levels[Math.max(levels.indexOf(rules), levels.indexOf(ai))]);
  }
}
assert.equal(combineReview(review("clear"), null, ["AI 실패"], {}).suspicionLevel, "medium");
assert.equal(combineReview(review("high"), null, ["사진 누락"], {}).suspicionLevel, "high");
const contact = load("lib/dating-contact-content.ts");
const route = load("app/api/admin/dating/card-ai-review/route.ts", "\nexport { ruleReview, parseAiJson, analyzeWithGemini };", (id) => {
  if (id === "@/lib/dating-review") return { combineReview };
  if (id === "@/lib/dating-contact-content") return contact;
  return {};
});
const card = { sourceType: "one_on_one_application", displayName: "테스터", photoPaths: ["a", "b", "c"], bucket: "test", texts: { intro: "서로 배려하며 즐겁게 지내고 싶습니다", matchId: "test_test_test", candidateName: "test", candidateRegion: "" } };
assert.equal(route.ruleReview(card).suspicionLevel, "clear");
assert.equal(route.ruleReview({ ...card, texts: { intro: "인스타 아이디 abc_def_ghi" } }).suspicionLevel, "high");
assert.equal(route.parseAiJson('{"suspicionLevel":"oops"}'), null);
(async () => {
  const admin = { storage: { from: () => ({ download: async () => ({ error: new Error("missing") }) }) } };
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(review("clear")) }] } }] }) });
  const missing = await route.analyzeWithGemini(admin, "fake", "fake", card);
  assert.equal(missing.suspicionLevel, "medium");
  assert.equal(missing.raw.checkedPhotos, 0);
  assert.equal(missing.raw.totalPhotos, 3);
  global.fetch = async () => { throw new Error("timeout"); };
  const failed = await route.analyzeWithGemini(admin, "fake", "fake", card);
  assert.equal(failed.raw.provider, "rules_fallback");
  assert.equal(failed.suspicionLevel, "medium");
  console.log("PASS: 16 severity combinations, internal-field false positives, contact detection, invalid AI JSON, image failure and AI timeout");
})().catch((error) => { console.error(error); process.exitCode = 1; });
