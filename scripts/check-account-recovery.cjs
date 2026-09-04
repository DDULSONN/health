/* eslint-disable @typescript-eslint/no-require-imports -- small TypeScript helper regression test */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const helperSource = fs.readFileSync(path.join(root, "lib/account-recovery.ts"), "utf8");
const output = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = { exports: {} };
new Function("module", "exports", output)(loaded, loaded.exports);
const recovery = loaded.exports;

test("duplicate phone response code is detected exactly", () => {
  assert.equal(recovery.isPhoneAlreadyUsedCode("PHONE_ALREADY_USED"), true);
  assert.equal(recovery.isPhoneAlreadyUsedCode("phone_already_used"), true);
  assert.equal(recovery.isPhoneAlreadyUsedCode("PHONE_ALREADY_VERIFIED_BY_ANOTHER_USER"), false);
});

test("account recovery never accepts an external or auth-loop redirect", () => {
  for (const input of ["https://evil.example", "//evil.example", "/login?next=/x", "/auth/callback", "/account-recovery"]) {
    assert.equal(recovery.safeAccountRecoveryNext(input), "/");
  }
  assert.equal(recovery.safeAccountRecoveryNext("/onboarding/dating?next=instant_open_card"), "/onboarding/dating?next=instant_open_card");
});

test("login and recovery links preserve only a safe destination", () => {
  const login = new URL(recovery.buildExistingAccountLoginHref("/onboarding/dating", { tab: "google", recovery: true }), "https://helchang.com");
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("next"), "/onboarding/dating");
  assert.equal(login.searchParams.get("reason"), "phone_already_used");
  assert.equal(login.searchParams.get("tab"), "google");
  assert.equal(login.searchParams.get("recovery"), "1");

  const accountRecovery = new URL(recovery.buildAccountRecoveryHref("//evil.example"), "https://helchang.com");
  assert.equal(accountRecovery.pathname, "/account-recovery");
  assert.equal(accountRecovery.searchParams.get("next"), "/");
  assert.equal(recovery.buildPasswordResetHref(), "/auth/reset-password");
});

test("Korean recovery copy remains valid UTF-8", () => {
  const files = ["app/phone-verification/page.tsx", "app/account-recovery/page.tsx", "app/login/page.tsx"];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(text.includes("�"), false, `${file} contains a replacement character`);
    assert.equal(Buffer.from(text, "utf8").toString("utf8"), text);
  }
  const phonePage = fs.readFileSync(path.join(root, files[0]), "utf8");
  const recoveryPage = fs.readFileSync(path.join(root, files[1]), "utf8");
  assert.match(phonePage, /기존 계정 로그인/);
  assert.match(phonePage, /signOut\(\{ scope: "local" \}\)/);
  assert.match(recoveryPage, /가입했던 방법을 선택해 주세요/);
  assert.match(recoveryPage, /signOut\(\{ scope: "local" \}\)/);
});
