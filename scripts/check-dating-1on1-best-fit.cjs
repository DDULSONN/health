/* eslint-disable @typescript-eslint/no-require-imports */
// Pure synthetic ranking cases; no app, database, network, or production members.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(name) {
  if (!name.startsWith('@/')) return require(name);
  if (cache.has(name)) return cache.get(name).exports;
  const mod = { exports: {} };
  cache.set(name, mod);
  const source = fs.readFileSync(path.join(root, name.slice(2) + '.ts'), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', js)(load, mod, mod.exports);
  return mod.exports;
}

const { rankSingleCandidateAlternatives: rank, isSingleCandidateBestFitAllowed: allowed } = load('@/lib/dating-1on1-best-fit');
const { getRegionDistanceMeta } = load('@/lib/region-distance');
const source = Object.freeze({ id: 'source', user_id: 'viewer', sex: 'male', age: 32, region: '서울 마포구', created_at: '2026-11-01T00:00:00.000Z' });
const candidate = (id, fields = {}) => ({ ...source, id, user_id: `user-${id}`, sex: 'female', age: 30, ...fields });
const ids = rows => rows.map(c => c.id);
const members = rows => new Set(rows.map(c => c.user_id));
const empty = new Set();

test('local preference first; slight local age deviation beats distant preferred age but a large gap does not', () => {
  const local = candidate('closest');
  const minorDeviation = candidate('near-similar', { age: 34 });
  const farSameAge = candidate('far-preferred', { age: 32, region: '부산 해운대구' });
  const majorDeviation = candidate('near-not-similar', { age: 48 });
  assert.ok(getRegionDistanceMeta(source.region, farSameAge.region).distanceKm > 180);
  assert.deepEqual(ids(rank(source, [majorDeviation, farSameAge, minorDeviation, local], empty, empty)),
    ['closest', 'near-similar', 'far-preferred', 'near-not-similar']);
});

test('likewise retain existing asymmetric preference range for female viewers', () => {
  const female = { ...source, sex: 'female' };
  const inRangeFemale = candidate('fits-female', { sex: 'male', age: 36 });
  const oneStepLower = candidate('not-in-range-female', { sex: 'male', age: 30 });
  assert.deepEqual(ids(rank(female, [oneStepLower, inRangeFemale], empty, empty)), ['fits-female', 'not-in-range-female']);
});

test('within-preference age wins a score tie against local adjacent age', () => {
  const inRange = candidate('fits', { region: '경기 용인시', age: 32 });
  const adjacent = candidate('adjacent', { age: 34 });
  const km = getRegionDistanceMeta(source.region, inRange.region).distanceKm;
  assert.ok(km > 40 && km <= 90, `fixture needs a neighboring distance band; got ${km}`);
  assert.deepEqual(ids(rank(source, [adjacent, inRange], empty, empty)), ['fits', 'adjacent']);
});

test('unseen options always lead; prior viewers remain available as off-page fallback', () => {
  const nearSeen = candidate('seen-local');
  const farUnseen = candidate('unseen-far', { region: '부산 해운대구' });
  const farSeen = candidate('seen-far', { region: '제주 서귀포시' });
  assert.deepEqual(ids(rank(source, [nearSeen, farSeen, farUnseen], empty, members([nearSeen, farSeen]))),
    ['unseen-far', 'seen-local', 'seen-far']);
  assert.deepEqual(ids(rank(source, [farSeen], empty, members([farSeen]))), ['seen-far']);
});

test('seen profiles with comparable fit rotate the least recently exposed before exact distance and creation', () => {
  const closestRecent = candidate('closest-recent', { region: '서울 마포구', created_at: '2026-11-23T06:00:00.000Z' });
  const slightlyFartherOld = candidate('slightly-farther-old', { region: '서울 서초구', created_at: '2025-12-01T00:00:00.000Z' });
  const similarUnknown = candidate('similar-unknown', { region: '서울 종로구' });
  const timestamps = new Map([[closestRecent.user_id, 2000], [slightlyFartherOld.user_id, 1000], [similarUnknown.user_id, NaN]]);
  const pool = [closestRecent, slightlyFartherOld, similarUnknown];
  assert.deepEqual(ids(rank(source, pool, empty, members(pool), timestamps)), ['slightly-farther-old', 'closest-recent', 'similar-unknown']);
});

test('recognized distance is not assumed for unknown data, and age still ranks unknowns', () => {
  const known = candidate('known', { age: 39, region: '제주 서귀포시' });
  const unknownCloseAge = candidate('unknown-similar', { age: 32, region: '기록없음' });
  const unknownFarAge = candidate('unknown-different', { age: 38, region: '' });
  assert.deepEqual(ids(rank(source, [unknownFarAge, known, unknownCloseAge], empty, empty)),
    ['known', 'unknown-similar', 'unknown-different']);
  assert.deepEqual(ids(rank({ ...source, region: '기록없음' }, [known, unknownCloseAge, unknownFarAge], empty, empty)),
    ['unknown-similar', 'unknown-different', 'known']);
});

test('age and distance are preferences, not absolute filters for otherwise legitimate profiles', () => {
  const adultAtDistance = candidate('only-adult', { age: 19, region: '제주 서귀포시' });
  assert.equal(allowed(source, adultAtDistance), true);
  assert.deepEqual(ids(rank(source, [adultAtDistance], empty, empty)), ['only-adult']);
  assert.equal(allowed(source, { ...adultAtDistance, region: '기록없음' }), true);
  assert.deepEqual(rank(source, [], empty, empty), []);
});

test('filter excluded owners across card revisions and never accept own, same-sex, underage or malformed profiles', () => {
  const visibleMember = candidate('visible-new-revision', { user_id: 'visible-owner' });
  const onlySafe = candidate('safe', { age: 37 });
  const invalid = [candidate('own', { user_id: source.user_id }), candidate(source.id), candidate('wrong-sex', { sex: source.sex }),
    candidate('wrong-type', { age: '26' }), candidate('fractional', { age: 27.5 }), candidate('minor', { age: 18 }),
    candidate('no-age', { age: null }), candidate('non-finite', { age: Infinity })];
  assert.ok(invalid.every(x => !allowed(source, x)));
  assert.equal(allowed({ ...source, age: 18 }, onlySafe), false);
  assert.deepEqual(ids(rank(source, [...invalid, onlySafe, visibleMember], new Set(['visible-owner']), empty)), ['safe']);
});

test('freshness then a deterministic ID breaks ties without mutating or truncating input', () => {
  const newest = candidate('newest', { created_at: '2026-11-23T10:00:00.000Z' });
  const olderA = candidate('older-a');
  const olderB = candidate('older-b');
  const noDate = candidate('unknown-date', { created_at: 'invalid' });
  const first = [noDate, olderB, olderA, newest];
  const frozen = Object.freeze(first.map(Object.freeze));
  const expected = ['newest', 'older-a', 'older-b', 'unknown-date'];
  assert.deepEqual(ids(rank(source, frozen, empty, empty)), expected);
  assert.deepEqual(ids(rank(source, [...frozen].reverse(), empty, empty)), expected);
  assert.deepEqual(ids(frozen), ['unknown-date', 'older-b', 'older-a', 'newest']);
  const large = Array.from({ length: 78 }, (_, i) => candidate(`large-${i}`));
  assert.equal(rank(source, large, empty, empty).length, 78);
});
