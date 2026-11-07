/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const cache = new Map();
function load(name) {
  if (name === '@/lib/region-distance') return { getRegionDistanceMeta: (_a, b) => ({ distanceKm: b === 'unknown' ? null : Number(b) }) };
  if (!name.startsWith('@/')) return require(name);
  if (cache.has(name)) return cache.get(name).exports;
  const mod = { exports: {} }; cache.set(name, mod);
  new Function('require', 'module', 'exports', ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '..', name.slice(2) + '.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText)(load, mod, mod.exports);
  return mod.exports;
}
const pages = load('@/lib/dating-1on1-recommendation-page');
const history = load('@/lib/dating-1on1-recommendation-history');
const now = Date.parse('2026-10-20T12:00:00Z');
const card = (id, patch = {}) => ({ id, age: 28, birth_year: 1999, sex: 'female', region: '30',
  created_at: '2026-01-01T00:00:00Z', ...patch });
const all = p => [...p.recommendations, ...p.extraRecommendations];
const ids = p => all(p).map(c => c.id);
const context = pool => ({ limit: 10, extraLimit: 3, handled: new Set(pool.filter(c => c.last_handled_at).map(c => c.id)),
  extraExcluded: new Set(pool.filter(c => c.last_handled_at).map(c => c.id)),
  observations: pool.map(c => ({ id: c.id, at: now - 86400000 })), recentPages: [] });
function run(source, pool, rounds = 30) {
  const ctx = context(pool), initial = { recommendations: pool.slice(0, 10), extraRecommendations: pool.slice(10, 13) };
  let previous = initial;
  const seen = new Set(ids(initial)), output = [];
  for (let step = 0; step < rounds; step++) {
    const at = now + step * 60000, seed = new Date(at).toISOString();
    const next = pages.nextRecommendationPage(source, pool, previous, seed, at, ctx);
    assert.deepEqual(next, pages.nextRecommendationPage(source, pool, previous, seed, at, ctx), 'same plan is deterministic');
    assert.equal(new Set(ids(next)).size, ids(next).length, 'main and extras cannot duplicate a person');
    assert.equal(next.recommendations.length, Math.min(10, pool.length));
    if (pool.length >= 26) assert.equal(ids(next).filter(id => ids(previous).includes(id)).length, 0, 'whole-page immediate overlap');
    for (const c of all(next)) seen.add(c.id);
    output.push({ page: next, covered: seen.size });
    // Model the SAME transactional trigger that captures old and new pages.
    if (!step) ctx.recentPages.push({ at: at - 1, ids: ids(previous) });
    ctx.recentPages.push({ at, ids: ids(next) });
    const restored = pages.restoreRecommendationPage(source, pool, { refreshed_at: seed, main_candidate_ids: next.recommendations.map(c => c.id),
      extra_candidate_ids: next.extraRecommendations.map(c => c.id) }, at + 2,
    { ...ctx, observations: [...ctx.observations, ...all(next).map(c => ({ id: c.id, at: at + 1 }))] });
    assert.deepEqual(restored, next, 'GET must preserve committed main AND recycled extra IDs after acknowledgements');
    previous = next;
  }
  return output;
}
for (const sex of ['male', 'female']) for (const size of [13, 20, 26, 40, 60, 130]) {
  test(`30 consecutive persisted refreshes cover all compatible locals (${sex}/${size})`, () => {
    const source = card('source', { sex });
    const pool = Array.from({ length: size }, (_, i) => card(`p${i}`, { sex: sex === 'male' ? 'female' : 'male',
      region: String([0, 15, 45, 70, 89][i % 5]),
      last_handled_at: i % 7 ? new Date(now - 5000).toISOString() : null,
      plus_expires_at: i % 3 ? null : new Date(now + 86400000).toISOString(),
      last_active_at: i % 2 ? new Date(now - 1000).toISOString() : null,
    }));
    const output = run(source, pool);
    assert.equal(output[Math.ceil(size / 13)].covered, size, 'age-compatible 90km band must not starve its 40-90km members');
    if (size >= 40) for (let i = 2; i < output.length; i++) {
      assert.equal(ids(output[i].page).filter(id => ids(output[i - 2].page).includes(id)).length, 0, 'no two-page ping-pong');
    }
  });
}
test('handled preference cannot send a young member to distant, large age gaps ahead of suitable revisits', () => {
  const source = card('source', { age: 25, sex: 'male' });
  const wrong = [35, 37, 38].map((age, i) => card(`wrong${i}`, { age, region: '300' }));
  const good = Array.from({ length: 60 }, (_, i) => card(`good${i}`, { age: 21 + i % 6, region: String(i % 90),
    last_handled_at: new Date(now - 1000).toISOString() }));
  const ctx = context([...wrong, ...good]);
  const next = pages.nextRecommendationPage(source, [...wrong, ...good], { recommendations: good.slice(0, 10), extraRecommendations: good.slice(10, 13) },
    new Date(now).toISOString(), now, ctx);
  assert.equal(all(next).length, 13);
  assert.ok(all(next).every(c => c.id.startsWith('good')));
});
test('compatible candidates across several distance bands do not ping-pong between two pages', () => {
  const source = card('source', { sex: 'male' });
  const pool = Array.from({ length: 41 }, (_, i) => card(`regional${i}`, {
    region: String([30, 120, 220, 300, 400][i % 5]),
  }));
  const output = run(source, pool);
  assert.equal(output[4].covered, 41);
  for (let i = 2; i < output.length; i++) {
    assert.equal(ids(output[i].page).filter(id => ids(output[i - 2].page).includes(id)).length, 0);
  }
});
test('nearby fresh profiles lead; scarce locals mix with age-compatible unseen regional rings', () => {
  const source = card('source', { sex: 'male' });
  const locals = Array.from({ length: 13 }, (_, i) => card(`local${i}`, { region: '30' }));
  const regional = Array.from({ length: 20 }, (_, i) => card(`regional${i}`, { region: '220' }));
  const far = Array.from({ length: 20 }, (_, i) => card(`far${i}`, { region: '400' }));
  const ctx = context(locals);
  const previous = { recommendations: locals.slice(0, 10), extraRecommendations: locals.slice(10, 13) };
  const next = pages.nextRecommendationPage(source, [...locals, ...regional, ...far], previous, new Date(now).toISOString(), now, ctx);
  assert.equal(next.recommendations.filter(c => c.id.startsWith('local')).length, 5);
  assert.ok(all(next).every(c => !c.id.startsWith('far')));
  const newcomer = card('new-local', { region: '20', created_at: new Date(now - 1000).toISOString() });
  const withNew = pages.nextRecommendationPage(source, [...locals, ...regional, ...far, newcomer], previous, new Date(now).toISOString(), now, ctx);
  assert.equal(withNew.recommendations[0].id, newcomer.id);
});
test('tiny pools stay full without inventing profiles; unknown regions and large age gaps stay last', () => {
  const source = card('source', { sex: 'male' });
  for (const size of [0, 1, 3, 7, 10, 12]) {
    const pool = Array.from({ length: size }, (_, i) => card(`tiny${i}`));
    const next = pages.nextRecommendationPage(source, pool, { recommendations: pool, extraRecommendations: [] },
      new Date(now).toISOString(), now, context(pool));
    assert.equal(next.recommendations.length, Math.min(size, 10));
    assert.equal(ids(next).length, size);
  }
  const pool = Array.from({ length: 30 }, (_, i) => card(`known${i}`, { region: '200' }));
  const next = pages.nextRecommendationPage(source, [...pool, card('unknown', { region: 'unknown' }), card('gap', { age: 60 })],
    { recommendations: pool.slice(0, 10), extraRecommendations: pool.slice(10, 13) }, new Date(now).toISOString(), now, context(pool));
  assert.ok(all(next).every(c => c.id.startsWith('known')));
});
test('a small compatible subset cannot imprison a larger eligible pool; age relaxes gradually', () => {
  const source = card('source', { sex: 'male', age: 28 });
  const fit = Array.from({ length: 11 }, (_, i) => card(`fit${i}`, { region: '220' }));
  const nextAge = Array.from({ length: 40 }, (_, i) => card(`next${i}`, { region: '220', age: 30 }));
  const extreme = Array.from({ length: 40 }, (_, i) => card(`extreme${i}`, { region: '10', age: 60 }));
  const pool = [...fit, ...nextAge, ...extreme], ctx = context(pool);
  let prior = { recommendations: fit.slice(0, 10), extraRecommendations: fit.slice(10) };
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const at = now + i * 60000, next = pages.nextRecommendationPage(source, pool, prior, new Date(at).toISOString(), at, ctx);
    assert.ok(next.recommendations.every(c => !c.id.startsWith('extreme')));
    assert.equal(next.recommendations.filter(c => ids(prior).includes(c.id)).length, 0);
    all(next).forEach(c => seen.add(c.id));
    ctx.recentPages.push({ at: at - 1, ids: ids(prior) }, { at, ids: ids(next) });
    prior = next;
  }
  assert.equal(seen.size, 51);
});
test('history is account scoped, bounded, gracefully absent before SQL, and never masks operational failure', async () => {
  const calls = [];
  const make = result => ({ from(t) { calls.push(['from', t]); const q = {};
    for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit']) q[method] = (...args) => { calls.push([method, ...args]); return q; };
    q.then = f => Promise.resolve(result).then(f); return q;
  } });
  assert.deepEqual(await history.readRecommendationHistory(make({ data: [{ refreshed_at: new Date(now - 1).toISOString(),
    main_candidate_ids: ['a'], extra_candidate_ids: ['b'] }], error: null }), 'owner', now), [{ at: now - 1, ids: ['a', 'b'] }]);
  assert.ok(calls.some(x => x[0] === 'eq' && x[1] === 'user_id' && x[2] === 'owner'));
  assert.ok(calls.some(x => x[0] === 'limit' && x[1] === 64));
  assert.equal(await history.readRecommendationHistory(make({ error: { code: '42P01' } }), 'owner', now), undefined);
  await assert.rejects(history.readRecommendationHistory(make({ error: { code: '42501' } }), 'owner', now), /unavailable/);
});
test('adjacent ages rotate too when the strict age-compatible pool is very small', () => {
  const source = card('source', { sex: 'female', age: 40 });
  const fit = Array.from({ length: 11 }, (_, i) => card(`fit${i}`, { sex: 'male', age: 40, region: '220' }));
  const adjacent = Array.from({ length: 70 }, (_, i) => card(`adjacent${i}`, {
    sex: 'male', age: 37 - i % 3, region: '220',
  }));
  const pool = [...fit, ...adjacent], ctx = context(pool);
  let prior = { recommendations: adjacent.slice(0, 10), extraRecommendations: fit.slice(0, 3) };
  const oldPages = [], seen = new Set();
  for (let i = 0; i < 30; i++) {
    const at = now + i * 60000, next = pages.nextRecommendationPage(source, pool, prior, new Date(at).toISOString(), at, ctx);
    assert.equal(next.recommendations.filter(c => ids(prior).includes(c.id)).length, 0);
    if (i >= 2) assert.ok(next.recommendations.filter(c => ids(oldPages[i - 2]).includes(c.id)).length <= 3,
      'scarce strict-age extras may repeat, but the main page must keep rotating adjacent ages');
    all(next).forEach(c => seen.add(c.id));
    ctx.recentPages.push({ at: at - 1, ids: ids(prior) }, { at, ids: ids(next) });
    oldPages.push(next); prior = next;
  }
  assert.equal(seen.size, 81);
});

for (const sex of ['male', 'female']) {
  test(`regional adjacent ages rotate before distant novelty or immediate local repeats (${sex})`, () => {
    const source = card('source', { sex, age: 28 });
    const targetSex = sex === 'male' ? 'female' : 'male';
    // Just outside the directional preferred age range, not an extreme age gap.
    const adjacentAge = sex === 'male' ? 30 : 26;
    const locals = Array.from({ length: 13 }, (_, i) => card(`local${i}`, { sex: targetSex }));
    const regional = Array.from({ length: 40 }, (_, i) => card(`regional${i}`, {
      sex: targetSex, region: '120', age: adjacentAge,
    }));
    const distant = Array.from({ length: 80 }, (_, i) => card(`distant${i}`, { sex: targetSex, region: '400' }));
    const pool = [...locals, ...regional, ...distant];
    for (const previouslySeen of [false, true]) {
      const ctx = context(previouslySeen ? [...locals, ...regional] : locals);
      let previous = { recommendations: locals.slice(0, 10), extraRecommendations: locals.slice(10) };
      const seenRegional = new Set();
      for (let step = 0; step < 30; step++) {
        const at = now + step * 60000;
        const next = pages.nextRecommendationPage(source, pool, previous, new Date(at).toISOString(), at, ctx);
        // Familiar but not recently displayed people also deserve a turn before
        // a 400km jump. Extras retain their existing preferred-age contract.
        assert.ok(next.recommendations.filter(c => Number(c.region) <= 180).length >= 5,
          'regional alternatives keep at least half the page');
        assert.ok(next.recommendations.filter(c => c.age === adjacentAge).length <= 5,
          'adjacent ages leave preferred-age choices available');
        assert.equal(next.recommendations.filter(c => ids(previous).includes(c.id)).length, 0, 'do not reinsert the previous local cards unnecessarily');
        next.recommendations.filter(c => c.id.startsWith('regional')).forEach(c => seenRegional.add(c.id));
        assert.ok(next.extraRecommendations.every(c => c.age === 28));
        assert.equal(new Set(ids(next)).size, ids(next).length);
        ctx.recentPages.push({ at: at - 1, ids: ids(previous) }, { at, ids: ids(next) });
        previous = next;
      }
      assert.equal(seenRegional.size, 40, 'regional alternatives must not become another small repeating set');
    }
  });
}

test('regional preference still respects preferred ages, missing regions and bounded adjacent ages', () => {
  const source = card('source', { sex: 'male', age: 28 });
  const previousCards = Array.from({ length: 13 }, (_, i) => card(`old${i}`));
  const previous = { recommendations: previousCards.slice(0, 10), extraRecommendations: previousCards.slice(10) };
  const preferred = Array.from({ length: 20 }, (_, i) => card(`preferred${i}`, { region: '120' }));
  const adjacent = Array.from({ length: 20 }, (_, i) => card(`adjacent${i}`, { region: '120', age: 30 }));
  const distant = Array.from({ length: 20 }, (_, i) => card(`distant${i}`, { region: '400' }));
  const ctx = context([...previousCards, ...preferred, ...adjacent]);
  const next = pages.nextRecommendationPage(source, [...previousCards, ...preferred, ...adjacent, ...distant], previous,
    new Date(now).toISOString(), now, ctx);
  assert.equal(next.recommendations.filter(c => c.id.startsWith('preferred')).length, 5, 'preferred age still wins inside the familiar regional half');
  assert.equal(next.recommendations.filter(c => c.id.startsWith('distant')).length, 5, 'unseen wider candidates still receive a turn');
  for (const patch of [{ region: 'unknown', age: 30 }, { region: '120', age: 32 }, { region: '120', age: 35 }]) {
    const unsuitable = Array.from({ length: 40 }, (_, i) => card(`unsuitable${i}`, patch));
    const fallback = pages.nextRecommendationPage(source, [...previousCards, ...unsuitable, ...distant], previous,
      new Date(now).toISOString(), now, context(previousCards));
    assert.ok(all(fallback).every(c => !c.id.startsWith('unsuitable')), 'unknown regions and large gaps cannot displace age-compatible options');
  }
});

test('after regional novelty is exhausted, 30 refreshes still widen without losing nearby alternatives', () => {
  const source = card('source', { sex: 'male', age: 28 });
  const locals = Array.from({ length: 13 }, (_, i) => card(`local${i}`));
  const regional = Array.from({ length: 40 }, (_, i) => card(`regional${i}`, { age: 30, region: '120' }));
  const wider = Array.from({ length: 400 }, (_, i) => card(`wider${i}`, { region: '220' }));
  const tooFar = Array.from({ length: 50 }, (_, i) => card(`far${i}`, { region: '450' }));
  const pool = [...locals, ...regional, ...wider, ...tooFar], ctx = context(locals);
  let previous = { recommendations: locals.slice(0, 10), extraRecommendations: locals.slice(10) };
  let widenedMain = 0;
  const regionalSeen = new Set();
  for (let step = 0; step < 30; step++) {
    const at = now + step * 60000, seed = new Date(at).toISOString();
    const next = pages.nextRecommendationPage(source, pool, previous, seed, at, ctx);
    assert.deepEqual(next, pages.nextRecommendationPage(source, pool, previous, seed, at, ctx));
    assert.equal(next.recommendations.length, 10);
    assert.equal(next.extraRecommendations.length, 3);
    assert.equal(new Set(ids(next)).size, 13);
    assert.equal(next.recommendations.filter(c => ids(previous).includes(c.id)).length, 0);
    assert.ok(all(next).every(c => c.region !== '450'), 'expand one available distance band at a time');
    assert.ok(next.recommendations.filter(c => Number(c.region) <= 180).length >= 5);
    assert.ok(next.recommendations.filter(c => c.age !== 28).length <= 5, 'adjacent ages cannot replace the whole page');
    next.recommendations.filter(c => c.id.startsWith('regional')).forEach(c => regionalSeen.add(c.id));
    widenedMain += next.recommendations.filter(c => c.id.startsWith('wider')).length;
    ctx.recentPages.push({ at: at - 1, ids: ids(previous) }, { at, ids: ids(next) });
    const restored = pages.restoreRecommendationPage(source, pool, { refreshed_at: seed,
      main_candidate_ids: next.recommendations.map(c => c.id), extra_candidate_ids: next.extraRecommendations.map(c => c.id) }, at + 1, ctx);
    assert.deepEqual(restored, next, 'loading the page does not rerank or charge a refresh');
    previous = next;
  }
  assert.equal(regionalSeen.size, 40);
  assert.ok(widenedMain >= 100, 'nearby revisits cannot starve unseen wider candidates');
});

test('adjacent-age priority cap is not a hard filter when the entire eligible pool is scarce', () => {
  const source = card('source', { sex: 'male', age: 28 });
  for (const size of [1, 4, 7, 10, 20]) {
    const pool = Array.from({ length: size }, (_, i) => card(`regional${i}`, { age: 30, region: '120' }));
    const next = pages.nextRecommendationPage(source, pool, { recommendations: [], extraRecommendations: [] },
      new Date(now).toISOString(), now, context([]));
    assert.equal(next.recommendations.length, Math.min(10, size));
    assert.equal(next.extraRecommendations.length, 0, 'extras retain their preferred-age rule');
  }
});
