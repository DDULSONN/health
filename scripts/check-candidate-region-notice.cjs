/* eslint-disable @typescript-eslint/no-require-imports */
// Render the real, display-only component. No browser or network dependencies.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const mod = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(path.join(root,
  'components/dating/OneOnOneCandidateRegionNotice.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText)(require, mod, mod.exports);
for (const value of [true, false, undefined, null, 'true', 1]) test(`candidate region notice only accepts explicit true (${value})`, () => {
  const html = renderToStaticMarkup(createElement(mod.exports.default, { widened: value }));
  if (value === true) {
    assert.match(html, /조금 더 넓은 지역의 후보예요\./);
    assert.match(html, /text-xs/); assert.match(html, /data-candidate-region-notice/);
    assert.ok(!/button|alert|\ufffd/.test(html));
  } else assert.equal(html, '');
});
