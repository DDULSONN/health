/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function load(file, imports = require) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} }; new Function("require", "module", "exports", code)(imports, mod, mod.exports); return mod.exports;
}
process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-only-consent-secret";
const copy = load("lib/signup-email-consent.ts");
const server = load("lib/signup-email-consent-server.ts", (id) => id.endsWith("/signup-email-consent") ? copy : require(id));
const now = Date.now();
const user = { id: "new-user", email: "new@example.test", created_at: new Date(now + 100).toISOString(), email_confirmed_at: new Date(now + 200).toISOString(), app_metadata: { provider: "email" } };
const token = server.createSignupEmailConsentToken({ consented: true, email: user.email, provider: "email" }, now);
assert.equal(server.readSignupEmailConsentToken(token, user).consented, true);
assert.equal(server.readSignupEmailConsentToken(token + "x", user), null);
assert.equal(server.readSignupEmailConsentToken(token, { ...user, email: "other@example.test" }), null);
assert.equal(server.readSignupEmailConsentToken(token, { ...user, created_at: new Date(now - 1).toISOString() }), null);
assert.equal(server.readSignupEmailConsentToken(token, { ...user, created_at: new Date(now + 1800001).toISOString() }), null);
assert.equal(server.readSignupEmailConsentToken(token, { ...user, app_metadata: { provider: "google" } }), null);

(async () => {
  const records = new Map();
  const db = { from: () => ({ upsert: async (row, options) => { assert.equal(options.ignoreDuplicates, true); if (!records.has(row.user_id)) records.set(row.user_id, row); return { error: null }; } }) };
  await server.recordSignupEmailConsent(db, user, token);
  assert.equal(records.get(user.id).wording_version, copy.EMAIL_CONSENT_VERSION);
  const declined = server.createSignupEmailConsentToken({ consented: false, email: user.email, provider: "email" }, now);
  await server.recordSignupEmailConsent(db, { ...user, id: "declined" }, declined);
  assert.equal(records.get("declined").consented_at, null);
  await server.recordSignupEmailConsent(db, { ...user, id: "unverified", email_confirmed_at: null }, token);
  assert.equal(records.has("unverified"), false);
  for (const provider of ["google", "apple"]) {
    const socialToken = server.createSignupEmailConsentToken({ consented: true, email: "", provider }, now);
    await server.recordSignupEmailConsent(db, { ...user, id: provider, app_metadata: { provider } }, socialToken);
    assert.equal(records.get(provider).consented, true);
  }
  const marketing = load("lib/marketing-email.ts");
  function marketingDb(fail = false) { return { from(table) {
    const q = { select: () => q, in: () => q, eq: () => q, then: (resolve) => resolve({ data: table === "email_marketing_consents" ? [{ user_id: "yes" }, { user_id: "withdrawn" }] : [{ user_id: "withdrawn" }], error: fail ? { code: "42P01", message: "schema cache" } : null }) }; return q;
  } }; }
  const excluded = await marketing.fetchEmailMarketingExcludedUserIds(marketingDb(), ["yes", "no", "withdrawn"], "campaign");
  assert.equal(excluded.has("yes"), false); assert.equal(excluded.has("no"), true); assert.equal(excluded.has("withdrawn"), true);
  assert.equal((await marketing.fetchEmailMarketingExcludedUserIds(marketingDb(true), ["yes"], "campaign")).has("yes"), true);

  let states = [], index = 0, signups = [], socialCalls = [], failPrepare = false;
  const supabase = { auth: {
    signUp: async (options) => { signups.push(options); return { data: { user: { identities: [{}] } }, error: null }; },
    signInWithOAuth: async (options) => { socialCalls.push(options); return { error: null }; },
  } };
  global.window = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
  global.alert = () => {};
  global.fetch = async (_, options) => { if (failPrepare) throw new Error("offline"); const body = JSON.parse(options.body); return { ok: true, json: async () => ({ token: `choice-${body.consented}` }) }; };
  const Page = load("app/signup/page.tsx", (id) => {
    if (id === "react") return { ...React, useEffect: () => {}, useState: (initial) => { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } };
    if (id === "react/jsx-runtime") return require(id);
    if (id === "next/link") return ({ children, href }) => React.createElement("a", { href }, children);
    if (id === "next/navigation") return { useRouter: () => ({ replace: () => {} }) };
    if (id.endsWith("supabase/client")) return { createClient: () => supabase };
    if (id.endsWith("/signup-email-consent")) return copy;
    if (id.endsWith("/nickname")) return { normalizeNickname: (s) => s, validateNickname: () => null };
    if (id.endsWith("/referral-code")) return { normalizeReferralCode: (s) => s || "", isValidReferralCode: () => false };
    throw new Error(id);
  }).default;
  const render = () => { index = 0; return Page(); };
  function nodes(tree) { if (!tree || typeof tree !== "object") return []; return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]; }
  for (const checked of [false, true]) {
    states = []; let tree = render();
    const checkbox = nodes(tree).find((n) => n.props?.type === "checkbox");
    assert.equal(checkbox.props.checked, false); assert.ok(!checkbox.props.required);
    checkbox.props.onChange({ target: { checked } });
    nodes(tree).find((n) => n.props?.["aria-controls"] === "email-signup-form").props.onClick();
    tree = render();
    for (const [id, value] of [["signup-email", user.email], ["signup-nickname", "회원"], ["signup-password", "test-password"], ["signup-password-confirm", "test-password"]]) nodes(tree).find((n) => n.props?.id === id).props.onChange({ target: { value } });
    tree = render();
    assert.match(renderToStaticMarkup(tree), /이메일 광고성 정보 수신 동의/);
    await nodes(tree).find((n) => n.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(signups.at(-1).options.data.signup_email_consent_token, `choice-${checked}`);
    assert.equal(signups.at(-1).email, user.email);
  }
  states = []; let tree = render();
  nodes(tree).find((n) => n.props?.type === "checkbox").props.onChange({ target: { checked: true } });
  tree = render();
  await nodes(tree).find((n) => n.type === "button" && n.props.children === "Google로 계속하기").props.onClick();
  assert.match(socialCalls.at(-1).options.redirectTo, /signup_consent=choice-true/);
  states = []; failPrepare = true; tree = render();
  await nodes(tree).find((n) => n.type === "button" && n.props.children === "Apple로 계속하기").props.onClick();
  assert.equal(socialCalls.at(-1).provider, "apple");
  assert.ok(!socialCalls.at(-1).options.redirectTo.includes("signup_consent"));
  console.log("PASS: unchecked/checked email signup, OAuth choice, nonblocking outage, signature/account binding, server records, withdrawal and missing-consent exclusion");
})().catch((error) => { console.error(error); process.exitCode = 1; });
