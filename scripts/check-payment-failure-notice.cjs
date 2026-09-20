/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
function load(source, mocks = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function("require", "module", "exports", code)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), mod, mod.exports);
  return mod.exports;
}
const copy = load(read("lib/payment-card-notice.ts"));
const notice = load(read("components/PaymentCardNotice.tsx"), { "@/lib/payment-card-notice": copy }).default;
const returns = load(read("lib/dating-apply-return.ts"));
const pages = ["app/payments/fail/page.tsx", "app/payments/test/fail/page.tsx"];
function render(file, query, baseline = false) {
  const source = baseline ? execFileSync("git", ["show", "b845854:" + file], { cwd: root, encoding: "utf8" }) : read(file);
  const page = load(source, {
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/navigation": { useSearchParams: () => new URLSearchParams(query) },
    "@/components/PaymentCardNotice": { default: notice },
    "@/lib/dating-apply-return": returns,
  }).default;
  return renderToStaticMarkup(React.createElement(page));
}
test("exact Korean issuer notice is shared and has no payment action", () => {
  assert.equal(copy.PAYMENT_CARD_NOTICE, "현재 현대·KB국민·우리카드는 결제에 이용할 수 없어요. 다른 카드사의 카드를 이용해 주세요.");
  const html = renderToStaticMarkup(React.createElement(notice, { prominent: true }));
  assert.ok(html.includes(copy.PAYMENT_CARD_NOTICE));
  assert.ok(html.includes("text-sm font-medium"));
  assert.ok(!html.includes("text-xs"));
  assert.ok(!/<button|<a\b|<form|�/.test(html));
});
for (const file of pages) {
  test(file + ": prominent notice precedes error details; message is escaped", () => {
    const html = render(file, { code: "REJECT_CARD_COMPANY", message: "<script>bad</script>", orderId: "example-order" });
    assert.equal(html.split(copy.PAYMENT_CARD_NOTICE).length - 1, 1);
    assert.ok(html.indexOf(copy.PAYMENT_CARD_NOTICE) < html.indexOf("코드:"));
    assert.ok(html.includes("&lt;script&gt;bad&lt;/script&gt;"));
    assert.ok(!html.includes("<script>bad"));
    assert.ok(html.includes("example-order"));
    assert.ok(html.includes("승인 문자를 받았다면"));
  });
  test(file + ": cancellation stays distinct and missing query parameters still render", () => {
    assert.ok(render(file, { code: "PAY_PROCESS_CANCELED" }).includes("결제를 중단했어요"));
    assert.ok(!render(file, { code: "PROVIDER_ERROR" }).includes("결제를 중단했어요"));
    assert.ok(render(file, {}).includes(copy.PAYMENT_CARD_NOTICE));
  });
  test(file + ": existing recovery links are unchanged for all products", () => {
    const hrefs = html => [...html.matchAll(/href="([^"]*)"/g)].map(match => match[1]);
    for (const productType of ["apply_credits", "paid_card", "city_view", "more_view", "one_on_one_contact_exchange",
      "one_on_one_priority_24h", "one_on_one_plus_7d", "one_on_one_plus_30d", "dating_all_pass_30d", "swipe_premium_30d", "love_fortune_detail", "unknown"]) {
      const query = { productType, returnTo: "/community/dating/cards/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/apply?from=nearby" };
      assert.deepEqual(hrefs(render(file, query)), hrefs(render(file, query, true)), productType);
    }
  });
}
test("checkout error uses shared copy; order request code is unchanged", () => {
  const file = "components/TestPaymentPageClient.tsx";
  const current = read(file);
  const before = execFileSync("git", ["show", "b845854:" + file], { cwd: root, encoding: "utf8" });
  const handler = source => { const code = source.replace(/\r\n/g, "\n"); return code.slice(code.indexOf("  const startPayment ="), code.indexOf("\n  return (")); };
  assert.equal(handler(current), handler(before));
  assert.ok(current.includes('from "@/lib/payment-card-notice"'));
  assert.ok(current.includes("${PAYMENT_CARD_NOTICE}"));
});
