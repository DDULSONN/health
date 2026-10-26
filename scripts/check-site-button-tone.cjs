/* eslint-disable @typescript-eslint/no-require-imports */
// Pin the pre-polish source with ONLY JSX className attributes removed.
// Text, handlers, hrefs, disabled states, API calls and render conditions must not change.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ts = require('typescript'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function contract(source) {
  const ast = ts.createSourceFile('view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = ts.transform(ast, [context => function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'className') return undefined;
    return ts.visitEachChild(node, visit, context);
  }]);
  const canonical = ts.createPrinter({ removeComments: true }).printFile(result.transformed[0]);
  result.dispose();
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
module.exports = { contract };
if (require.main === module) {
  const { test } = require('node:test');
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/site-button-tone-contract.json'), 'utf8'));
  for (const [file, hash] of Object.entries(baseline.files)) {
    test('presentation-only contract: ' + file, () => {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      assert.equal(contract(source), hash, 'Only className changes are allowed in this polish');
      assert.ok(!source.includes('\uFFFD'), 'No broken Unicode');
    });
  }
}
