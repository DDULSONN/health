/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
function load(file, imports = require) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} }; new Function("require", "module", "exports", code)(imports, mod, mod.exports); return mod.exports;
}
const drafts = load("lib/dating-apply-draft.ts");
const cardId = "12345678-1234-1234-1234-123456789abc";
let states = [], refs = [], effects = [], stateIndex = 0, refIndex = 0;
const storageValues = new Map();
const storage = { getItem: (k) => storageValues.get(k) ?? null, setItem: (k, v) => storageValues.set(k, v), removeItem: (k) => storageValues.delete(k) };
global.window = { sessionStorage: storage, location: { href: "" } };
global.alert = () => {};
let applyCalls = 0, checkoutCalls = 0, lastCheckout, storageFails = false;
const latest = { id: "old", age: 25, height_cm: 170, region: "서울", job: "회사원", training_years: 0, intro_text: "안녕하세요 ☕", instagram_id: "test", photo_paths: ["card-applications/viewer/a.webp", "card-applications/viewer/b.webp"], created_at: new Date().toISOString() };
global.fetch = async (url, options) => {
  if (url === `/api/dating/cards/${cardId}`) return { ok: true, json: async () => ({ card: { id: cardId, display_nickname: "상대", image_urls: [] } }) };
  if (url.endsWith("/latest")) return { ok: true, json: async () => ({ item: latest }) };
  if (url === "/api/dating/cards/apply") { applyCalls++; return { ok: false, json: async () => ({ code: "DAILY_APPLY_LIMIT" }) }; }
  if (url === "/api/payments/toss/create") { checkoutCalls++; lastCheckout = JSON.parse(options.body); return { ok: true, json: async () => ({ checkoutUrl: "https://checkout.test/order" }) }; }
  throw new Error(`Unexpected request: ${url}`);
};
const router = { replace: () => {}, push: () => {} };
const supabase = { auth: { getUser: async () => ({ data: { user: { id: "viewer" } } }) } };
const Page = load("app/community/dating/cards/[id]/apply/page.tsx", (id) => {
  if (id === "react") return { ...React, useMemo: (fn) => fn(), useEffect: (fn) => effects.push(fn), useState: (initial) => { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; }, useRef: (initial) => { const i = refIndex++; return refs[i] ??= { current: initial }; } };
  if (id === "react/jsx-runtime") return require(id);
  if (id === "next/link") return ({ children, href }) => React.createElement("a", { href }, children);
  if (id === "next/navigation") return { useParams: () => ({ id: cardId }), useRouter: () => router, useSearchParams: () => new URLSearchParams("from=nearby") };
  if (id.endsWith("supabase/client")) return { createClient: () => supabase };
  if (id.endsWith("dating-apply-draft")) return { ...drafts, saveApplyCheckoutDraft: (...args) => { if (storageFails) throw new Error("disabled"); return drafts.saveApplyCheckoutDraft(...args); } };
  return () => null;
}).default;
function render() { stateIndex = refIndex = 0; effects = []; return Page(); }
function nodes(tree) { if (!tree || typeof tree !== "object") return []; return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]; }
async function mount() { states = []; refs = []; render(); for (const effect of effects) effect(); for (let i = 0; i < 10; i++) await new Promise(setImmediate); return render(); }
(async () => {
  let tree = await mount();
  assert.equal(applyCalls, 0);
  const years = nodes(tree).find((n) => n.props?.label === "운동 경력(년)");
  assert.equal(years.props.children.props.value, "0");
  await nodes(tree).find((n) => n.type === "form").props.onSubmit({ preventDefault() {} });
  tree = render();
  const checkout = nodes(tree).find((n) => n.type === "button" && n.props.children === "지원권 5장 충전 · 5,000원");
  assert.ok(checkout);
  checkout.props.onClick(); checkout.props.onClick();
  for (let i = 0; i < 10; i++) await new Promise(setImmediate);
  assert.equal(checkoutCalls, 1, "Double click creates only one checkout");
  assert.equal(lastCheckout.returnTo, `/community/dating/cards/${cardId}/apply?from=nearby`);
  assert.equal(drafts.readApplyCheckoutDraft(storage, "viewer", cardId).introText, latest.intro_text);
  assert.equal(window.location.href, "https://checkout.test/order");
  tree = await mount();
  assert.equal(applyCalls, 1, "Returning from payment must not auto-submit");
  assert.equal(nodes(tree).find((n) => n.props?.type === "checkbox").props.checked, false, "Consent requires confirmation after returning");
  assert.equal(nodes(tree).find((n) => n.props?.label === "운동 경력(년)").props.children.props.value, "0");
  assert.equal(nodes(tree).find((n) => n.props?.label === "자기소개").props.children.props.value, latest.intro_text);
  nodes(tree).find((n) => n.props?.type === "checkbox").props.onChange({ target: { checked: true } });
  tree = render();
  await nodes(tree).find((n) => n.type === "form").props.onSubmit({ preventDefault() {} });
  tree = render(); storageFails = true; window.location.href = "";
  nodes(tree).find((n) => n.type === "button" && n.props.children === "지원권 5장 충전 · 5,000원").props.onClick();
  for (let i = 0; i < 10; i++) await new Promise(setImmediate);
  assert.equal(checkoutCalls, 1, "Storage failure must not discard the form by leaving for checkout");
  assert.equal(window.location.href, "");
  let newCount = 0, previewFails = false, paymentCalls = [], writes = 0;
  const paymentDb = { from() {
    let inserted = false;
    const q = { then: (resolve) => resolve({ data: inserted ? { id: "order" } : [], error: null }) };
    for (const method of ["select", "single", "eq", "contains", "in", "order", "limit"]) q[method] = () => q;
    q.insert = () => { inserted = true; writes++; return q; };
    return q;
  } };
  const paymentRoute = load("app/api/payments/toss/create/route.ts", (id) => {
    if (id === "next/server") return require(id);
    if (id.endsWith("supabase/request")) return { getRequestAuthContext: async () => ({ user: { id: "viewer", email: "viewer@example.test" } }) };
    if (id.endsWith("supabase/server")) return { createAdminClient: () => paymentDb };
    if (id.endsWith("request-origin")) return { ensureAllowedMutationOrigin: () => null };
    if (id.endsWith("dating-city-view")) return { getCityViewTargetSex: async () => "female", normalizeDatingCityViewSex: (value) => value === "female" || value === "male" ? value : null };
    if (id.endsWith("dating-purchase-fulfillment")) return { getCityViewPurchasePreview: async () => { if (previewFails) throw new Error("lookup failed"); return { newCount }; } };
    if (id.endsWith("dating-apply-return")) return load("lib/dating-apply-return.ts");
    if (id.endsWith("toss-payments")) return { isTossConfigured: () => true, getTossCheckoutMode: () => "test", getTossCheckoutOptions: () => ({}), createTossPayment: async (options) => { paymentCalls.push(options); return { checkout: { url: "https://checkout.test/order" } }; } };
    return {};
  });
  const request = (body) => paymentRoute.POST(new Request("https://local.test/api/payments/toss/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const cityRequest = { productType: "city_view", province: "서울", targetSex: "female", requireNewCandidates: true };
  assert.equal((await request(cityRequest)).status, 409);
  assert.equal(writes, 0); assert.equal(paymentCalls.length, 0);
  newCount = 20;
  assert.equal((await request({ ...cityRequest, targetSex: "male" })).status, 409);
  assert.equal(writes, 0);
  previewFails = true;
  assert.equal((await request(cityRequest)).status, 500);
  assert.equal(writes, 0); previewFails = false;
  assert.equal((await request(cityRequest)).status, 200);
  assert.equal(paymentCalls.at(-1).amount, 5000);
  const applyReturn = `/community/dating/cards/${cardId}/apply?from=nearby`;
  assert.equal((await request({ productType: "apply_credits", returnTo: applyReturn })).status, 200);
  assert.equal(paymentCalls.at(-1).amount, 5000);
  assert.equal(new URL(paymentCalls.at(-1).successUrl).searchParams.get("returnTo"), applyReturn);
  assert.equal(new URL(paymentCalls.at(-1).failUrl).searchParams.get("returnTo"), applyReturn);
  await request({ productType: "apply_credits", returnTo: "https://evil.test" });
  assert.equal(new URL(paymentCalls.at(-1).successUrl).searchParams.get("returnTo"), null);
  console.log("PASS: credit shortage, one checkout per double-click, exact return route, Korean/zero-year/photo draft restore, manual confirmation, storage failure");
  console.log("PASS: payment API rejects zero candidates, changed sex and lookup failure before writes; unchanged price and safe success/failure returns");
})().catch((error) => { console.error(error); process.exitCode = 1; });
