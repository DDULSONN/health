/* eslint-disable @typescript-eslint/no-require-imports */
// Exercise the actual guide image JSX. No member or production setting is changed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const Image = require("next/image").default;
const { getImageProps } = require("next/image");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "components/SiteGuideBubble.tsx"), "utf8");
const ast = ts.createSourceFile("SiteGuideBubble.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let imageNode;
let defaultSrc;
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "Image") imageNode = node;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "DEFAULT_MASCOT_SRC") {
    defaultSrc = node.initializer.text;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(imageNode);
assert.ok(defaultSrc);
const compiled = ts.transpileModule("exports.render = () => (" + imageNode.getText(ast) + ");", {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function renderActualImage(src) {
  let current = src;
  const changes = [];
  const mod = { exports: {} };
  new Function("require", "module", "exports", "Image", "mascotSrc", "DEFAULT_MASCOT_SRC", "setMascotSrc", compiled)(
    require, mod, mod.exports, Image, src, defaultSrc,
    update => {
      const next = typeof update === "function" ? update(current) : update;
      if (next !== current) changes.push(next);
      current = next;
    }
  );
  return { element: mod.exports.render(), current: () => current, changes };
}
const sources = [
  [ "default", "/mascot/jimnyang-guide-v2.webp" ],
  [ "summer", "/mascot/jimnyang-summer.webp" ],
  [ "rain", "/mascot/jimnyang-rain.webp" ],
  [ "uploaded autumn with version query", "/i/public-lite/community/site-guide-mascots/custom-fixture.webp?v=20260221-1" ],
];
for (const [label, src] of sources) {
  test(label + ": rendered image uses the appropriate delivery path", () => {
    const { element } = renderActualImage(src);
    const { props } = getImageProps(element.props);
    const direct = src === defaultSrc || src.startsWith("/i/public-lite/community/site-guide-mascots/");
    assert.equal(element.props.unoptimized, direct);
    if (direct) {
      assert.equal(props.src, src);
      assert.equal(props.srcSet, undefined);
    } else {
      assert.ok(props.src.startsWith("/_next/image?"));
      assert.equal(new URL(props.src, "https://fixture.invalid").searchParams.get("url"), src);
      assert.ok(props.srcSet);
    }
    assert.equal(element.props.fill, true);
    assert.equal(element.props.alt, "짐냥이");
    assert.equal(element.props.className, "object-cover object-center");
    const html = renderToStaticMarkup(element);
    assert.ok(html.includes('src="' + props.src.replaceAll("&", "&amp;") + '"'));
    assert.equal(html.includes("/_next/image"), !direct);
  });
  test(label + ": failed image safely falls back once without a retry loop", () => {
    const image = renderActualImage(src);
    assert.equal(typeof image.element.props.onError, "function");
    image.element.props.onError();
    assert.equal(image.current(), defaultSrc);
    image.element.props.onError();
    assert.deepEqual(image.changes, src === defaultSrc ? [] : [defaultSrc]);
  });
}
test("saved mascot URLs retain version queries; no global image security config is relaxed", () => {
  const config = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
  assert.ok(!config.includes("dangerouslyAllowLocalIP: true"));
  assert.ok(!config.includes("localPatterns"));
  const lib = fs.readFileSync(path.join(root, "lib/site-guide-mascot.ts"), "utf8");
  assert.ok(lib.includes('/i/public-lite/community/site-guide-mascots/'));
});
