/* eslint-disable @typescript-eslint/no-require-imports -- Test the real TypeScript modules without an extra runtime. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function createLoader(baseline = false) {
  const cache = new Map();
  return function load(name) {
    if (!name.startsWith('@/')) return require(name);
    if (cache.has(name)) return cache.get(name).exports;
    const relative = name.slice(2) + '.ts';
    const source = baseline && ['lib/region-distance.ts', 'lib/region-city.ts'].includes(relative)
      ? execFileSync('git', ['show', 'acfd7e4:' + relative], { cwd: root, encoding: 'utf8' })
      : fs.readFileSync(path.join(root, relative), 'utf8');
    const mod = { exports: {} }; cache.set(name, mod);
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', output)(load, mod, mod.exports);
    return mod.exports;
  };
}
const load = createLoader();
const baseline = createLoader(true)('@/lib/region-distance');
const { getRegionCoordinate: coord, getRegionDistanceMeta: distance } = load('@/lib/region-distance');
const { extractProvinceFromRegion } = load('@/lib/region-city');
const rows = load('@/lib/korea-admin-division-coords').KOREA_ADMIN_DIVISION_COORDS;
const aliases = {
  서울: ['서울', '서울시', '서울특별시'], 부산: ['부산', '부산시', '부산광역시'],
  대구: ['대구', '대구시', '대구광역시'], 인천: ['인천', '인천시', '인천광역시'],
  광주: ['광주', '광주시', '광주광역시'], 대전: ['대전', '대전시', '대전광역시'],
  울산: ['울산', '울산시', '울산광역시'], 세종: ['세종', '세종시', '세종특별자치시'],
  경기: ['경기', '경기도'], 강원: ['강원', '강원도', '강원특별자치도'],
  충북: ['충북', '충청북도'], 충남: ['충남', '충청남도'],
  전북: ['전북', '전라북도', '전북특별자치도'], 전남: ['전남', '전라남도'],
  경북: ['경북', '경상북도'], 경남: ['경남', '경상남도'], 제주: ['제주', '제주도', '제주특별자치도'],
};

for (const [province, names] of Object.entries(aliases)) {
  test(`${province}: province-only aliases share the original canonical reference`, () => {
    for (const name of names) assert.deepEqual(coord(name), baseline.getRegionCoordinate(province), name);
  });
  test(`${province}: every existing municipality retains its coordinates across province aliases and spacing`, () => {
    for (const [rawProvince, city] of rows) {
      if ((extractProvinceFromRegion(rawProvince) ?? extractProvinceFromRegion(city) ?? rawProvince) !== province) continue;
      if (rawProvince === '전라' && city === '광주시') continue; // Invalid duplicate removed.
      if (rawProvince === '경상' && city === '고성군') continue; // Corrected separately below.
      const original = province === '강원' && city === '고성군'
        ? { province, city, longitude: 128.470164, latitude: 38.377961, precision: 'city' }
        : baseline.getRegionCoordinate(`${province} ${city}`);
      if (original?.precision !== 'city') continue; // Legacy rows without a valid province aren't new coordinates.
      for (const name of names) {
        for (const separator of [' ', '', '  ', '/', ' · ']) {
          const input = `${name}${separator}${city}`;
          assert.deepEqual(coord(input), original, input);
        }
      }
    }
  });
}

for (const [input, canonical] of [
  ['경기도 안양시', '경기 안양시'], ['충청북도 제천시', '충북 제천시'],
  ['서울특별시강남구', '서울 강남구'], ['부산광역시 해운대구', '부산 해운대구'],
  ['성남시 분당구', '경기 성남시'], ['경기도성남시분당구', '경기 성남시'],
  ['수원시 권선구', '경기 수원시'], ['고양시 일산', '경기 고양시'],
  ['서울 강남구 역삼동', '서울 강남구'], ['서울강남구역삼동', '서울 강남구'],
  ['분당', '경기 성남시'], ['판교', '경기 성남시'], ['동탄', '경기 화성시'], ['일산', '경기 고양시'],
  ['경기 광주시', '경기 광주시'], ['경기도광주', '경기 광주시'],
  ['강원도 고성군', '강원 고성군'], ['경상남도 고성군', '경남 고성군'],
  ['부산 강서구', '부산 강서구'], ['서울 강서구', '서울 강서구'],
  ['제주시', '제주 제주시'], ['경기 (안양시)', '경기 안양시'],
  ['부산 진구', '부산 부산진구'], ['부산광역시 진구', '부산 부산진구'],
  ['대구광역시수성구범어동', '대구 수성구'],
]) {
  test(`${input} resolves to ${canonical}`, () => {
    assert.deepEqual(coord(input), coord(canonical));
    assert.equal(coord(input)?.precision, 'city');
    assert.equal(distance(input, canonical).distanceKm, 0);
  });
}

test('Gwangju metropolitan and Gyeonggi Gwangju stay separate', () => {
  assert.equal(coord('광주')?.province, '광주'); // Existing province selector uses this canonical value.
  assert.equal(coord('광주광역시 북구')?.province, '광주');
  assert.equal(coord('경기도 광주시')?.province, '경기');
  assert.ok(distance('광주광역시', '경기도 광주시').distanceKm > 200);
});
test('both Goseong municipalities use their own dataset coordinate, not last-write-wins', () => {
  assert.equal(coord('강원 고성군').latitude, 38.377961);
  assert.equal(coord('경남 고성군').latitude, 34.9699);
  assert.ok(distance('강원 고성군', '경남 고성군').distanceKm > 350);
});
test('ambiguous standalone names do not introduce a new recommendation policy', () => {
  for (const input of ['강서구', '중구', '북구', '남구', '동구', '서구']) assert.deepEqual(coord(input), baseline.getRegionCoordinate(input), input);
});
test('multiple province inputs preserve existing selection until a primary/multiple-location policy is chosen', () => {
  for (const input of ['서울, 수원', '서울 수원', '인천 부평구 - 경기도 화성시', '제주 제주시/대전 유성구', '강원 고성 / 경남 고성']) {
    const previous = baseline.getRegionCoordinate(input);
    const next = coord(input);
    assert.equal(next?.province, previous?.province, input);
    assert.equal(next?.precision, previous?.precision, input);
    assert.equal(next?.city, previous?.city, input);
  }
});
test('multiple city selection stays compatible, duplicates keep city precision', () => {
  assert.deepEqual(coord('경기 안양시 / 수원시'), baseline.getRegionCoordinate('경기 안양시 / 수원시'));
  assert.deepEqual(coord('서울 강남구·마포구'), baseline.getRegionCoordinate('서울 강남구·마포구'));
  assert.deepEqual(coord('경기 성남시 / 분당'), coord('경기 성남시'));
});
test('unknown and broad inputs remain safe and do not invent cities', () => {
  for (const input of [null, '', '  ', '해외', '미정', 'unknown', '__proto__', 'constructor']) assert.equal(coord(input), null, String(input));
  for (const input of ['위례', '잠실', '신림', '천안아산']) assert.deepEqual(coord(input), baseline.getRegionCoordinate(input), input);
  for (const input of ['경기남부', '경기도 아무지역', '서울 미정']) assert.equal(coord(input)?.precision, 'province');
});
test('recommendation ranking is invariant to full province spelling', () => {
  const rules = load('@/lib/dating-1on1-recommendations');
  const now = Date.parse('2026-09-20T09:00:00Z');
  const regions = ['서울 강남구', '경기 안양시', '경기 평택시', '강원 춘천시', '충북 제천시', '부산 해운대구', '광주 북구', '제주 제주시'];
  const expand = region => region.replace(/^\S+/, province => aliases[province].at(-1));
  const card = (id, region) => ({ id, user_id: id, age: 28, birth_year: 1999, sex: 'female', region, created_at: '2026-01-01T00:00:00Z' });
  const pool = regions.flatMap((region, index) => Array.from({ length: 4 }, (_, j) => card(`${index}-${j}`, region)));
  for (const region of regions) {
    const source = { ...card('source', region), sex: 'male', age: 30 };
    for (const seed of ['day', 'refresh:1', 'refresh:2']) {
      const a = rules.sortCandidatesForSource(source, pool, seed, now).map(c => c.id);
      const b = rules.sortCandidatesForSource({ ...source, region: expand(region) }, pool.map(c => ({ ...c, region: expand(c.region) })), seed, now).map(c => c.id);
      assert.deepEqual(b, a, `${region}/${seed}`);
    }
  }
});
