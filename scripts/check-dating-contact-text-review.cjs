/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic fixtures only. No database, photos, email or moderation writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const m = { exports: {} };
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/dating-contact-text-review.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(m.exports);
const { reviewDatingContactText: review } = m.exports;

for (const token of ['fixture_handle', '__fixture__', 'fixture.name', 'fixture_._name', 'fixture99', 'f.0.x.2', 'fixtureletter', '____fixture', 'fixture9_', '99.fixture__', 'fixturecontact2']) {
  for (const field of ['intro','strengths','ideal','idealType','preferredPartner']) {
    test(`bare handle ${token} in ${field} needs visible medium review`, () => {
      const text = `운동하고 산책하는 것을 좋아해요.\n${token}`;
      const result = review({[field]:text});
      assert.equal(result.level,'medium');
      assert.ok(result.flags.some(f=>f.includes('감지: '+token)));
      assert.equal(text, `운동하고 산책하는 것을 좋아해요.\n${token}`);
    });
  }
}
for (const text of [
  '인스타 fixture_handle', '인스타 아이디는 fixture_handle입니다', '인별:fixture.handle', 'IG: fixture_handle',
  'ins : fixture_handle', '인 스 타 : fixture_handle', '인\u200b스타 : fixture_handle', 'ｉｎｓ： ｆｉｘｔｕｒｅ＿ｈａｎｄｌｅ',
  '카톡: fixture99', 'ㅋㅌ fixture99', '카카오톡 아이디 fixture99', '아이디는 fixture_handle',
  'fixture_handle으로 연락 주세요', '@fixturehandle', '디엠 주세요', 'DM 주세요', '인스타로 연락주세요',
  '텔레그램 fixture99', '라인 fixture99', 'https://example.test/contact', 'instagram.com/fixturehandle',
  'open.kakao.com/o/fixture', 't.me/fixturehandle', 'fixture@example.test', '010-1234-5678',
  '0 1 0 1 2 3 4 5 6 7 8', '+82 10 1234 5678',
  '인스타: running', '인스타 아이디 coffee', 'IG: happy', '카톡 @running',
]) test('explicit contact: '+text,()=>{
  assert.equal(review({intro:text}).level,'high');
});
for (const text of [
  '온라인 쇼핑몰에서 일하고 있어요', '디엠씨역 근처에 살아요', '연락 잘해요', '연락을 잘하는 사람이 좋아요',
  '본인스타일대로 꾸미는 분', '안정적인 스타일입니다', '인스타는 안 해요', '인스타 보고 가입했어요',
  '인스타 릴스 보는 것이 취미예요', '인스타 아이디는 없어요', '카카오톡은 잘 안 해요',
  'Bright한 성격', 'I am a designer and I like running.', 'MBTI는 ENFP-T입니다', 'ISFJ_A', '__TP',
  '178cm 76kg 골격근 40kg 10km 러닝 100kg 1RM', '3.5km 24.5kg 180cm.', '주 5회 운동합니다',
  'Node.js와 Next.js 개발자', 'Microsoft Azure Cloud', '헬스\nCrossFit', '운동\nPilates',
  '차분해요\npositive', 'Xx.....', 'xxxx.', '[연락처 삭제]', 'iPhone15', 'SQL2022', 'Zone2', 'Omega3',
]) test('ordinary prose stays clear: '+text,()=>assert.deepEqual(review({intro:text}),{level:'clear',flags:[]}));

test('registered contact field and all recipient/technical metadata are not authored prose',()=>{
  assert.deepEqual(review({instagramId:'fixture_handle',candidateName:'@recipient',candidateRegion:'instagram.com/other',
    candidateUserId:'fixture99',sourceCardId:'uuid',matchId:'fixture_handle',targetCardId:'@recipient',
    intro:'다정하고 약속을 잘 지키는 사람입니다.'}),{level:'clear',flags:[]});
});
test('a registered handle pasted into prose is detected, dedicated field alone is not',()=>{
  const result=review({instagramId:'fixturecontact',intro:'조용한 성격입니다 fixturecontact 입니다.'});
  assert.equal(result.level,'medium'); assert.ok(result.flags[0].includes('등록 인스타'));
});
test('an ordinary-looking registered handle in prose still gets manual review',()=>{
  assert.equal(review({instagramId:'running',intro:'조용한 성격입니다 running 입니다.'}).level,'medium');
  assert.equal(review({instagramId:'running',intro:'저의 계정은 running 입니다.'}).level,'high');
  assert.equal(review({instagramId:'running',intro:'러닝과 산책을 좋아해요.'}).level,'clear');
});
test('cross-field words cannot accidentally create a contact instruction',()=>{
  assert.deepEqual(review({intro:'인스타',strengths:'영문 관련 일을 해요',candidateName:'fixture_handle'}),{level:'clear',flags:[]});
});
test('normal employer/name words are not bare handle candidates',()=>{
  assert.deepEqual(review({name:'fixtureletter',job:'company_123'}),{level:'clear',flags:[]});
  assert.equal(review({job:'인스타: fixture_handle'}).level,'high');
});
test('deterministic, bounded UTF-8 findings; caller data is unchanged',()=>{
  const input={intro:'🙂\nfixture_handle',strengths:'@fixturecontact'};
  const before=JSON.stringify(input), expected=review(input);
  for(let i=0;i<30;i++)assert.deepEqual(review(input),expected);
  assert.equal(JSON.stringify(input),before);
  const lots=review({intro:Array.from({length:100},(_,i)=>'@fixture'+i).join('\n')});
  assert.ok(lots.flags.length<=10);
  for(const flag of lots.flags)assert.equal(Buffer.from(flag,'utf8').toString('utf8'),flag);
});
