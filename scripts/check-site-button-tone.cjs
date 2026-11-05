/* eslint-disable @typescript-eslint/no-require-imports */
// Pin the reviewed presentation contract with JSX className attributes removed.
// Intentional UX changes must be regression-tested and explicitly re-baselined.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ts = require('typescript'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function contract(source) {
  source = require('./fixtures/private-contact-contract.cjs').withoutPrivateView(source);
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
// One reviewed, type-only API metadata addition; keep the pre-existing action
// contract pinned instead of rebasing matching/payment handlers with new UI.
function withoutNewCandidateNoticeType(source) {
  source = require('./fixtures/profile-state-contract.cjs').withoutProfileStateNotice(source, 'app/mypage/page.tsx');
  source = source.replace(/\r\n?/g, '\n');
  const line = '  new_candidate_notice?: import("@/lib/dating-1on1-new-candidate-notice").OneOnOneNewCandidateNotice | null;\n';
  assert.equal(source.split(line).length, 2, 'exactly one reviewed optional metadata type');
  return source.replace(line, '');
}
module.exports = { contract, withoutNewCandidateNoticeType };
if (require.main === module) {
  const { test } = require('node:test');
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/site-button-tone-contract.json'), 'utf8'));
  for (const [file, hash] of Object.entries(baseline.files)) {
    test('reviewed presentation contract: ' + file, () => {
      const raw = fs.readFileSync(path.join(root, file), 'utf8');
      const source = file === 'app/mypage/page.tsx' ? withoutNewCandidateNoticeType(raw) : raw;
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
