/* eslint-disable @typescript-eslint/no-require-imports -- small TypeScript helper regression test */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const safePathSource = fs.readFileSync(path.join(root, "lib/safe-internal-path.ts"), "utf8");
const safePathOutput = ts.transpileModule(safePathSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const safePathLoaded = { exports: {} };
new Function("require", "module", "exports", safePathOutput)(require, safePathLoaded, safePathLoaded.exports);
const helperSource = fs.readFileSync(path.join(root, "lib/account-recovery.ts"), "utf8");
const output = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", output)(
  (name) => name === "@/lib/safe-internal-path" ? safePathLoaded.exports : require(name),
  loaded,
  loaded.exports,
);
const recovery = loaded.exports;

const ticketSource = fs.readFileSync(path.join(root, "lib/account-recovery-ticket.ts"), "utf8");
const ticketOutput = ts.transpileModule(ticketSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const ticketLoaded = { exports: {} };
new Function("require", "module", "exports", ticketOutput)(
  (name) => {
    if (name === "@/lib/solapi-phone-verification") {
      return { hashPhoneForVerificationStorage: (phone) => require("node:crypto").createHash("sha256").update(phone).digest("hex") };
    }
    return require(name);
  },
  ticketLoaded,
  ticketLoaded.exports,
);
const recoveryTicket = ticketLoaded.exports;

test("duplicate phone response code is detected exactly", () => {
  assert.equal(recovery.isPhoneAlreadyUsedCode("PHONE_ALREADY_USED"), true);
  assert.equal(recovery.isPhoneAlreadyUsedCode("phone_already_used"), true);
  assert.equal(recovery.isPhoneAlreadyUsedCode("PHONE_ALREADY_VERIFIED_BY_ANOTHER_USER"), false);
});

test("account recovery never accepts an external or auth-loop redirect", () => {
  for (const input of [
    "https://evil.example",
    "//evil.example",
    "/\\\\evil.example",
    "/login?next=/x",
    "/auth/callback",
    "/account-recovery",
  ]) {
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
  const reset = new URL(recovery.buildPasswordResetHref("/mypage?tab=matching"), "https://helchang.com");
  assert.equal(reset.pathname, "/auth/reset-password");
  assert.equal(reset.searchParams.get("recovery"), "1");
  assert.equal(reset.searchParams.get("next"), "/mypage?tab=matching");
});

test("recovery ticket is signed, expires, and rejects tampering", () => {
  const now = Date.UTC(2026, 8, 4, 0, 0, 0);
  const ticket = recoveryTicket.createAccountRecoveryTicket("+821012345678", now);
  const parsed = recoveryTicket.readAccountRecoveryTicket(ticket, now + 1_000);
  assert.match(parsed.phoneHash, /^[a-f0-9]{64}$/);
  assert.equal(parsed.expiresAt, Math.floor(now / 1000) + recoveryTicket.ACCOUNT_RECOVERY_TTL_SECONDS);
  const ticketParts = ticket.split(".");
  ticketParts[3] = `${ticketParts[3][0] === "a" ? "b" : "a"}${ticketParts[3].slice(1)}`;
  assert.equal(recoveryTicket.readAccountRecoveryTicket(ticketParts.join("."), now + 1_000), null);
  assert.equal(recoveryTicket.readAccountRecoveryTicket(ticket, now + recoveryTicket.ACCOUNT_RECOVERY_TTL_SECONDS * 1_000), null);
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

test("recovery login cannot create a new OTP account or prefill the duplicate account", () => {
  const loginSource = fs.readFileSync(path.join(root, "app/login/page.tsx"), "utf8");
  const callbackSource = fs.readFileSync(path.join(root, "app/auth/callback/page.tsx"), "utf8");
  const resetSource = fs.readFileSync(path.join(root, "app/auth/reset-password/page.tsx"), "utf8");
  const sessionRouteSource = fs.readFileSync(path.join(root, "app/api/account-recovery/session/route.ts"), "utf8");
  assert.match(loginSource, /shouldCreateUser: !isRecoveryFlow/);
  assert.match(loginSource, /if \(!isRecoveryFlow && stored\) setEmail\(stored\)/);
  assert.match(callbackSource, /shouldCreateUser: state\?\.recovery !== true/);
  assert.match(callbackSource, /params\.set\("recovery", "1"\)/);
  assert.match(callbackSource, /checkAccountRecoverySession\(\)/);
  assert.match(callbackSource, /recovery_account_mismatch/);
  assert.match(callbackSource, /recovery_verification_failed/);
  const magicLinkBlock = loginSource.split("const sendMagicLink = async () => {")[1].split("const handleSocialLogin")[0];
  const passwordBlock = loginSource.split("const handlePasswordLogin = async () => {")[1].split("const handleResendConfirmEmail")[0];
  assert.doesNotMatch(magicLinkBlock, /finishPasswordRecoveryLogin/);
  assert.match(passwordBlock, /signInWithPassword[\s\S]*finishPasswordRecoveryLogin\(supabase\)/);
  assert.match(sessionRouteSource, /ticket\.phoneHash !== hashPhoneForVerificationStorage\(phoneE164\)/);
  assert.match(sessionRouteSource, /RECOVERY_SESSION_EXPIRED/);
  assert.match(resetSource, /if \(!isRecoveryFlow && storedEmail\) setEmail\(storedEmail\)/);
  assert.match(resetSource, /loginParams\.set\("recovery", "1"\)/);
  assert.match(resetSource, /account-recovery\?next=/);
});
