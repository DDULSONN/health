/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { test } = require('node:test'), ts = require('typescript'), { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n'); }
function load(p) {
  const m = { exports: {} }, js = ts.transpileModule(read(p), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', js)(name => name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name), m, m.exports);
  return m.exports;
}
const { sanitizeDraft } = load('lib/dating-onboarding-draft.ts');
const resume = load('lib/dating-draft-resume.ts');
const draft = fields => sanitizeDraft({ version: 1, userId: 'a', savedAt: Date.now(), step: 1, targets: { open: true, oneOnOne: true }, fields }, 'a');
test('home summary contains no written contents or completed-step claims', () => {
  const d = resume.summarizeDatingDraft(draft({ introText: 'PRIVATE_TEXT', name: 'PRIVATE_NAME' }));
  assert.deepEqual(Object.keys(d).sort(), ['savedAt','step','targets','userId'].sort());
  assert.ok(!JSON.stringify(d).includes('PRIVATE'));
  assert.equal(resume.datingDraftStepLabel(1), '내 소개');
  assert.equal(resume.datingDraftStepLabel(99), '기본 정보');
});
test('empty/default-only drafts are not advertised', () => {
  assert.equal(resume.summarizeDatingDraft(null), null);
  assert.equal(resume.summarizeDatingDraft(draft({ nickname: '닉네임' })), null);
  const d = draft({ job: '회사원' }); d.targets = { open: false, oneOnOne: false };
  assert.equal(resume.summarizeDatingDraft(d), null);
});
for (const targets of [{ open: true, oneOnOne: true }, { open: true, oneOnOne: false }, { open: false, oneOnOne: true }]) {
  for (const open of [false, true]) for (const oneOnOne of [false, true]) test('resume eligibility ' + JSON.stringify({ targets, open, oneOnOne }), () => {
    const d = { ...resume.summarizeDatingDraft(draft({ job: '회사원' })), targets };
    assert.equal(resume.canResumeDatingDraft(d, { open, oneOnOne }), (targets.open && !open) || (targets.oneOnOne && !oneOnOne));
  });
}
test('intro examples never populate inputs and never submit the form', () => {
  const source = read('components/dating/GuidedIntroductionField.tsx');
  assert.equal((source.match(/onChange\(/g) || []).length, 1);
  assert.match(source, /onChange\(event\.target\.value\)/);
  assert.match(source, /type="button"/);
  assert.ok(!/fetch\(|localStorage|innerHTML|onChange\(example/.test(source));
});
test('home draft refresh never adds server traffic or timers', () => {
  const source = read('lib/use-dating-draft-resume.ts');
  assert.ok(!/fetch\(|getUser\(|setInterval\(|setTimeout\(/.test(source));
  assert.match(source, /session\?\.user\.id === userId/);
  assert.match(source, /draft\?\.userId === userId/);
});
test('validation, photo handling, draft restore, submission and all mutation backends unchanged', () => {
  const base = file => execFileSync('git', ['show', '185a0e8:' + file], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');
  for (const file of ['lib/dating-onboarding-validation.ts','lib/dating-onboarding-draft.ts','lib/use-dating-onboarding-draft.ts',
    'app/api/dating/cards/my/route.ts','app/api/dating/1on1/cards/route.ts','app/api/mypage/phone-verification/send/route.ts',
    'app/api/mypage/phone-verification/verify/route.ts','app/api/payments/toss/confirm/route.ts']) assert.equal(read(file), base(file), file);
  const file = 'app/onboarding/dating/page.tsx', before = base(file), after = read(file);
  const handlers = s => s.slice(s.indexOf('  const resumeDraft ='), s.indexOf('  if (checking)'));
  assert.equal(handlers(after), handlers(before));
  const changed = execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' });
  assert.ok(!changed.includes('app/api/'));
});
