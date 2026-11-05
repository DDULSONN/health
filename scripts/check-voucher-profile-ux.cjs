/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file) {
  const loaded = { exports: {} };
  new Function('module', 'exports', ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(loaded, loaded.exports);
  return loaded.exports;
}
const { oneOnOneProfileState, ONE_ON_ONE_PROFILE_MANAGE_HREF } = load('lib/dating-1on1-profile-state.ts');
const { contactCareMatchLabel } = load('lib/contact-care-presentation.ts');

test('own archive is different from a held profile without disclosing internal notes', () => {
  const archived = { status: 'rejected', archived: true, admin_note: 'PRIVATE NOTE', admin_tags: ['private_tag'] };
  assert.equal(oneOnOneProfileState(archived).kind, 'archived');
  for (const flag of [false, undefined, null, 'true', 1]) {
    assert.equal(oneOnOneProfileState({ ...archived, archived: flag }).kind, 'held');
  }
  assert(!JSON.stringify(oneOnOneProfileState(archived)).includes('PRIVATE'));
  assert.deepEqual(archived.admin_tags, ['private_tag']);
});
for (const status of ['submitted', 'reviewing', 'approved']) test(`${status} remains active despite a stale archived flag`, () => {
  assert.equal(oneOnOneProfileState({ status, archived: true }).kind, 'active');
});
test('unknown status never implies rejected or archived', () => {
  assert.equal(oneOnOneProfileState({}).label, '상태 확인 중');
  assert.equal(oneOnOneProfileState({ status: 'unexpected', archived: true }).kind, 'active');
});
test('manage link selects the existing matching filter and existing anchor', () => {
  const url = new URL(ONE_ON_ONE_PROFILE_MANAGE_HREF, 'https://local.invalid');
  assert.equal(url.searchParams.get('section'), 'matching');
  assert.equal(url.searchParams.get('match'), 'one_on_one');
  assert.match(read('app/mypage/page.tsx'), /id="one-on-one-status"/);
});
test('only same-name choices retain a disambiguating identifier', () => {
  const a = { id: 'aaaaaaaa-0000', name: '유진' }, b = { id: 'bbbbbbbb-0000', name: '지민' };
  assert.equal(contactCareMatchLabel(a, [a, b]), '유진');
  assert.equal(contactCareMatchLabel(a, [a, { ...b, name: ' 유진 ' }]), '유진 · aaaaaaaa');
  assert.equal(contactCareMatchLabel({ ...a, name: ' ' }, [{ ...a, name: ' ' }]), '상대');
});
test('presentation never restores profiles, redeems on render, or changes payment guards', () => {
  const notice = read('components/dating/OneOnOneProfileStateNotice.tsx');
  assert.doesNotMatch(notice, /fetch\(|onClick|admin_note|admin_tags/);
  const care = read('components/dating/ContactCarePanel.tsx');
  assert(care.indexOf('data-care-vouchers') < care.indexOf('data-care-policy'));
  assert(care.indexOf('data-care-vouchers') < care.indexOf('data-care-application'));
  assert.match(care, /if \(e.target !== e.currentTarget\) return/);
  assert.match(care, /disabled=\{busy \|\| stale \|\| !target \|\| target === checkoutMatch\}/);
  assert.match(care, /if \(action !== "apply" && target === checkoutMatch\) return/);
  assert.match(care, /window.confirm\(/);
  assert.match(read('components/dating/OneOnOneHomePanel.tsx'), /!hasOneOnOneCard && myCards\[0\]\?\.status === "rejected"/);
  assert.doesNotMatch(read('app/mypage/page.tsx'), /운영 메모: \{item.admin_note\}/);
});
