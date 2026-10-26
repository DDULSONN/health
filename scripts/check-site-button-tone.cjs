/* eslint-disable @typescript-eslint/no-require-imports */
// Pin the reviewed presentation contract with JSX className attributes removed.
// Intentional UX changes must be regression-tested and explicitly re-baselined.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ts = require('typescript'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function contract(source) {
  // Git uses LF on Linux and may check out CRLF on Windows. JSX text retains
  // source line endings even when the printer's newLine option is specified.
  source = source.replace(/\r\n?/g, '\n');
  const ast = ts.createSourceFile('view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = ts.transform(ast, [context => function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'className') return undefined;
    return ts.visitEachChild(node, visit, context);
  }]);
  const canonical = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0]);
  result.dispose();
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
module.exports = { contract };
if (require.main === module) {
  const { test } = require('node:test');
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/site-button-tone-contract.json'), 'utf8'));
  for (const [file, hash] of Object.entries(baseline.files)) {
    test('reviewed presentation contract: ' + file, () => {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      assert.equal(contract(source), hash, 'Non-style changes require behavior tests and a reviewed baseline');
      assert.equal(contract(source.replace(/\r?\n/g, '\r\n')), hash, 'Windows checkout must match');
      assert.equal(contract(source.replace(/\r\n/g, '\n')), hash, 'Linux checkout must match');
      assert.ok(!source.includes('\uFFFD'), 'No broken Unicode');
    });
  }
  test('contract ignores styles, but detects text, action and condition changes', () => {
    const original = 'export const View = () => <button className="old" disabled={busy} onClick={submit}>수락</button>;';
    const hash = contract(original);
    assert.equal(contract(original.replace('className="old"', 'className="new"')), hash);
    for (const [before, after] of [['수락', '거절'], ['submit', 'cancel'], ['{busy}', '{false}']]) {
      assert.notEqual(contract(original.replace(before, after)), hash);
    }
  });
}
