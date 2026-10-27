/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness transpiles the real TS modules. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
// Load the real TypeScript modules, without adding a runtime/test dependency.
function createLoader(overrides = {}, nowMs) {
  const cache = new Map();
  const Clock = nowMs == null ? Date : class extends Date {
    constructor(...args) { super(...(args.length ? args : [nowMs])); }
    static now() { return nowMs; }
  };
  return function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith("@/")) return require(name);
    const filename = path.join(root, `${name.slice(2)}.ts`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", "Date", output)(load, loadedModule, loadedModule.exports, Clock);
    return loadedModule.exports;
  };
}
const load = createLoader();
const rules = load("@/lib/dating-1on1-recommendations");
const now = Date.parse("2026-08-31T03:00:00Z");
const day = 86400000;
const card = (id, overrides = {}) => ({
  id, user_id: `user-${id}`, sex: "female", age: 28, birth_year: 1999,
  region: "서울 강남구", created_at: "2026-01-01T00:00:00Z", ...overrides,
});
const source = card("source", { sex: "male", age: 30 });
const ids = (cards) => cards.map((candidate) => candidate.id);

for (const sex of ['male', 'female']) for (const unhandledCount of [0, 1, 7]) {
  test(`exhausted exact pages rotate off-page recyclable people (${sex}/${unhandledCount} untouched)`, () => {
    const pages = load('@/lib/dating-1on1-recommendation-page');
    const src = card('exhausted-source', { sex, age: 30 });
    const pool = Array.from({ length: 60 }, (_, i) => card(`exhausted-${i}`, {
      age: 30, sex: sex === 'male' ? 'female' : 'male',
      last_handled_at: i < unhandledCount ? null : new Date(now - 1000).toISOString(),
    }));
    const handled = new Set(ids(pool.slice(unhandledCount)));
    const context = { handled, extraExcluded: handled, limit: 10, extraLimit: 3,
      observations: pool.map(c => ({ id: c.id, at: now - 100 })) };
    let previous = { recommendations: pool.slice(0, 10), extraRecommendations: [] };
    for (let step = 0; step < 20; step++) {
      const time = now + step * 60000, seed = new Date(time).toISOString();
      const next = pages.nextRecommendationPage(src, pool, previous, seed, time, context);
      const old = new Set(ids([...previous.recommendations, ...previous.extraRecommendations]));
      assert.equal(next.recommendations.length, 10);
      assert.equal(next.recommendations.filter(c => old.has(c.id)).length, 0, 'current people cannot crowd out recyclable off-page candidates');
      assert.equal(new Set(ids([...next.recommendations, ...next.extraRecommendations])).size, 10 + next.extraRecommendations.length);
      const restored = pages.restoreRecommendationPage(src, pool, {
        source_card_id: src.id, refreshed_at: seed,
        main_candidate_ids: ids(next.recommendations), extra_candidate_ids: ids(next.extraRecommendations),
      }, time + 2, { ...context, observations: [...context.observations,
        ...next.recommendations.map(c => ({ id: c.id, at: time + 1 }))] });
      assert.deepEqual(restored, next, 'GET and impression acknowledgement preserve the exact selected page');
      previous = next;
    }
  });
}

test('recyclable fallback preserves age and distance ordering and fills genuinely small pools', () => {
  const pages = load('@/lib/dating-1on1-recommendation-page');
  const recent = { last_handled_at: new Date(now - 1000).toISOString() };
  const previous = Array.from({ length: 10 }, (_, i) => card(`old-${i}`));
  const near = Array.from({ length: 10 }, (_, i) => card(`near-${i}`, recent));
  const far = Array.from({ length: 10 }, (_, i) => card(`far-${i}`, { ...recent, region: '부산' }));
  const largeGap = Array.from({ length: 10 }, (_, i) => card(`gap-${i}`, { ...recent, age: 60 }));
  const pool = [...previous, ...near, ...far, ...largeGap];
  const ctx = { handled: new Set(ids([...near, ...far, ...largeGap])), extraExcluded: new Set(ids(pool)),
    limit: 10, extraLimit: 3, observations: pool.map(c => ({ id: c.id, at: now - 100 })) };
  const next = pages.nextRecommendationPage(source, pool, { recommendations: previous, extraRecommendations: [] }, new Date(now).toISOString(), now, ctx);
  assert.deepEqual(new Set(ids(next.recommendations)), new Set(ids(near)));
  for (const size of [0, 1, 7, 10, 12, 15, 20]) {
    const candidates = pool.slice(0, size).map(c => ({ ...c, ...recent }));
    const old = candidates.slice(0, 10);
    const nextSmall = pages.nextRecommendationPage(source, candidates, { recommendations: old, extraRecommendations: [] },
      new Date(now).toISOString(), now, { ...ctx, handled: new Set(ids(candidates)), extraExcluded: new Set(ids(candidates)) });
    assert.equal(nextSmall.recommendations.length, Math.min(size, 10));
    assert.equal(nextSmall.recommendations.filter(c => !ids(old).includes(c.id)).length, Math.min(Math.max(size - 10, 0), 10));
  }
});

test('exhausted refresh is quota-neutral and keeps blocks, rejections and pending pairs excluded', async () => {
  const tables = fixture(65);
  tables.dating_1on1_recommendation_pages = [];
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1).map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now - 1000).toISOString(),
  }));
  tables.dating_1on1_match_proposals = tables.dating_1on1_cards.slice(1, 61).map((c, i) => pair({
    id: `closed-${i}`, candidate_card_id: c.id, candidate_user_id: c.user_id,
    state: i === 0 ? 'candidate_rejected' : i === 1 ? 'source_selected' : i % 2 ? 'source_skipped' : 'admin_canceled',
    updated_at: new Date(now - 1000).toISOString(),
  }));
  tables.dating_user_blocks = [{ blocker_user_id: 'user-source', blocked_user_id: 'user-c2' }];
  tables.profiles.find(p => p.user_id === 'user-c3').is_banned = true;
  const pairsBefore = structuredClone(tables.dating_1on1_match_proposals);
  const before = allCandidates((await runApi(tables, { atTime: now - 1 })).body);
  const result = await runRefresh(tables, { atTime: now });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.refresh_consumed, false);
  assert.equal(result.body.changed_candidate_count, 0);
  assert.ok(result.body.rotated_candidate_count >= 10);
  assert.equal(result.rpcCalls.length, 1);
  const after = allCandidates((await runApi(tables, { atTime: now + 1 })).body);
  assert.ok(after.every(c => !['c0', 'c1', 'c2', 'c3'].includes(c.id)));
  assert.ok(after.slice(0, 10).every(c => !ids(before).includes(c.id)));
  assert.deepEqual(tables.dating_1on1_match_proposals, pairsBefore);
});

for (const sex of ['male', 'female']) for (const history of ['none', 'partial', 'complete']) {
  test(`exact refresh mixes nearby revisits with new age-compatible people (${sex}/${history})`, () => {
    const pages = load('@/lib/dating-1on1-recommendation-page');
    const src = card('mix-source', { sex, age: 30, region: '광주 서구' });
    const peerSex = sex === 'male' ? 'female' : 'male';
    const locals = Array.from({ length: 13 }, (_, i) => card(`mix-local-${i}`, { age: 30, sex: peerSex, region: '광주 북구' }));
    const remote = Array.from({ length: 40 }, (_, i) => card(`mix-new-${i}`, { age: 30, sex: peerSex, region: '부산' }));
    const inappropriate = Array.from({ length: 15 }, (_, i) => card(`mix-old-age-${i}`, { age: 65, sex: peerSex, region: '광주' }));
    const unknown = card('mix-unknown', { age: 30, sex: peerSex, region: '어딘가' });
    const observations = locals.slice(0, history === 'none' ? 0 : history === 'partial' ? 1 : 13).map(c => ({ id: c.id, at: now - 1000 }));
    const context = { handled: new Set(), extraExcluded: new Set(), observations, limit: 10, extraLimit: 3 };
    const previous = { recommendations: locals.slice(0, 10), extraRecommendations: locals.slice(10) };
    const pool = [...locals, ...remote, ...inappropriate, unknown];
    const stamp = new Date(now).toISOString();
    const next = pages.nextRecommendationPage(src, pool, previous, stamp, now, context);
    assert.equal(next.recommendations.filter(c => c.id.startsWith('mix-local')).length, 5);
    assert.equal(next.extraRecommendations.filter(c => c.id.startsWith('mix-local')).length, 1);
    const all = [...next.recommendations, ...next.extraRecommendations];
    assert.equal(all.filter(c => c.id.startsWith('mix-new')).length, 7);
    assert.equal(new Set(ids(all)).size, 13);
    assert.ok(all.every(c => c.age === 30 && c.id !== unknown.id));
    assert.deepEqual(next, pages.nextRecommendationPage(src, pool, previous, stamp, now, context));
    const restored = pages.restoreRecommendationPage(src, pool, {
      source_card_id: src.id, refreshed_at: stamp, main_candidate_ids: ids(next.recommendations), extra_candidate_ids: ids(next.extraRecommendations),
    }, now + 10, { ...context, observations: [...observations, ...all.map(c => ({ id: c.id, at: now + 1 }))] });
    assert.deepEqual(restored, next, 'acknowledgement cannot reshuffle a mixed persisted page');
  });
}

test('nearby mix keeps all-new nearby pages and prefers off-page locals before current locals', () => {
  const pages = load('@/lib/dating-1on1-recommendation-page');
  const locals = Array.from({ length: 30 }, (_, i) => card(`mix-near-${i}`));
  const far = Array.from({ length: 30 }, (_, i) => card(`mix-far-${i}`, { region: '부산' }));
  const previous = { recommendations: locals.slice(0, 10), extraRecommendations: locals.slice(10, 13) };
  const base = { handled: new Set(), extraExcluded: new Set(), limit: 10, extraLimit: 3 };
  const run = observed => pages.nextRecommendationPage(source, [...locals, ...far], previous, new Date(now).toISOString(), now,
    { ...base, observations: observed.map(c => ({ id: c.id, at: now - 1000 })) });
  const fresh = run(locals.slice(0, 13));
  assert.ok([...fresh.recommendations, ...fresh.extraRecommendations].every(c => c.id.startsWith('mix-near') && !ids(locals.slice(0, 13)).includes(c.id)));
  const mixed = run(locals);
  const all = [...mixed.recommendations, ...mixed.extraRecommendations];
  assert.equal(all.filter(c => c.id.startsWith('mix-near')).length, 6);
  assert.ok(all.every(c => !ids(locals.slice(0, 13)).includes(c.id)), 'do not repeat the current local page when other compatible locals exist');
});

test('nearby mix respects distance/age boundaries, handled exclusions, and fills scarce slots', () => {
  const custom = createLoader({ '@/lib/region-distance': {
    getRegionDistanceMeta: (_source, region) => ({ distanceKm: region === 'unknown' ? null : Number(region) }),
  } });
  const pages = custom('@/lib/dating-1on1-recommendation-page');
  const locals = [card('near-preferred', { region: '90' }), card('near-gap6', { region: '40', age: 36 }),
    card('near-gap7', { region: '10', age: 37 }), card('not-near', { region: '91' }),
    card('near-handled', { region: '10' }), card('near-recent', { region: '10', last_handled_at: new Date(now - 1000).toISOString() })];
  const far = Array.from({ length: 20 }, (_, i) => card(`new-compatible-${i}`, { region: i < 10 ? '220' : '330' }));
  const context = { handled: new Set(['near-handled']), extraExcluded: new Set(['near-handled', 'near-recent']),
    observations: locals.map(c => ({ id: c.id, at: now - 2000 })), limit: 10, extraLimit: 3 };
  const next = pages.nextRecommendationPage(source, [...locals, ...far], { recommendations: locals, extraRecommendations: [] },
    new Date(now).toISOString(), now, context);
  assert.equal(next.recommendations.length, 10);
  assert.deepEqual(new Set(ids(next.recommendations).filter(id => !id.startsWith('new-compatible'))), new Set(['near-preferred', 'near-gap6']));
  assert.ok(next.recommendations.filter(c => c.id.startsWith('new-compatible')).every(c => c.region === '220'));
  assert.equal(new Set(ids([...next.recommendations, ...next.extraRecommendations])).size, 13);
  for (const size of [0, 1, 3, 7]) {
    const pool = [...far].slice(0, size);
    const scarce = pages.nextRecommendationPage(source, pool, { recommendations: [], extraRecommendations: [] },
      new Date(now).toISOString(), now, context);
    assert.equal(new Set(ids([...scarce.recommendations, ...scarce.extraRecommendations])).size, size);
  }
});

test('mixed persisted API page counts only new people and preserves photos, exclusions and match actions', async () => {
  const tables = fixture(80); tables.dating_1on1_recommendation_pages = [];
  tables.dating_1on1_cards.slice(21).forEach(c => { c.region = '부산'; });
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1, 21).map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now - day).toISOString(),
  }));
  tables.dating_user_blocks = [{ blocker_user_id: 'user-c0', blocked_user_id: 'user-source' }];
  tables.profiles.find(p => p.user_id === 'user-c1').is_banned = true;
  tables.dating_1on1_match_proposals = [
    pair({ candidate_card_id: 'c2', candidate_user_id: 'user-c2', state: 'mutual_accepted' }),
    pair({ id: 'declined', candidate_card_id: 'c3', candidate_user_id: 'user-c3', state: 'candidate_rejected' }),
  ];
  const pairsBefore = structuredClone(tables.dating_1on1_match_proposals);
  const before = allCandidates((await runApi(tables, { atTime: now - 1 })).body);
  const refreshed = await runRefresh(tables, { atTime: now });
  assert.equal(refreshed.response.status, 200); assert.equal(refreshed.body.refresh_consumed, true);
  assert.equal(refreshed.rpcCalls.length, 1); assert.equal(refreshed.body.changed_candidate_count, 7);
  const after = await runApi(tables, { atTime: now + 1 });
  const page = allCandidates(after.body);
  assert.equal(page.length, 13); assert.equal(new Set(ids(page)).size, 13);
  assert.equal(page.filter(c => c.region === '부산').length, 7);
  assert.ok(page.every(c => !['c0', 'c1', 'c2', 'c3'].includes(c.id) && c.photo_signed_urls.length > 0 && !Object.hasOwn(c, 'phone')));
  assert.deepEqual(tables.dating_1on1_match_proposals, pairsBefore);
  assert.equal(after.calls.some(q => q.insert || q.update || q.delete), false);
  assert.equal(refreshed.body.rotated_candidate_count, page.filter(c => !ids(before).includes(c.id)).length);
  for (const c of page) tables.dating_1on1_candidate_impressions.push({ viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now + 2).toISOString() });
  assert.deepEqual(ids(allCandidates((await runApi(tables, { atTime: now + 3 })).body)), ids(page));
  const selected = await runSelect(tables, { candidateId: page[0].id, atTime: now + 4 });
  assert.equal(selected.response.status, 200);
  const duplicate = await runSelect(tables, { candidateId: page[0].id, atTime: now + 5 });
  assert.equal(duplicate.response.status, 409);
  assert.deepEqual(tables.dating_1on1_match_proposals.slice(0, 2), pairsBefore);
});

test('successive daily mixed exact pages keep discovering people, then rotate without consuming when all are seen', async () => {
  const tables = fixture(48); tables.dating_1on1_recommendation_pages = [];
  tables.dating_1on1_cards.slice(21).forEach(c => { c.region = '부산'; });
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1, 21).map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now - day).toISOString(),
  }));
  const discovered = new Set(tables.dating_1on1_candidate_impressions.map(c => c.candidate_user_id));
  for (let round = 0; round < 5; round++) {
    // The shared RPC mock models the normal daily allowance, not bonus spending.
    const at = now + round * (day + 31000);
    const before = (await runApi(tables, { atTime: at - 1 })).body.items[0];
    const result = await runRefresh(tables, { atTime: at });
    assert.equal(result.response.status, 200);
    const after = (await runApi(tables, { atTime: at + 1 })).body.items[0];
    const all = [...after.recommendations, ...after.admin_recommendations];
    assert.equal(new Set(ids(all)).size, 13);
    const newlySeen = all.filter(c => !discovered.has(c.user_id));
    assert.equal(result.body.changed_candidate_count, newlySeen.length);
    assert.equal(result.body.refresh_consumed, newlySeen.length > 0);
    assert.equal(after.refresh_remaining, before.refresh_remaining - (newlySeen.length > 0 ? 1 : 0));
    if (round < 4) {
      assert.equal(newlySeen.length, 7, `round ${round}: nearby revisits cannot trap the new-candidate slots`);
      assert.equal(after.recommendations.filter(c => c.region !== '부산').length, 5);
    } else {
      assert.equal(newlySeen.length, 0);
      assert.ok(result.body.rotated_candidate_count > 0);
    }
    for (const c of newlySeen) {
      discovered.add(c.user_id);
      tables.dating_1on1_candidate_impressions.push({ viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(at + 2).toISOString() });
    }
    assert.deepEqual(ids(allCandidates((await runApi(tables, { atTime: at + 3 })).body)), ids(all));
  }
  assert.equal(discovered.size, 48);
});

for (const history of ['none', 'partial', 'complete']) test(`manual refresh leaves the current main/extra page before refilling it (${history} observations)`, () => {
  const local = Array.from({ length: 13 }, (_, i) => card(`current-${i}`));
  const wider = Array.from({ length: 30 }, (_, i) => card(`wider-${i}`, { region: '대전 서구' }));
  const pool = [...local, ...wider];
  const defaults = rules.takeBalancedRecommendations(source, rules.sortCandidatesForSource(source, pool, 'default', now), 10, new Set(), now);
  const options = { limit: 3, excludeIds: new Set() };
  const initial = rules.replayRecommendationRefreshes(source, pool, defaults, [], new Set(), 10, now - 1000, options);
  const visible = [...initial.recommendations, ...initial.extraRecommendations];
  const observations = visible.slice(0, history === 'none' ? 0 : history === 'partial' ? 1 : 13)
    .map(c => ({ id: c.id, at: now - 900 }));
  const result = rules.replayRecommendationRefreshes(source, pool, defaults, [new Date(now).toISOString()], new Set(), 10, now, options, observations);
  const next = [...result.recommendations, ...result.extraRecommendations];
  assert.equal(next.length, 13);
  assert.equal(new Set(ids(next)).size, 13);
  assert.ok(next.every(c => !ids(visible).includes(c.id)), 'eligible alternatives must precede the page just refreshed');
  assert.deepEqual(result, rules.replayRecommendationRefreshes(source, pool, defaults,
    [new Date(now).toISOString()], new Set(), 10, now + 1, options, observations));
});

test('mixed-region rotation maximizes different people and stays stable across 1512 sparse/dense/history cases', () => {
  let cases = 0;
  const regions = ['서울 강남구', '경기 수원', '대전', '부산', '광주', '강원 춘천', '제주'];
  for (const sex of ['male', 'female']) for (const region of regions) for (const age of [22, 31, 44]) {
    for (const size of [10, 13, 20, 26, 52, 120]) for (const mode of ['none', 'partial']) {
      const src = card('matrix-source', { sex, region, age });
      const pool = Array.from({ length: size }, (_, i) => card(`matrix-${i}`, {
        sex: sex === 'male' ? 'female' : 'male', age, region: regions[Math.floor(i / 13) % regions.length],
      }));
      const defaults = rules.takeBalancedRecommendations(src, rules.sortCandidatesForSource(src, pool, 'matrix-default', now), 10, new Set(), now);
      const options = { limit: 3, excludeIds: new Set() }, observations = [], seeds = [];
      let page = rules.replayRecommendationRefreshes(src, pool, defaults, seeds, new Set(), 10, now, options, observations);
      for (let round = 1; round <= 3; round++) {
        const visible = [...page.recommendations, ...page.extraRecommendations];
        const stamp = now + round * 10000;
        if (mode === 'partial') observations.push(...visible.slice(0, 2).map(c => ({ id: c.id, at: stamp - 1 })));
        seeds.push(new Date(stamp).toISOString());
        page = rules.replayRecommendationRefreshes(src, pool, defaults, seeds, new Set(), 10, stamp, options, observations);
        const next = [...page.recommendations, ...page.extraRecommendations];
        assert.equal(next.length, Math.min(13, size));
        assert.equal(new Set(ids(next)).size, next.length);
        assert.equal(next.filter(c => !ids(visible).includes(c.id)).length, Math.min(13, size - visible.length),
          `${sex}/${region}/${age}/${size}/${mode}/${round}`);
        assert.deepEqual(page, rules.replayRecommendationRefreshes(src, pool, defaults, seeds, new Set(), 10, stamp + 1, options, observations));
        cases++;
      }
    }
  }
  assert.equal(cases, 1512);
});

test('repeat-only browsing does not become a fixed page when the replay window reaches its bound', () => {
  const pool = Array.from({ length: 26 }, (_, i) => card(`bounded-${i}`));
  const defaults = rules.takeBalancedRecommendations(source, pool, 10, new Set(), now);
  const options = { limit: 3, excludeIds: new Set() };
  const observations = pool.map(c => ({ id: c.id, at: now - day / 2 }));
  const pages = load('@/lib/dating-1on1-recommendation-page');
  const context = { handled: new Set(), extraExcluded: new Set(), observations, limit: 10, extraLimit: 3 };
  let previous = rules.replayRecommendationRefreshes(source, pool, defaults, [], new Set(), 10, now, options, observations);
  for (let round = 0; round < 70; round++) {
    const at = now + round * 31000, stamp = new Date(at).toISOString();
    const result = pages.nextRecommendationPage(source, pool, previous, stamp, at, context);
    const current = [...result.recommendations, ...result.extraRecommendations];
    assert.equal(current.filter(c => ![...previous.recommendations, ...previous.extraRecommendations].some(p => p.id === c.id)).length, 13, `round ${round + 1}`);
    previous = pages.restoreRecommendationPage(source, pool, { source_card_id: source.id, refreshed_at: stamp,
      main_candidate_ids: ids(result.recommendations), extra_candidate_ids: ids(result.extraRecommendations) }, at + 1, context);
    assert.deepEqual(ids(previous.recommendations), ids(result.recommendations));
    assert.deepEqual(ids(previous.extraRecommendations), ids(result.extraRecommendations));
  }
});

for (const mode of ['none', 'partial', 'complete']) test(`widened recommendation can be selected once without canceling previous matches (${mode})`, async () => {
  const tables = fixture(45);
  tables.dating_1on1_cards.slice(14).forEach(c => { c.region = '대전'; });
  tables.dating_1on1_match_proposals.push(pair({ id: 'existing-unrelated', candidate_card_id: 'already-matched', candidate_user_id: 'other-person', state: 'mutual_accepted' }));
  const before = allCandidates((await runApi(tables, { atTime: now - 1000 })).body);
  tables.dating_1on1_candidate_impressions = before.slice(0, mode === 'none' ? 0 : mode === 'partial' ? 1 : 13).map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now - 500).toISOString(),
  }));
  const refreshed = await runRefresh(tables, { atTime: now });
  assert.equal(refreshed.response.status, 200);
  const after = allCandidates((await runApi(tables, { atTime: now + 1 })).body);
  assert.equal(refreshed.body.changed_candidate_count, after.filter(c => !ids(before).includes(c.id)).length);
  const candidate = after.find(c => !ids(before).includes(c.id)); assert.ok(candidate);
  assert.equal(candidate.photo_signed_urls.length, 1);
  assert.equal(Object.hasOwn(candidate, 'phone'), false);
  const original = structuredClone(tables.dating_1on1_match_proposals[0]);
  const selected = await runSelect(tables, { candidateId: candidate.id, atTime: now + 2 });
  assert.equal(selected.response.status, 200);
  assert.deepEqual(tables.dating_1on1_match_proposals[0], original);
  const duplicate = await runSelect(tables, { candidateId: candidate.id, atTime: now + 3 });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.calls.some(q => q.insert || q.update || q.delete), false);
  assert.deepEqual(duplicate.notifications, []);
  assert.ok(allCandidates((await runApi(tables, { atTime: now + 4 })).body).every(c => c.id !== candidate.id));
});

test('snapshot-backed refresh survives history pruning, activity changes and acknowledgement without reshuffling', async () => {
  const tables = fixture(80); tables.dating_1on1_recommendation_pages = [];
  const initial = (await runApi(tables, { atTime: now })).body;
  const refresh = await runRefresh(tables, { atTime: now + 1 });
  assert.equal(refresh.response.status, 200); assert.equal(refresh.rpcCalls.length, 1);
  assert.ok(Array.isArray(refresh.rpcCalls[0].p_main_candidate_ids));
  const page = allCandidates((await runApi(tables, { atTime: now + 2 })).body);
  assert.equal(page.filter(c => !ids(allCandidates(initial)).includes(c.id)).length, refresh.body.changed_candidate_count);
  assert.deepEqual(ids(page), [...tables.dating_1on1_recommendation_pages[0].main_candidate_ids, ...tables.dating_1on1_recommendation_pages[0].extra_candidate_ids]);
  tables.dating_1on1_recommendation_refresh_events = []; // retained page does not depend on replay length
  tables.dating_1on1_candidate_impressions = page.map(c => ({ viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now + 3).toISOString() }));
  tables.profiles.forEach(p => { p.last_meaningful_activity_at = new Date(now + 4).toISOString(); });
  const again = (await runApi(tables, { atTime: now + 5 })).body;
  assert.deepEqual(ids(allCandidates(again)), ids(page));
  assert.ok(!JSON.stringify(again).includes('main_candidate_ids'), 'private receipt is never added to the public response');
  const second = await runRefresh(tables, { atTime: now + day + 100 });
  assert.equal(second.response.status, 200);
  assert.equal((await runApi(tables, { atTime: now + day + 101 })).body.items[0].refresh_remaining, 0);
});

test('snapshot-backed API rotates after 64 retained events without consuming a repeat-only allowance', async () => {
  const tables = fixture(26); tables.dating_1on1_recommendation_pages = [];
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1).map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now - 100000).toISOString(),
  }));
  await runRefresh(tables, { atTime: now });
  let previous = allCandidates((await runApi(tables, { atTime: now + 1 })).body);
  for (let i = 1; i <= 65; i++) tables.dating_1on1_recommendation_refresh_events.unshift({
    card_id: 'source', user_id: 'user-source', refreshed_at: new Date(now - i * 31000).toISOString(), quota_refunded_at: new Date(now).toISOString(), rotation_only: true,
  });
  for (let round = 1; round <= 3; round++) {
    tables.dating_1on1_recommendation_refresh_events = tables.dating_1on1_recommendation_refresh_events.slice(-64);
    const at = now + round * 31000, refresh = await runRefresh(tables, { atTime: at });
    assert.equal(refresh.response.status, 200); assert.equal(refresh.body.refresh_consumed, false);
    assert.equal(refresh.body.rotated_candidate_count, 13); assert.equal(refresh.body.refresh_remaining, 1);
    const next = allCandidates((await runApi(tables, { atTime: at + 1 })).body);
    assert.equal(next.filter(c => !ids(previous).includes(c.id)).length, 13);
    previous = next;
  }
});

for (const change of ['ban', 'hidden', 'blocked', 'rejected', 'matched', 'favorite', 'withdrawn']) test(`saved page revalidates ${change} and refills without any write`, async () => {
  const tables = fixture(70); tables.dating_1on1_recommendation_pages = [];
  await runRefresh(tables, { atTime: now });
  const page = allCandidates((await runApi(tables, { atTime: now + 1 })).body), selected = page[0];
  if (change === 'ban') tables.profiles.find(p => p.user_id === selected.user_id).is_banned = true;
  if (change === 'hidden') tables.dating_1on1_cards.find(c => c.id === selected.id).status = 'hidden';
  if (change === 'withdrawn') tables.profiles = tables.profiles.filter(p => p.user_id !== selected.user_id);
  if (change === 'blocked') tables.dating_user_blocks = [{ blocker_user_id: selected.user_id, blocked_user_id: 'user-source' }];
  if (change === 'favorite') tables.dating_1on1_candidate_favorites = [{ user_id: 'user-source', source_card_id: 'source', candidate_card_id: selected.id }];
  if (change === 'rejected' || change === 'matched') tables.dating_1on1_match_proposals.push(pair({
    candidate_card_id: selected.id, candidate_user_id: selected.user_id, state: change === 'matched' ? 'mutual_accepted' : 'candidate_rejected',
  }));
  const before = structuredClone(tables), result = await runApi(tables, { atTime: now + 2 });
  assert.equal(result.response.status, 200);
  const after = allCandidates(result.body);
  assert.equal(after.length, 13); assert.equal(new Set(ids(after)).size, 13);
  assert.ok(after.every(c => c.id !== selected.id));
  assert.deepEqual(tables, before); assert.ok(result.calls.every(q => !q.insert && !q.update && !q.delete));
});

test('snapshot read/write failure never falls back to another quota write or a misleading old page', async () => {
  const tables = fixture(60); tables.dating_1on1_recommendation_pages = [];
  const intercept = q => q.table === 'dating_1on1_recommendation_pages' ? { data: null, error: { code: '57014', message: 'timeout' } } : null;
  assert.equal((await runApi(tables, { atTime: now, intercept })).response.status, 503);
  const unread = await runRefresh(tables, { atTime: now, intercept });
  assert.equal(unread.response.status, 503); assert.equal(unread.rpcCalls.length, 0);
  for (const code of ['PGRST202', '57014']) {
    const failed = await runRefresh(tables, { atTime: now, rpc: async (_, name) => {
      assert.equal(name, 'commit_dating_1on1_recommendation_page'); return { data: null, error: { code } };
    } });
    assert.equal(failed.response.status, 503); assert.equal(failed.rpcCalls.length, 1);
    assert.equal(tables.dating_1on1_cards[0].recommendation_refresh_used_at, null);
  }
});

test('changing source region invalidates the saved ordering without spending a refresh', async () => {
  const tables = fixture(60); tables.dating_1on1_recommendation_pages = [];
  tables.dating_1on1_cards.slice(31).forEach(c => { c.region = '부산'; });
  await runRefresh(tables, { atTime: now });
  tables.dating_1on1_cards[0].region = '부산';
  const before = structuredClone(tables), after = await runApi(tables, { atTime: now + 1 });
  assert.equal(after.response.status, 200);
  assert.ok(allCandidates(after.body).every(c => c.region === '부산'));
  assert.deepEqual(tables, before); assert.ok(after.calls.every(q => !q.insert && !q.update && !q.delete));
});

test('nearby newcomers replace distant slots, not the locals at the end of an older saved page', () => {
  const pages = load('@/lib/dating-1on1-recommendation-page');
  const far = Array.from({ length: 5 }, (_, i) => card(`arrival-far-${i}`, { region: '부산' }));
  const local = Array.from({ length: 5 }, (_, i) => card(`arrival-local-${i}`));
  const newLocal = [card('arrival-new-local', { created_at: new Date(now + 100).toISOString() })];
  const newFar = [card('arrival-new-far', { region: '부산', created_at: new Date(now + 100).toISOString() })];
  const previous = [...far, ...local];
  const saved = { source_card_id: source.id, refreshed_at: new Date(now).toISOString(),
    main_candidate_ids: ids(previous), extra_candidate_ids: [] };
  const context = { handled: new Set(), extraExcluded: new Set(), observations: [], limit: 10, extraLimit: 0 };
  const before = structuredClone(saved);
  const result = pages.restoreRecommendationPage(source, [...previous, ...newLocal, ...newFar], saved, now + 200, context);
  assert.equal(result.recommendations[0].id, 'arrival-new-local');
  assert.ok(local.every(c => ids(result.recommendations).includes(c.id)));
  assert.equal(result.recommendations.length, 10);
  assert.equal(new Set(ids(result.recommendations)).size, 10);
  assert.deepEqual(saved, before);
  assert.deepEqual(pages.restoreRecommendationPage(source, [...previous, ...newLocal, ...newFar], saved, now + 300,
    { ...context, observations: result.recommendations.map(c => ({ id: c.id, at: now + 250 })) }), result);
  assert.deepEqual(pages.restoreRecommendationPage(source, previous, saved, now + 200, context).recommendations, previous,
    'no new eligible profile means no reordering of the saved page');
});

test('remote newcomers cannot remove closer saved candidates or widen the saved distance band', () => {
  const custom = createLoader({ '@/lib/region-distance': {
    getRegionDistanceMeta: (_source, region) => ({ distanceKm: region === 'unknown' ? null : Number(region) }),
  } });
  const pages = custom('@/lib/dating-1on1-recommendation-page');
  const previous = [card('existing-far', { region: '220' }), ...Array.from({ length: 9 }, (_, i) => card(`existing-near-${i}`, { region: '30' }))];
  const newcomers = ['230', '240', '300', 'unknown'].map((region, i) => card(`new-arrival-${i}`, { region, created_at: new Date(now + 1).toISOString() }));
  const saved = { source_card_id: source.id, refreshed_at: new Date(now).toISOString(), main_candidate_ids: ids(previous), extra_candidate_ids: [] };
  const result = pages.restoreRecommendationPage(source, [...previous, ...newcomers], saved, now + 100,
    { handled: new Set(), extraExcluded: new Set(), observations: [], limit: 10, extraLimit: 0 });
  assert.equal(result.recommendations.length, 10);
  assert.equal(result.recommendations.filter(c => c.id.startsWith('existing-near')).length, 9);
  assert.equal(result.recommendations.filter(c => c.id.startsWith('new-arrival')).length, 1);
  assert.ok(result.recommendations.every(c => c.region !== '300' && c.region !== 'unknown'));
});

for (const change of ['eligible', 'ban', 'hidden', 'blocked', 'rejected', 'matched', 'favorite', 'withdrawn']) {
  test(`new nearby saved-page arrival respects ${change} without touching quota or requests`, async () => {
    const tables = fixture(35); tables.dating_1on1_recommendation_pages = [];
    tables.dating_1on1_cards.slice(1).forEach(c => { c.region = '부산'; });
    await runRefresh(tables, { atTime: now });
    const newCard = { ...tables.dating_1on1_cards[1], id: 'new-nearby-safe', user_id: 'new-nearby-user',
      phone: '+821099999992', region: '서울 강남구', created_at: new Date(now + 1000).toISOString() };
    tables.dating_1on1_cards.push(newCard);
    if (change !== 'withdrawn') tables.profiles.push({ user_id: newCard.user_id, phone_e164: newCard.phone, is_banned: change === 'ban' });
    if (change === 'hidden') newCard.status = 'hidden';
    if (change === 'blocked') tables.dating_user_blocks = [{ blocker_user_id: newCard.user_id, blocked_user_id: 'user-source' }];
    if (change === 'favorite') tables.dating_1on1_candidate_favorites = [{ user_id: 'user-source', source_card_id: 'source', candidate_card_id: newCard.id }];
    if (change === 'rejected' || change === 'matched') tables.dating_1on1_match_proposals.push(pair({
      candidate_card_id: newCard.id, candidate_user_id: newCard.user_id, state: change === 'matched' ? 'source_selected' : 'candidate_rejected',
    }));
    const snapshot = structuredClone(tables);
    const result = await runApi(tables, { atTime: now + 2000 });
    assert.equal(result.response.status, 200);
    const shown = allCandidates(result.body);
    assert.equal(shown.some(c => c.id === newCard.id), change === 'eligible');
    if (change === 'eligible') {
      assert.equal(result.body.items[0].recommendations[0].id, newCard.id);
      assert.equal(shown.find(c => c.id === newCard.id).recommendation_region_widened, false);
      assert.ok(shown.find(c => c.id === newCard.id).photo_signed_urls.length > 0);
    }
    assert.equal(result.body.items[0].refresh_remaining, 0);
    assert.equal(new Set(ids(shown)).size, 13);
    assert.ok(shown.every(c => !Object.hasOwn(c, 'phone')));
    assert.deepEqual(tables, snapshot);
    assert.ok(result.calls.every(q => !q.insert && !q.update && !q.delete));
  });
}

test('new compatible nearby member enters a saved wider page, without a quota charge or photo leak', async () => {
  const tables = fixture(40); tables.dating_1on1_recommendation_pages = [];
  tables.dating_1on1_cards.slice(1).forEach(c => { c.region = '부산'; });
  await runRefresh(tables, { atTime: now });
  tables.dating_1on1_cards.push({ ...tables.dating_1on1_cards[1], id: 'new-local', user_id: 'new-user', phone: '+821099999991',
    created_at: new Date(now + 1000).toISOString(), region: '서울 강남구' });
  tables.profiles.push({ user_id: 'new-user', phone_e164: '+821099999991', is_banned: false });
  const before = structuredClone(tables), result = await runApi(tables, { atTime: now + 2000 });
  assert.equal(result.body.items[0].recommendations[0].id, 'new-local');
  assert.equal(allCandidates(result.body).length, 13);
  assert.deepEqual(tables, before);
  const snapshot = tables.dating_1on1_recommendation_pages[0];
  assert.ok(!snapshot.main_candidate_ids.includes('new-local'), 'GET never mutates the saved receipt');
});

test('wider-region notice uses the existing 180km boundary and never guesses unknown distances', () => {
  const helpers = createLoader({ '@/lib/region-distance': {
    getRegionDistanceMeta: (_source, region) => ({ distanceKm: region === 'unknown' ? null : Number(region) }),
  } })('@/lib/dating-1on1-recommendations');
  for (const [regions, expected] of [[[], false], [['unknown'], false], [['0', '90', '180'], false],
    [['180.001'], true], [['unknown', '330'], true]]) {
    assert.equal(helpers.hasWiderRecommendationRegion(source, regions.map(region => ({ region }))), expected);
  }
  assert.equal(rules.hasWiderRecommendationRegion({ region: '지역 미상' }, [{ region: '부산' }]), false);
});

test('API notice describes visible main and extra candidates without extra queries or writes', async () => {
  const local = fixture(13), wide = structuredClone(local);
  for (const c of wide.dating_1on1_cards.slice(1)) c.region = '부산';
  const snapshots = [structuredClone(local), structuredClone(wide)];
  const nearbyResult = await runApi(local, { atTime: now });
  const widerResult = await runApi(wide, { atTime: now });
  assert.equal(nearbyResult.body.items[0].recommendation_region_widened, false);
  assert.equal(widerResult.body.items[0].recommendation_region_widened, true);
  assert.ok(allCandidates(nearbyResult.body).every(c => c.recommendation_region_widened === false));
  assert.ok(allCandidates(widerResult.body).every(c => c.recommendation_region_widened === true));
  assert.equal(allCandidates(widerResult.body).length, 13);
  assert.equal(widerResult.calls.length, nearbyResult.calls.length);
  for (const result of [nearbyResult, widerResult]) assert.ok(result.calls.every(q => !q.insert && !q.update && !q.delete));
  assert.deepEqual([local, wide], snapshots);
});

test('remote extras trigger the notice, but saved or removed remote cards do not', async () => {
  const tables = fixture(11);
  tables.dating_1on1_cards.at(-1).region = '부산';
  const result = await runApi(tables, { atTime: now });
  assert.ok(result.body.items[0].recommendations.every(c => c.region !== '부산'));
  assert.ok(result.body.items[0].admin_recommendations.some(c => c.region === '부산'));
  assert.equal(result.body.items[0].recommendation_region_widened, true);
  assert.ok(result.body.items[0].recommendations.every(c => c.recommendation_region_widened === false));
  assert.ok(result.body.items[0].admin_recommendations.filter(c => c.region === '부산').every(c => c.recommendation_region_widened === true));
  tables.dating_1on1_candidate_favorites = [{ user_id: 'user-source', source_card_id: 'source', candidate_card_id: 'c10', created_at: new Date(now).toISOString() }];
  const saved = await runApi(tables, { atTime: now });
  assert.equal(saved.body.items[0].favorite_candidates[0].region, '부산');
  assert.equal(saved.body.items[0].favorite_candidates[0].recommendation_region_widened, undefined);
  assert.equal(saved.body.items[0].recommendation_region_widened, false);
  const remoteOnly = fixture(1); remoteOnly.dating_1on1_cards[1].region = '부산';
  const removed = await runApi(remoteOnly, { atTime: now,
    intercept: q => q.fields.includes('photo_paths') ? { data: [], error: null } : null });
  assert.deepEqual(allCandidates(removed.body), []);
  assert.equal(removed.body.items[0].recommendation_region_widened, false);
});

test('actual observations broaden to unseen compatible nearby candidates before local repeats', () => {
  const locals = Array.from({ length: 20 }, (_, i) => card('seen-' + i));
  const nearby = Array.from({ length: 20 }, (_, i) => card('fresh-' + i, { region: '충남 천안시' }));
  const remote = Array.from({ length: 20 }, (_, i) => card('remote-' + i, { region: '부산' }));
  const sorted = rules.sortCandidatesForSource(source, [...locals, ...nearby, ...remote], 'observed', now);
  const seen = new Set(ids(locals));
  const result = rules.takeObservedRecommendations(source, sorted, 10, seen, new Set(), new Set(), now);
  assert.equal(result.length, 10);
  assert.ok(result.every(c => c.id.startsWith('fresh-')));
  const exhausted = rules.takeObservedRecommendations(source, sorted, 10, new Set([...ids(locals), ...ids(nearby)]), new Set(), new Set(), now);
  assert.ok(exhausted.every(c => c.id.startsWith('seen-')), 'do not jump arbitrarily far to fake novelty');
  assert.deepEqual(rules.takeObservedRecommendations(source, sorted, 0, seen, new Set(), new Set(), now), []);
});

test('observations count only actual past views within the 30-day generation cutoff', () => {
  assert.deepEqual([...rules.observedCandidateIdsAt([
    { id: 'old', at: now-31*day }, { id: 'boundary', at: now-30*day }, { id: 'seen', at: now-1 },
    { id: 'current', at: now }, { id: 'future', at: now+1 }, { id: 'bad', at: NaN },
  ], now)], ['boundary', 'seen']);
});

test('explicit refresh widens to unseen age-compatible regions after nearby views are exhausted', () => {
  const local = Array.from({ length: 32 }, (_, i) => card('local-seen-' + i));
  const wider = Array.from({ length: 45 }, (_, i) => card('wider-new-' + i, { region: '부산' }));
  const inappropriate = Array.from({ length: 20 }, (_, i) => card('bad-age-' + i, { age: 65, region: '부산' }));
  const pool = [...local, ...wider, ...inappropriate];
  const seen = new Set(ids(local));
  const sorted = rules.sortCandidatesForSource(source, pool, 'widen', now);
  assert.ok(rules.takeObservedRecommendations(source, sorted, 10, seen, new Set(), new Set(), now)
    .every(c => c.id.startsWith('local-seen-')), 'ordinary daily browsing keeps nearby-first behavior');
  let previous = new Set(ids(local.slice(0, 10)));
  for (let step = 0; step < 4; step++) {
    const page = rules.takeObservedRecommendations(source, sorted, 10, seen, previous, new Set(), now, true);
    assert.equal(page.length, 10);
    assert.ok(page.every(c => c.id.startsWith('wider-new-') && !seen.has(c.id)), 'must not charge for recycling locals while compatible unseen people remain');
    for (const c of page) seen.add(c.id);
    previous = new Set(ids(page));
  }
});

test('acknowledging the current recommendation page never rotates it on a subsequent GET', () => {
  const pool = Array.from({ length: 80 }, (_, i) => card('obs-' + i));
  const observations = pool.slice(0, 25).map(c => ({ id: c.id, at: now-100000 }));
  const seeds = [new Date(now-1000).toISOString()];
  const run = history => rules.replayRecommendationRefreshes(source, pool, pool.slice(0, 10), seeds, new Set(), 10, now,
    { limit: 3, excludeIds: new Set() }, history);
  const before = run(observations);
  const displayed = [...before.recommendations, ...before.extraRecommendations];
  const after = run([...observations, ...displayed.map(c => ({ id: c.id, at: now-500 }))]);
  assert.deepEqual(after, before);
  assert.equal(new Set(ids(displayed)).size, 13);
  assert.ok(displayed.every(c => !observations.some(o => o.id === c.id)));
});

test('Gyeongsang refresh expands through nearer unseen distance bands before nationwide candidates', () => {
  const src = { ...source, region: '양산(경남)' };
  const groups = ['부산', '경북 안동시', '대전', '경기 수원시'].map((region, band) =>
    Array.from({ length: 13 }, (_, i) => card(`ring-${band}-${i}`, {
      region, age: band === 2 ? 26 : 28,
      // Activity/Plus and age quotas must not let the farthest band skip nearer people.
      last_active_at: band === 3 ? new Date(now).toISOString() : null,
      plus_expires_at: band === 3 ? new Date(now + day).toISOString() : null,
    })));
  const seen = new Set(ids(groups[0]));
  const pool = groups.flat();
  for (let band = 1; band < groups.length; band++) {
    const sorted = rules.sortCandidatesForSource(src, pool, `rings-${band}`, now);
    const main = rules.takeObservedRecommendations(src, sorted, 10, seen, new Set(), new Set(), now, true);
    const extras = rules.takeObservedRecommendations(src, sorted.filter(c => !ids(main).includes(c.id)), 3,
      seen, new Set(), new Set(), now, true);
    assert.equal(main.length, 10); assert.equal(extras.length, 3);
    assert.deepEqual(new Set(ids([...main, ...extras])), new Set(ids(groups[band])));
    for (const c of [...main, ...extras]) seen.add(c.id);
  }
});

test('partial distance bands fill only the missing slots from the next band', () => {
  const src = { ...source, region: '양산(경남)' };
  const near = Array.from({ length: 4 }, (_, i) => card(`near-ring-${i}`, { region: '대전', age: 26 }));
  const next = Array.from({ length: 12 }, (_, i) => card(`next-ring-${i}`, { region: '경기 수원시' }));
  const far = Array.from({ length: 20 }, (_, i) => card(`far-ring-${i}`, { region: '경기 파주시', last_active_at: new Date(now).toISOString() }));
  for (let seed = 0; seed < 12; seed++) {
    const sorted = rules.sortCandidatesForSource(src, [...far, ...next, ...near], String(seed), now);
    const selected = rules.takeBalancedRecommendations(src, sorted, 10, new Set(), now);
    assert.equal(selected.filter(c => c.id.startsWith('near-ring')).length, 4);
    assert.equal(selected.filter(c => c.id.startsWith('next-ring')).length, 6);
    assert.equal(selected.some(c => c.id.startsWith('far-ring')), false);
  }
});

test('distance-band boundaries are inclusive and unknown locations remain last', () => {
  const regionalRules = createLoader({ '@/lib/region-distance': {
    getRegionDistanceMeta: (_source, region) => ({ distanceKm: region === 'unknown' ? null : Number(region) }),
  } })('@/lib/dating-1on1-recommendations');
  for (const boundary of [180, 250, 330, 450]) {
    const inner = Array.from({ length: 10 }, (_, i) => card(`inner-${i}`, { region: String(boundary), age: 26 }));
    const outer = Array.from({ length: 20 }, (_, i) => card(`outer-${i}`, {
      region: String(boundary + 0.001), last_active_at: new Date(now).toISOString(),
    }));
    const sorted = regionalRules.sortCandidatesForSource(source, [...outer, card('unknown', { region: 'unknown' }), ...inner], 'boundary', now);
    assert.deepEqual(new Set(ids(regionalRules.takeBalancedRecommendations(source, sorted, 10, new Set(), now))), new Set(ids(inner)));
  }
});

test('new compatible profiles enter an expanded page without widening it further or charging a refresh', () => {
  const src = { ...source, region: '양산(경남)' };
  const pool = Array.from({ length: 40 }, (_, i) => card(`expanded-${i}`, { region: '대전' }));
  const fresh = ['경북 안동시', '전북 전주시', '서울', 'unknown'].map((region, i) =>
    card(`new-ring-${i}`, { region, created_at: new Date(now - 500).toISOString() }));
  fresh.push(card('new-wrong-age', { region: '부산', age: 60, created_at: fresh[0].created_at }));
  const stamps = [new Date(now - 1000).toISOString()];
  const observations = pool.slice(0, 13).map(c => ({ id: c.id, at: now - 2000 }));
  const run = (candidates, views = observations) => rules.replayRecommendationRefreshes(src, candidates, pool.slice(0, 10),
    stamps, new Set(), 10, now, { limit: 3, excludeIds: new Set() }, views);
  const before = run(pool), after = run([...pool, ...fresh]);
  assert.ok(ids(after.recommendations).includes('new-ring-0'));
  assert.ok(ids(after.recommendations).includes('new-ring-1'));
  assert.equal(after.recommendations.filter(c => ids(before.recommendations).includes(c.id)).length, 8);
  assert.equal(after.recommendations.some(c => ['new-ring-2', 'new-ring-3', 'new-wrong-age'].includes(c.id)), false);
  assert.equal(new Set(ids([...after.recommendations, ...after.extraRecommendations])).size, 13);
  assert.deepEqual(after.seeds, before.seeds);
  assert.deepEqual(run([...pool, ...fresh], [...observations,
    ...after.recommendations.map(c => ({ id: c.id, at: now - 1 }))]), after, 'acknowledgement must not remove a newcomer');
});

test('new profiles in a sparse region receive entrance slots even without manual refresh', () => {
  const src = { ...source, region: '양산(경남)' };
  for (const region of ['경북 안동시', '대전', '경기 수원시']) {
    const active = Array.from({ length: 30 }, (_, i) => card(`active-${i}`, { region, last_active_at: new Date(now).toISOString() }));
    const fresh = Array.from({ length: 4 }, (_, i) => card(`fresh-${i}`, { region, created_at: new Date(now - 1000).toISOString() }));
    const sorted = rules.sortCandidatesForSource(src, [...active, ...fresh], 'day', now);
    assert.equal(rules.takeBalancedRecommendations(src, sorted, 10, new Set(), now).filter(c => c.id.startsWith('fresh-')).length, 2);
  }
});

test('legacy history without impressions can still leave an exhausted wider band', () => {
  const src = { ...source, region: '양산(경남)' };
  const inner = Array.from({ length: 13 }, (_, i) => card(`legacy-inner-${i}`, { region: '대전' }));
  const outer = Array.from({ length: 26 }, (_, i) => card(`legacy-outer-${i}`, { region: '경기 수원시' }));
  const result = rules.replayRecommendationRefreshes(src, [...inner, ...outer], inner.slice(0, 10),
    [new Date(now - 1000).toISOString()], new Set(), 10, now, { limit: 3, excludeIds: new Set() });
  assert.equal(result.recommendations.length, 10);
  assert.ok(result.recommendations.every(c => c.id.startsWith('legacy-outer')), 'splitting distance bands must not trap legacy refreshes in a 13-person loop');
});

test("initial extras stay local, while explicit refresh widens after exhausting unseen locals", () => {
  for (const sex of ["male", "female"]) {
    const src = card("local-source", { sex, age: 28 });
    const peerSex = sex === "male" ? "female" : "male";
    const locals = Array.from({ length: 15 }, (_, i) => card("local-" + i, { sex: peerSex }));
    const far = Array.from({ length: 35 }, (_, i) => card("far-" + i, { sex: peerSex, region: "부산 해운대구" }));
    const pool = [...locals, ...far];
    const defaults = rules.takeBalancedRecommendations(src, rules.sortCandidatesForSource(src, pool, "default", now), 10, new Set(), now);
    const initial = rules.replayRecommendationRefreshes(src, pool, defaults, [], new Set(), 10, now, { limit: 3, excludeIds: new Set() });
    assert.ok(initial.extraRecommendations.every(c => c.id.startsWith('local-')));
    const result = rules.replayRecommendationRefreshes(src, pool, defaults,
      [new Date(now - 3600000).toISOString()], new Set(), 10, now, { limit: 3, excludeIds: new Set() });
    assert.equal(result.recommendations.length, 10);
    assert.equal(result.extraRecommendations.length, 3);
    assert.equal([...result.recommendations, ...result.extraRecommendations].filter(c => c.id.startsWith('local-')).length, 2,
      'the two not-yet-shown locals precede wider candidates; the old thirteen are not forced back in');
    assert.equal(result.extraRecommendations.some(c => ids(result.recommendations).includes(c.id)), false);
  }
});

test("extra fallback never restores recent handled people, and remains stable on ordinary GET", () => {
  for (const size of [10, 11, 12, 13, 15, 25, 90]) {
    const locals = Array.from({ length: size }, (_, i) => card("near-" + i));
    const far = Array.from({ length: 30 }, (_, i) => card("remote-" + i, { region: "부산" }));
    const pool = [...locals, ...far], exclude = new Set(["near-0"]);
    const stamps = [now - 86400000 * 2, now - 3600000].map(n => new Date(n).toISOString());
    const run = () => rules.replayRecommendationRefreshes(source, pool, locals.slice(0, 10), stamps, exclude, 10, now, { limit: 3, excludeIds: exclude });
    const result = run();
    assert.equal(result.extraRecommendations.length, 3);
    assert.ok(result.extraRecommendations.every(c => !exclude.has(c.id) && !ids(result.recommendations).includes(c.id)));
    assert.deepEqual(result, run());
  }
});

function mockDatabase(tables, intercept) {
  const calls = [];
  return {
    calls,
    from(table) {
      const query = { table, fields: "*", filters: [], orders: [], from: 0, to: 999 };
      const builder = {
        select(fields) { query.fields = fields; return builder; },
        eq(key, value) { query.filters.push(["eq", key, value]); return builder; },
        is(key, value) { query.filters.push(["eq", key, value]); return builder; },
        neq(key, value) { query.filters.push(["neq", key, value]); return builder; },
        in(key, value) { query.filters.push(["in", key, value]); return builder; },
        gt(key, value) { query.filters.push(["gt", key, value]); return builder; },
        gte(key, value) { query.filters.push(["gte", key, value]); return builder; },
        lte(key, value) { query.filters.push(["lte", key, value]); return builder; },
        or(value) { query.filters.push(["or", value]); return builder; },
        order(key, options) { query.orders.push([key, options.ascending]); return builder; },
        range(from, to) { query.from = from; query.to = to; return builder; },
        limit(count) { query.to = count - 1; return builder; },
        maybeSingle() { query.single = true; return builder; },
        insert(values) { query.insert = Array.isArray(values) ? values : [values]; return builder; },
        update(values) { query.update = values; return builder; },
        delete() { query.delete = true; return builder; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            calls.push(structuredClone(query));
            const override = intercept?.(query, tables);
            if (override) return override;
            if (['dating_1on1_recommendation_pages', 'dating_1on1_recommendation_page_history'].includes(table) && !Object.hasOwn(tables, table)) {
              return { data: null, error: { code: '42P01', message: 'page migration not installed' } };
            }
            if (query.insert) {
              tables[table] ??= [];
              tables[table].push(...query.insert.map((row, i) => ({ id: `inserted-${tables[table].length + i}`, ...row })));
            }
            let rows = [...(tables[table] ?? [])];
            if (query.insert) rows = rows.slice(-query.insert.length);
            for (const [operation, key, value] of query.filters) {
              rows = rows.filter((row) => {
                if (operation === "eq") return row[key] === value;
                if (operation === "neq") return row[key] !== value;
                if (operation === "in") return value.includes(row[key]);
                if (operation === "gt") return row[key] != null && row[key] > value;
                if (operation === "gte") return row[key] != null && row[key] >= value;
                if (operation === "lte") return row[key] != null && row[key] <= value;
                if (operation === "or") {
                  const split = (text) => {
                    const parts = []; let depth = 0; let start = 0;
                    for (let i = 0; i < text.length; i++) {
                      if (text[i] === "(") depth++;
                      if (text[i] === ")") depth--;
                      if (text[i] === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
                    }
                    return [...parts, text.slice(start)];
                  };
                  const matches = (expression) => {
                    if (expression.startsWith("and(")) return split(expression.slice(4, -1)).every(matches);
                    const [column, operator, ...rest] = expression.split(".");
                    assert.equal(operator, "eq");
                    return row[column] === rest.join(".");
                  };
                  return split(key).some(matches);
                }
                throw new Error(`Unhandled operator ${operation}`);
              });
            }
            rows.sort((a, b) => {
              for (const [key, ascending] of query.orders) {
                if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (ascending ? 1 : -1);
              }
              return 0;
            });
            rows = rows.slice(query.from, query.to + 1);
            if (query.update) rows.forEach((row) => Object.assign(row, query.update));
            if (query.delete) {
              const deletedIds = new Set(rows.map((row) => row.id));
              tables[table] = (tables[table] ?? []).filter((row) => !deletedIds.has(row.id));
            }
            if (query.fields !== "*") {
              rows = rows.map((row) => Object.fromEntries(query.fields.split(",").map((key) => [key.trim(), row[key.trim()]])));
            }
            return { data: query.single ? rows[0] ?? null : rows, error: null };
          }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function fixture(size = 15) {
  const year = new Date().getFullYear();
  const dbCard = (id, index, overrides = {}) => ({
    id, user_id: `user-${id}`, sex: "female", birth_year: year - 27,
    name: `테스트 ${id}`, height_cm: 170, job: "직장인", region: "서울 강남구",
    intro_text: "한글 소개", strengths_text: "성실함", preferred_partner_text: "서로 존중하는 사람",
    smoking: "non_smoker", workout_frequency: "3_4", status: "approved",
    created_at: "2026-01-01T00:00:00Z", recommendation_refresh_used_at: null,
    priority_boost_expires_at: null, phone: `+8210${String(index).padStart(8, "0")}`,
    photo_paths: [`user-${id}/photo.webp`], ...overrides,
  });
  const rows = [dbCard("source", 1, { sex: "male", birth_year: year - 29 }),
    ...Array.from({ length: size }, (_, i) => dbCard(`c${i}`, i + 2))];
  return {
    dating_1on1_cards: rows,
    profiles: rows.map((row) => ({ user_id: row.user_id, phone_e164: row.phone, is_banned: false })),
    dating_1on1_match_proposals: [],
  };
}

async function runApi(tables, { intercept, signedIn = true, atTime } = {}) {
  const db = mockDatabase(tables, intercept);
  const apiLoad = createLoader({
    "@/lib/supabase/server": { createAdminClient: () => db },
    "@/lib/supabase/request": { getRequestAuthContext: async () => ({ user: signedIn ? { id: "user-source" } : null }) },
  }, atTime);
  const { GET } = apiLoad("@/app/api/dating/1on1/recommendations/my/route");
  const response = await GET(new Request("http://localhost/api/dating/1on1/recommendations/my"));
  const body = await response.json();
  if (response.ok) assert.equal(apiLoad("@/lib/dating-1on1-refresh-response").isOneOnOneRecommendationPayload(body), true,
    'Actual API output remains compatible with the client response guard');
  return { response, body, calls: db.calls };
}

async function runRefresh(tables, { intercept, signedIn = true, atTime = now, sourceId = 'source', rpc, legacyClient = false, expansionEnabled = false } = {}) {
  const db = mockDatabase(tables, intercept), rpcCalls = [];
  db.rpc = async (name, args) => {
    assert.ok(['consume_dating_1on1_recommendation_refresh_checked', 'rotate_dating_1on1_recommendations_without_charge', 'commit_dating_1on1_recommendation_page'].includes(name)); rpcCalls.push(args);
    if (rpc) return rpc(args, name);
    const repeatOnly = name === 'rotate_dating_1on1_recommendations_without_charge' || args.p_repeat_only === true;
    const source = tables.dating_1on1_cards.find(row => row.id === args.p_card_id);
    assert.equal(source.recommendation_refresh_used_at, args.p_expected_refresh_at);
    // PostgreSQL serializes timestamptz differently from JavaScript's ISO string.
    const stamp = args.p_refresh_at.replace('Z', '+00:00');
    source.recommendation_refresh_used_at = stamp;
    tables.dating_1on1_recommendation_refresh_events ??= [];
    tables.dating_1on1_recommendation_refresh_events.push({ card_id: args.p_card_id, user_id: args.p_user_id, refreshed_at: stamp,
      ...(repeatOnly ? { quota_refunded_at: stamp, rotation_only: true } : {}) });
    if (name === 'commit_dating_1on1_recommendation_page') {
      if (tables.dating_1on1_recommendation_page_history) {
        const history = tables.dating_1on1_recommendation_page_history;
        const old = tables.dating_1on1_recommendation_pages?.[0];
        if (old && !history.some(r => r.refreshed_at === old.refreshed_at)) history.push(structuredClone(old));
        history.push({ user_id: args.p_user_id, refreshed_at: stamp,
          main_candidate_ids: args.p_main_candidate_ids, extra_candidate_ids: args.p_extra_candidate_ids });
      }
      tables.dating_1on1_recommendation_pages = [{ user_id: args.p_user_id, source_card_id: args.p_card_id,
        refreshed_at: stamp, source_profile_key: args.p_source_profile_key,
        main_candidate_ids: args.p_main_candidate_ids, extra_candidate_ids: args.p_extra_candidate_ids }];
    }
    return { data: [{ allowed: true, reason: repeatOnly ? 'rotated' : 'consumed', used_count: repeatOnly ? 0 : 1,
      remaining_count: args.p_limit - (repeatOnly ? 0 : 1), refreshed_at: stamp, next_refresh_at: null }], error: null };
  };
  const apiLoad = createLoader({
    '@/lib/supabase/server': { createAdminClient: () => db },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user: signedIn ? { id: 'user-source' } : null }) },
    '@/lib/request-origin': { ensureAllowedMutationOrigin: () => null },
    '@/lib/dating-1on1-expansion': { ...load('@/lib/dating-1on1-expansion'), isExpansionEnabled: () => expansionEnabled },
  }, atTime);
  const response = await apiLoad('@/app/api/dating/1on1/recommendations/refresh/route').POST(new Request('http://localhost/api/dating/1on1/recommendations/refresh', {
    method: 'POST', body: JSON.stringify({ source_card_id: sourceId, refresh_contract: legacyClient ? undefined : 2, changed_candidate_count: 999, refresh_limit: 99 }),
  }));
  return { response, body: await response.json(), calls: db.calls, rpcCalls };
}

test('history-aware real API rotates 30 times, preserves photos and rejects unavailable pairs without charging repeats', async () => {
  const tables = fixture(80);
  tables.dating_1on1_recommendation_pages = [];
  tables.dating_1on1_recommendation_page_history = [];
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1).map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now - 1000).toISOString(),
  }));
  tables.dating_1on1_match_proposals = tables.dating_1on1_cards.slice(1).map((c, i) => pair({
    id: `pair-v2-${i}`, candidate_card_id: c.id, candidate_user_id: c.user_id,
    state: i === 0 ? 'candidate_rejected' : i === 1 ? 'source_selected' : i === 2 ? 'source_declined' : 'source_skipped',
    updated_at: new Date(now - 1000).toISOString(),
  }));
  tables.dating_user_blocks = [{ blocker_user_id: 'user-source', blocked_user_id: 'user-c3' }];
  tables.profiles.find(p => p.user_id === 'user-c4').is_banned = true;
  const pairBefore = structuredClone(tables.dating_1on1_match_proposals), ever = new Set();
  let previous = allCandidates((await runApi(tables, { atTime: now - 1 })).body);
  for (let i = 0; i < 30; i++) {
    const at = now + i * 60000;
    const result = await runRefresh(tables, { atTime: at });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.refresh_consumed, false);
    const read = await runApi(tables, { atTime: at + 1 });
    const next = allCandidates(read.body);
    assert.equal(next.length, 13); assert.equal(read.body.items[0].refresh_remaining, 1);
    assert.ok(next.every(c => !['c0', 'c1', 'c2', 'c3', 'c4'].includes(c.id)));
    assert.ok(next.every(c => c.photo_signed_urls.length > 0));
    assert.equal(next.filter(c => ids(previous).includes(c.id)).length, 0);
    next.forEach(c => ever.add(c.id));
    if (i === 6) assert.equal(ever.size, 75, 'every eligible local reached, not a repeated 20-person subset');
    assert.deepEqual(ids(allCandidates((await runApi(tables, { atTime: at + 2 })).body)), ids(next));
    previous = next;
  }
  assert.deepEqual(tables.dating_1on1_match_proposals, pairBefore);
});

test('history read failure stops a new refresh before any quota RPC or photo response', async () => {
  const tables = fixture(40);
  tables.dating_1on1_recommendation_pages = [];
  const before = structuredClone(tables);
  const result = await runRefresh(tables, { intercept: q => q.table === 'dating_1on1_recommendation_page_history'
    ? { data: null, error: { code: '57014', message: 'timeout' } } : null });
  assert.equal(result.response.status, 503);
  assert.equal(result.rpcCalls.length, 0); assert.deepEqual(tables, before);
});
test('committed page history prevents recharging when browser impressions never arrived', async () => {
  const tables = fixture(40);
  tables.dating_1on1_recommendation_pages = [];
  tables.dating_1on1_candidate_impressions = [];
  const candidates = tables.dating_1on1_cards.slice(1);
  tables.dating_1on1_recommendation_page_history = Array.from({ length: 4 }, (_, i) => ({
    user_id: 'user-source', refreshed_at: new Date(now - (i + 1) * 60000).toISOString(),
    main_candidate_ids: candidates.slice(i * 10, i * 10 + 10).map(c => c.id), extra_candidate_ids: [],
  }));
  const result = await runRefresh(tables);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.refresh_consumed, false);
  assert.equal(result.body.refresh_remaining, 1);
  assert.ok(result.body.rotated_candidate_count > 0);
});

for (const size of [0, 1, 3, 10, 11, 12, 13]) test('checked refresh with ' + size + ' eligible people never charges just for reordering', async () => {
  const tables = fixture(size), before = structuredClone(tables);
  const result = await runRefresh(tables);
  assert.equal(result.response.status, 200); assert.equal(result.body.refresh_consumed, false);
  assert.equal(result.body.changed_candidate_count, 0); assert.equal(result.body.refresh_remaining, 1);
  assert.equal(result.rpcCalls.length, 0); assert.deepEqual(tables, before);
  assert.ok(result.calls.every(call => !call.insert && !call.update && !call.delete));
});

test('refresh cannot charge for a different page made entirely of previously observed people', async () => {
  const tables = fixture(50);
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1).map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now - 3600000).toISOString(),
  }));
  const before = await runApi(tables, { atTime: now });
  const result = await runRefresh(tables);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.refresh_consumed, false);
  assert.equal(result.body.changed_candidate_count, 0);
  assert.equal(result.rpcCalls.length, 1);
  assert.ok(result.body.rotated_candidate_count > 0);
  const after = await runApi(tables, { atTime: now + 1 });
  assert.ok(allCandidates(after.body).some(c => !allCandidates(before.body).some(old => old.id === c.id)));
  assert.equal(after.body.items[0].refresh_remaining, 1);
  assert.ok(tables.dating_1on1_recommendation_refresh_events.every(e => e.rotation_only && e.quota_refunded_at));
});

test('manual refresh continues to unseen broader candidates before repeating previously observed nearby candidates', async () => {
  const tables = fixture(60);
  const sourceYear = tables.dating_1on1_cards[0].birth_year;
  for (const [i,c] of tables.dating_1on1_cards.slice(1).entries()) {
    if (i >= 20) c.birth_year = sourceYear - (i < 35 ? 8 : i < 50 ? 12 : 25);
  }
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1, 21).map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now - 3600000).toISOString(),
  }));
  const before = (await runApi(tables, { atTime: now })).body;
  assert.ok(before.items[0].recommendations.every(c => c.birth_year > sourceYear - 8), 'ordinary GET stays nearby/age-first');
  const result = await runRefresh(tables);
  assert.equal(result.response.status, 200); assert.equal(result.body.refresh_consumed, true);
  assert.equal(result.body.changed_candidate_count, 10);
  const after = (await runApi(tables, { atTime: now + 1 })).body;
  assert.ok(after.items[0].recommendations.every(c => c.birth_year === sourceYear - 8), 'choose the smallest available age gap before 12/25-year gaps');
  assert.ok(after.items[0].recommendations.every(c => c.photo_signed_urls.length > 0));
  const seenIds = new Set(tables.dating_1on1_candidate_impressions.map(r => r.candidate_user_id));
  assert.ok(after.items[0].recommendations.every(c => !seenIds.has(c.user_id)));
  tables.dating_1on1_candidate_impressions.push(...after.items[0].recommendations.map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now + 2).toISOString(),
  })));
  assert.deepEqual(ids((await runApi(tables, { atTime: now + 3 })).body.items[0].recommendations), ids(after.items[0].recommendations));
});

test('broader fallback keeps age compatibility while widening distance, then relaxes age gradually', () => {
  const helpers = createLoader({ '@/lib/region-distance': {
    getRegionDistanceMeta: (_source, region) => ({ distanceKm: region === 'unknown' ? null : Number(region) }),
  } })('@/lib/dating-1on1-recommendations');
  const locals = Array.from({ length: 13 }, (_, i) => card('viewed-' + i, { region: '10' }));
  const near = Array.from({ length: 6 }, (_, i) => card('near-broad-' + i, { region: '40', age: 38 }));
  const next = Array.from({ length: 10 }, (_, i) => card('next-broad-' + i, { region: '90', age: 39 }));
  const far = Array.from({ length: 20 }, (_, i) => card('far-age-' + i, { region: '300' }));
  const unknown = card('unknown-broad', { region: 'unknown' });
  const sorted = helpers.sortCandidatesForSource(source, [...locals, ...near, ...next, ...far, unknown], 'broader', now);
  const result = helpers.takeObservedRecommendations(source, sorted, 10, new Set(ids(locals)), new Set(ids(locals)), new Set(), now, true);
  assert.equal(result.length, 10);
  assert.ok(result.every(c => c.id.startsWith('far-age-')), 'age-compatible wider candidates precede nearby 8/9-year gaps');
  const allSeen = new Set(ids([...locals, ...far]));
  const widened = helpers.takeObservedRecommendations(source, sorted, 10, allSeen, new Set(ids(result)), new Set(), now, true);
  assert.deepEqual(new Set(ids(widened.slice(0, 6))), new Set(ids(near)));
  assert.ok(widened.slice(6).every(c => c.id.startsWith('next-broad-')));
});

test('age-compatible wider candidates still expand through distance bands for both source sexes', () => {
  const helpers = createLoader({ '@/lib/region-distance': {
    getRegionDistanceMeta: (_source, region) => ({ distanceKm: region === 'unknown' ? null : Number(region) }),
  } })('@/lib/dating-1on1-recommendations');
  for (const sex of ['male', 'female']) {
    const src = { ...source, sex };
    const age = sex === 'male' ? 28 : 32;
    const seen = Array.from({ length: 13 }, (_, i) => card('seen-' + i, { age, region: '10' }));
    const nearWide = Array.from({ length: 6 }, (_, i) => card('wide-first-' + i, { age, region: '200' }));
    const further = Array.from({ length: 10 }, (_, i) => card('wide-next-' + i, { age, region: '300' }));
    const unrelated = Array.from({ length: 10 }, (_, i) => card('wrong-age-' + i, { age: 50, region: '190' }));
    const pool = helpers.sortCandidatesForSource(src, [...unrelated, ...seen, ...further, ...nearWide], 'widen', now);
    const result = helpers.takeObservedRecommendations(src, pool, 10, new Set(ids(seen)), new Set(ids(seen)), new Set(), now, true);
    assert.deepEqual(new Set(ids(result.slice(0, 6))), new Set(ids(nearWide)));
    assert.ok(result.slice(6).every(c => c.id.startsWith('wide-next-')));
  }
});

test('a sparse broader pool with no preferred tier still ranks age before distance without dropping candidates', () => {
  const helpers = createLoader({ '@/lib/region-distance': {
    getRegionDistanceMeta: (_source, region) => ({ distanceKm: region === 'unknown' ? null : Number(region) }),
  } })('@/lib/dating-1on1-recommendations');
  const pool = [card('gap-8-far', { age: 38, region: '300' }), card('gap-8-nearer', { age: 38, region: '100' }),
    card('gap-20-close', { age: 50, region: '10' }), card('unknown-fit', { region: 'unknown' })];
  const sorted = helpers.sortCandidatesForSource(source, pool, 'scarce', now);
  const result = helpers.takeObservedRecommendations(source, sorted, 10, new Set(['earlier']), new Set(), new Set(), now, true);
  assert.deepEqual(ids(result), ['gap-8-nearer', 'gap-8-far', 'gap-20-close', 'unknown-fit']);
  // The all-seen, no-charge rotation must use the same age-aware ordering.
  const repeated = helpers.takeObservedRecommendations(source, sorted, 10, new Set(ids(pool)), new Set(), new Set(), now, true);
  assert.deepEqual(ids(repeated), ids(result));
});

test('API refresh prioritizes age-compatible wider candidates and persists the same list on subsequent GET', async () => {
  const tables = fixture(60);
  const sourceYear = tables.dating_1on1_cards[0].birth_year;
  for (const [i, c] of tables.dating_1on1_cards.slice(1).entries()) {
    if (i >= 20 && i < 40) c.birth_year = sourceYear - 15;
    if (i >= 40) c.region = '부산';
  }
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1, 21).map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now - 3600000).toISOString(),
  }));
  const result = await runRefresh(tables);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.refresh_consumed, true);
  assert.equal(result.rpcCalls.length, 1);
  const after = (await runApi(tables, { atTime: now + 1 })).body.items[0];
  assert.ok(after.recommendations.every(c => c.region === '부산' && c.birth_year > sourceYear - 15));
  assert.equal(after.recommendation_region_widened, true);
  assert.ok(after.recommendations.every(c => c.photo_signed_urls.length > 0));
  const both = [...after.recommendations, ...after.admin_recommendations];
  assert.equal(new Set(ids(both)).size, both.length);
  tables.dating_1on1_candidate_impressions.push(...both.map(c => ({ viewer_user_id: 'user-source',
    candidate_user_id: c.user_id, first_seen_at: new Date(now + 2).toISOString() })));
  const again = (await runApi(tables, { atTime: now + 3 })).body.items[0];
  assert.deepEqual(ids(again.recommendations), ids(after.recommendations));
  assert.equal(again.refresh_remaining, after.refresh_remaining);
});

test('a new suitable nearby registration returns to the front of a broader-age page without a refresh use', () => {
  const locals = Array.from({ length: 13 }, (_, i) => card('seen-local-' + i));
  const broad = Array.from({ length: 30 }, (_, i) => card('broad-' + i, { age: 38 }));
  const stamps = [new Date(now - 1000).toISOString()];
  const views = locals.map(c => ({ id: c.id, at: now - 2000 }));
  const run = pool => rules.replayRecommendationRefreshes(source, pool, locals.slice(0, 10), stamps, new Set(), 10, now,
    { limit: 3, excludeIds: new Set() }, views);
  const before = run([...locals, ...broad]);
  assert.ok(before.recommendations.every(c => c.id.startsWith('broad-')));
  const fresh = card('fresh-nearby', { created_at: new Date(now - 500).toISOString() });
  const after = run([...locals, ...broad, fresh]);
  assert.equal(after.recommendations[0].id, fresh.id);
  assert.deepEqual(after.seeds, before.seeds);
  assert.equal(new Set(ids([...after.recommendations, ...after.extraRecommendations])).size,
    after.recommendations.length + after.extraRecommendations.length);
});

test('broader unseen candidates never restore blocked, rejected, pending, banned or underage users', async () => {
  const tables = fixture(50);
  for (const c of tables.dating_1on1_cards.slice(21)) c.birth_year = tables.dating_1on1_cards[0].birth_year - 8;
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1,21).map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now - 3600000).toISOString(),
  }));
  tables.dating_user_blocks = [{ blocker_user_id: 'user-c20', blocked_user_id: 'user-source' }];
  tables.dating_1on1_admin_user_blocks = [{ user_a_id: 'user-source', user_b_id: 'user-c21' }];
  tables.dating_1on1_match_proposals = ['source_selected','mutual_accepted','candidate_rejected'].map((state,i) =>
    pair({ id: 'p'+i, state, candidate_card_id: 'c'+(22+i), candidate_user_id: 'user-c'+(22+i) }));
  tables.profiles.find(p => p.user_id === 'user-c25').is_banned = true;
  tables.profiles = tables.profiles.filter(p => p.user_id !== 'user-c26');
  tables.dating_1on1_cards.find(c => c.id === 'c27').birth_year = 2012;
  const snapshot = structuredClone(tables.dating_1on1_match_proposals);
  const result = await runRefresh(tables);
  assert.equal(result.response.status,200); assert.equal(result.body.refresh_consumed,true);
  const candidates = allCandidates((await runApi(tables,{atTime:now+1})).body);
  for (let i=20;i<=27;i++) assert.ok(!candidates.some(c => c.id === 'c'+i));
  assert.deepEqual(tables.dating_1on1_match_proposals, snapshot);
});

test('repeat-only RPC failure or cooldown never retries through the charged function', async () => {
  for (const reason of ['missing-sql','cooldown','stale']) {
    const tables = fixture(50);
    tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1).map(c => ({
      viewer_user_id:'user-source', candidate_user_id:c.user_id, first_seen_at:new Date(now-1000).toISOString(),
    }));
    const before = structuredClone(tables);
    const result = await runRefresh(tables,{ rpc: async (_args,name) => {
      assert.equal(name,'rotate_dating_1on1_recommendations_without_charge');
      return reason === 'missing-sql' ? {data:null,error:{code:'PGRST202',message:'not installed'}}
        : {data:[{allowed:false,reason,used_count:0,remaining_count:1,next_refresh_at:null}],error:null};
    }});
    assert.equal(result.rpcCalls.length,1); assert.equal(result.response.status,reason === 'missing-sql'?503:409);
    assert.deepEqual(tables,before);
  }
});

test('API refresh escapes an exhausted nearby pool and produces a stable wider unseen page', async () => {
  const tables = fixture(90);
  for (const c of tables.dating_1on1_cards.slice(21)) c.region = '부산';
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1, 21).map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now - 3600000).toISOString(),
  }));
  const seen = new Set(tables.dating_1on1_candidate_impressions.map(o => o.candidate_user_id));
  const result = await runRefresh(tables);
  assert.equal(result.response.status, 200); assert.equal(result.body.refresh_consumed, true);
  assert.equal(result.rpcCalls.length, 1);
  const first = await runApi(tables, { atTime: now + 1 });
  assert.equal(first.response.status, 200);
  const page = first.body.items[0];
  assert.equal(page.recommendation_region_widened, true);
  assert.equal(page.recommendations.length, 10);
  assert.ok(page.recommendations.every(c => c.region === '부산' && !seen.has(c.user_id)));
  assert.equal(new Set([...page.recommendations, ...page.admin_recommendations].map(c => c.user_id)).size, 13);
  tables.dating_1on1_candidate_impressions.push(...page.recommendations.map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now + 2).toISOString(),
  })));
  const after = await runApi(tables, { atTime: now + 1000 });
  assert.deepEqual(ids(after.body.items[0].recommendations), ids(page.recommendations), 'recording new views must not reshuffle the saved generation');
});

test('real API refresh advances through distance bands, preserves response shape and charges only new people', async () => {
  const tables = fixture(65);
  tables.dating_1on1_refresh_compensations = [{ user_id: 'user-source', granted_count: 5, used_count: 0 }];
  tables.dating_1on1_cards[0].region = '양산(경남)';
  const regions = ['부산', '경북 안동시', '대전', '경기 수원시', '경기 파주시'];
  tables.dating_1on1_cards.slice(1).forEach((c, i) => { c.region = regions[Math.floor(i / 13)]; });
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1, 14).map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now - 10000).toISOString(),
  }));
  for (let band = 1; band < regions.length; band++) {
    const at = now + band * 10000;
    const refreshed = await runRefresh(tables, { atTime: at });
    assert.equal(refreshed.response.status, 200); assert.equal(refreshed.body.refresh_consumed, true);
    assert.equal(refreshed.body.changed_candidate_count, 13);
    const result = await runApi(tables, { atTime: at + 1 });
    const page = allCandidates(result.body);
    assert.equal(page.length, 13); assert.equal(new Set(page.map(c => c.user_id)).size, 13);
    assert.ok(page.every(c => c.region === regions[band]));
    assert.ok(page.every(c => c.photo_signed_urls.length > 0), 'distance ranking must still hydrate images');
    tables.dating_1on1_candidate_impressions.push(...page.map(c => ({
      viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(at + 2).toISOString(),
    })));
    assert.deepEqual(ids(allCandidates((await runApi(tables, { atTime: at + 3 })).body)), ids(page));
  }
  const exhausted = await runRefresh(tables, { atTime: now + 50000 });
  assert.equal(exhausted.body.refresh_consumed, false); assert.equal(exhausted.rpcCalls.length, 1);
  assert.ok(exhausted.body.rotated_candidate_count > 0);
});

test('API inserts eligible new regional profiles on read without touching usage or restoring unsafe profiles', async () => {
  const tables = fixture(60);
  tables.dating_1on1_cards[0].region = '양산(경남)';
  for (const c of tables.dating_1on1_cards.slice(1)) c.region = '대전';
  const stamp = new Date(now - 60000).toISOString();
  tables.dating_1on1_cards[0].recommendation_refresh_used_at = stamp;
  tables.dating_1on1_recommendation_refresh_events = [{ card_id: 'source', refreshed_at: stamp }];
  const before = (await runApi(tables, { atTime: now - 2000 })).body.items[0];
  for (const c of tables.dating_1on1_cards.slice(1, 9)) {
    c.created_at = new Date(now - 1000).toISOString(); c.region = '경북 안동시';
  }
  tables.dating_user_blocks = [{ blocker_user_id: 'user-c0', blocked_user_id: 'user-source' }];
  tables.profiles.find(p => p.user_id === 'user-c1').is_banned = true;
  tables.profiles = tables.profiles.filter(p => p.user_id !== 'user-c2');
  tables.dating_1on1_candidate_favorites = [{ user_id: 'user-source', source_card_id: 'source', candidate_card_id: 'c3', created_at: stamp }];
  tables.dating_1on1_match_proposals = [
    pair({ candidate_card_id: 'c4', candidate_user_id: 'user-c4', state: 'mutual_accepted' }),
    pair({ id: 'regional-rejected', candidate_card_id: 'c5', candidate_user_id: 'user-c5', state: 'candidate_rejected' }),
  ];
  tables.dating_1on1_candidate_impressions = [{ viewer_user_id: 'user-source', candidate_user_id: 'user-c7', first_seen_at: new Date(now - day).toISOString() }];
  const snapshot = structuredClone(tables);
  const result = await runApi(tables, { atTime: now });
  const after = result.body.items[0];
  assert.ok(ids(after.recommendations).includes('c6'));
  assert.equal(after.recommendations[0].id, 'c6', 'new compatible nearby member is prioritized on ordinary GET');
  assert.equal(after.recommendations.some(c => c.id === 'c7'), false, 'an already-seen recreated card is not a new registration');
  assert.equal(allCandidates(result.body).some(c => ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'].includes(c.id)), false);
  assert.equal(after.refresh_remaining, before.refresh_remaining);
  assert.equal(after.refresh_used_count, before.refresh_used_count);
  assert.equal(after.refresh_used_at, before.refresh_used_at);
  assert.deepEqual(tables, snapshot); assert.equal(result.calls.some(q => q.insert || q.update || q.delete), false);
});

test('incident credits are separate, account-scoped and survive lapsed activity without reordering candidates', async () => {
  const tables=fixture(80),before=(await runApi(tables)).body.items[0];
  tables.dating_1on1_refresh_compensations=[{user_id:'user-source',granted_count:2,used_count:0},
    {user_id:'someone-else',granted_count:20,used_count:0}];
  const {body,response}=await runApi(tables),after=body.items[0];
  assert.equal(response.status,200);assert.equal(after.refresh_remaining,before.refresh_remaining+2);
  assert.equal(after.refresh_bonus_remaining,2);assert.equal(after.refresh_limit,1);
  assert.deepEqual(ids(after.recommendations),ids(before.recommendations));
  assert.equal(after.can_refresh,true);assert.equal(after.next_refresh_at,null);
  tables.dating_1on1_refresh_compensations[0].used_count=2;
  assert.equal((await runApi(tables)).body.items[0].refresh_remaining,before.refresh_remaining);
});

test('unchanged refresh never spends incident credits; compensation read failures fail before consumption', async () => {
  const tables=fixture(10);tables.dating_1on1_refresh_compensations=[{user_id:'user-source',granted_count:2,used_count:0}];
  const result=await runRefresh(tables);
  assert.equal(result.body.refresh_consumed,false);assert.equal(result.body.refresh_bonus_remaining,2);
  assert.equal(result.body.refresh_remaining,3);assert.equal(result.rpcCalls.length,0);
  const failed=await runRefresh(tables,{intercept:q=>q.table==='dating_1on1_refresh_compensations'?{data:null,error:{code:'57014',message:'timeout'}}:null});
  assert.equal(failed.response.status,503);assert.equal(failed.rpcCalls.length,0);
  for(const code of ['42P01','PGRST205']){
    const missing=await runApi(tables,{intercept:q=>q.table==='dating_1on1_refresh_compensations'?{data:null,error:{code,message:'missing table'}}:null});
    assert.equal(missing.response.status,200);assert.equal(missing.body.items[0].refresh_bonus_remaining,0);
  }
});

test('real API observation history changes the next refresh, not the current page or its quota', async () => {
  const tables = fixture(80);
  const before = await runApi(tables, { atTime: now-10000 });
  const displayed = allCandidates(before.body);
  tables.dating_1on1_candidate_impressions = displayed.map(c => ({ viewer_user_id: 'user-source', candidate_user_id: c.user_id,
    first_seen_at: new Date(now-9000).toISOString() }));
  const repeat = await runApi(tables, { atTime: now-8000 });
  assert.deepEqual(allCandidates(repeat.body).map(c => c.id), displayed.map(c => c.id));
  const result = await runRefresh(tables, { atTime: now });
  assert.equal(result.response.status, 200); assert.equal(result.body.refresh_consumed, true);
  const after = await runApi(tables, { atTime: now+1 });
  assert.ok(allCandidates(after.body).every(c => !displayed.some(old => old.user_id === c.user_id)));
  assert.equal(result.body.changed_candidate_count, allCandidates(after.body).length);
  tables.dating_1on1_candidate_impressions.push(...allCandidates(after.body).map(c => ({ viewer_user_id: 'user-source', candidate_user_id: c.user_id,
    first_seen_at: new Date(now+2).toISOString() })));
  const afterAck = await runApi(tables, { atTime: now+3 });
  assert.deepEqual(allCandidates(afterAck.body).map(c => c.id), allCandidates(after.body).map(c => c.id));
  assert.ok(afterAck.calls.every(q => !q.insert && !q.update && !q.delete));
  assert.equal(result.rpcCalls.length, 1);
});

test('impression read failure preserves viewing but prevents an unsafe refresh charge', async () => {
  const intercept = q => q.table === 'dating_1on1_candidate_impressions' ? { data: null, error: { code: 'XX000' } } : null;
  const tables = fixture(80), before = structuredClone(tables);
  assert.equal((await runApi(tables, { intercept, atTime: now })).response.status, 200);
  const refresh = await runRefresh(tables, { intercept });
  assert.equal(refresh.response.status, 503); assert.equal(refresh.rpcCalls.length, 0);
  assert.deepEqual(tables, before);
});

test('uninstalled impression SQL retains existing behavior during rollout', async () => {
  for (const code of ['42P01', 'PGRST205']) {
    const intercept = q => q.table === 'dating_1on1_candidate_impressions' ? { data: null, error: { code } } : null;
    const tables = fixture(80);
    const api = await runApi(tables, { intercept, atTime: now });
    assert.equal(api.response.status, 200); assert.equal(api.body.items[0].impression_ticket, null);
    assert.equal((await runRefresh(tables, { intercept })).response.status, 200);
  }
});

for (const size of [1, 10, 13]) test('observed small pools never consume quota just to reorder, pool=' + size, async () => {
  const tables = fixture(size);
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1).map(c => ({ viewer_user_id: 'user-source',
    candidate_user_id: c.user_id, first_seen_at: new Date(now-day).toISOString() }));
  const result = await runRefresh(tables);
  assert.equal(result.response.status, 200); assert.equal(result.body.refresh_consumed, false);
  assert.equal(result.rpcCalls.length, 0);
});

test('observed selection preserves current-pair and ban protections', async () => {
  const tables = fixture(50);
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1, 20).map(c => ({ viewer_user_id: 'user-source',
    candidate_user_id: c.user_id, first_seen_at: new Date(now-day).toISOString() }));
  tables.profiles.find(p => p.user_id === 'user-c49').is_banned = true;
  tables.dating_1on1_match_proposals = Array.from({ length: 20 }, (_, i) => pair({ id: 'pending-'+i,
    candidate_card_id: 'c'+(i+29), candidate_user_id: 'user-c'+(i+29) }));
  const result = await runRefresh(tables); assert.equal(result.response.status, 200);
  const after = await runApi(tables, { atTime: now+1 });
  assert.ok(allCandidates(after.body).every(c => Number(c.id.slice(1)) < 29));
  assert.equal((await runSelect(tables, { candidateId: 'c48', atTime: now+1 })).response.status, 409);
});

test('seen state follows the member when a candidate recreates their card', async () => {
  const tables = fixture(40);
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1, 21).map(c => ({ viewer_user_id: 'user-source',
    candidate_user_id: c.user_id, first_seen_at: new Date(now-day).toISOString() }));
  tables.dating_1on1_cards.find(c => c.id === 'c0').id = 'recreated-c0';
  const { body } = await runApi(tables, { atTime: now });
  assert.ok(allCandidates(body).every(c => !tables.dating_1on1_candidate_impressions.some(o => o.candidate_user_id === c.user_id)));
});

for (const size of [14, 15, 26, 80]) test('checked refresh reports actual new people after database timestamp serialization, pool=' + size, async () => {
  const tables = fixture(size);
  const before = await runApi(tables, { atTime: now + 573 });
  const priorIds = new Set(allCandidates(before.body).map(c => c.user_id));
  const result = await runRefresh(tables, { atTime: now + 573 });
  const after = await runApi(tables, { atTime: now + 574 });
  const changes = allCandidates(after.body).filter(c => !priorIds.has(c.user_id)).length;
  assert.equal(result.response.status, 200); assert.equal(result.body.changed_candidate_count, changes);
  assert.ok(changes > 0); assert.equal(result.body.refresh_consumed, true);
  assert.equal(result.rpcCalls.length, 1); assert.equal(result.rpcCalls[0].p_limit, 1);
});

test('checked refresh preserves small-pool Plus allowance and never calls any write RPC', async () => {
  const tables = fixture(13);
  tables.dating_1on1_plus_subscriptions = [{ user_id: 'user-source', starts_at: new Date(now-day).toISOString(), expires_at: new Date(now+day).toISOString() }];
  const result = await runRefresh(tables);
  assert.equal(result.body.refresh_remaining, 2); assert.equal(result.body.refresh_limit, 2);
  assert.equal(result.rpcCalls.length, 0);
});

test('old tabs receive an explicit no-charge rejection instead of misreporting one consumed use', async () => {
  const noChange = await runRefresh(fixture(13), { legacyClient: true });
  assert.equal(noChange.response.status, 409); assert.equal(noChange.body.code, 'REFRESH_UNCHANGED');
  assert.match(noChange.body.error, /횟수를 사용하지 않았어요/); assert.equal(noChange.rpcCalls.length, 0);
  const changed = await runRefresh(fixture(80), { legacyClient: true });
  assert.equal(changed.response.status, 200); assert.equal(changed.body.refresh_consumed, true);
  assert.equal(changed.rpcCalls.length, 1);
});

test('checked refresh fails closed for auth, stale source, banned account and lookup failure', async () => {
  for (const mode of ['auth', 'wrong-source', 'banned', 'db-error', 'exhausted']) {
    const tables = fixture(50);
    if (mode === 'banned') tables.profiles[0].is_banned = true;
    if (mode === 'exhausted') tables.dating_1on1_cards[0].recommendation_refresh_used_at = new Date(now-10000).toISOString();
    const result = await runRefresh(tables, { signedIn: mode !== 'auth', sourceId: mode === 'wrong-source' ? 'c0' : 'source',
      intercept: mode === 'db-error' ? q => q.table === 'profiles' ? { error: { code: 'XX000', message: 'offline' } } : null : undefined });
    assert.ok(result.response.status >= 400, mode); assert.equal(result.rpcCalls.length, 0, mode);
  }
});

test('checked refresh never retries a failed or ambiguous transaction with a second quota write', async () => {
  for (const result of [
    { error: { code: 'PGRST202', message: 'RPC not installed' }, data: null },
    { error: { code: 'XX000', message: 'response lost' }, data: null },
    { error: null, data: null },
    { error: null, data: [{ allowed: false, reason: 'stale', used_count: 1, remaining_count: 1 }] },
  ]) {
    const res = await runRefresh(fixture(80), { rpc: () => result });
    assert.ok(res.response.status >= 400); assert.equal(res.rpcCalls.length, 1);
    assert.ok(res.calls.every(call => !call.insert && !call.update && !call.delete));
  }
});

for (const dependency of ['favorites', 'activity', 'recovery', 'refresh-schema']) {
  test('checked refresh never consumes an incomplete candidate plan: ' + dependency, async () => {
    const tables = fixture(80), before = structuredClone(tables);
    const intercept = q => {
      const fails = dependency === 'favorites' ? q.table === 'dating_1on1_candidate_favorites'
        : dependency === 'recovery' ? q.table === 'dating_1on1_recommendation_recoveries'
        : dependency === 'refresh-schema' ? q.table === 'dating_1on1_recommendation_refresh_events'
        : q.table === 'dating_1on1_match_proposals' && q.filters.some(([op]) => op === 'gte');
      return fails ? { data: null, error: { code: 'PGRST205', message: q.table + ' schema cache unavailable' } } : null;
    };
    const result = await runRefresh(tables, { intercept });
    assert.ok(result.response.status >= 400); assert.equal(result.rpcCalls.length, 0);
    assert.deepEqual(tables, before);
    const readOnly = await runApi(tables, { intercept, atTime: now });
    assert.equal(readOnly.response.status, 200, 'ordinary GET retains its graceful fallback');
  });
}

test('meaningful site activity uses the existing profile query and cannot override geography/age safety', async () => {
  const tables = fixture(30);
  tables.profiles.find(p => p.user_id === 'user-c29').last_meaningful_activity_at = new Date(now-10000).toISOString();
  tables.dating_1on1_cards.find(c => c.id === 'c0').region = '부산 해운대구';
  tables.profiles.find(p => p.user_id === 'user-c0').last_meaningful_activity_at = new Date(now-10000).toISOString();
  const { body, calls } = await runApi(tables, { atTime: now });
  assert.ok(body.items[0].recommendations.some(c => c.id === 'c29'));
  assert.ok(!allCandidates(body).some(c => c.id === 'c0'));
  const activityLookups = calls.filter(q => q.table === 'profiles' && q.fields.includes('last_meaningful_activity_at'));
  assert.equal(activityLookups.length, 1);
  assert.ok(allCandidates(body).every(c => !Object.hasOwn(c, 'last_meaningful_activity_at')));
});

test('missing optional activity column falls back without dropping ban protection', async () => {
  const tables = fixture(10); tables.profiles[1].is_banned = true;
  const res = await runApi(tables, { intercept: q => q.fields.includes('last_meaningful_activity_at')
    ? { error: { code: '42703', message: 'profiles.last_meaningful_activity_at does not exist' }, data: null } : null });
  assert.equal(res.response.status, 200); assert.ok(!allCandidates(res.body).some(c => c.id === 'c0'));
  const failed = await runApi(tables, { intercept: q => q.table === 'profiles'
    ? { error: { code: '42703', message: 'is_banned does not exist' }, data: null } : null });
  assert.equal(failed.response.status, 500);
});

test('invalid/future activity is ignored and the latest real signal wins', () => {
  const latest = load('@/lib/dating-1on1-recommendation-data').latestRecommendationActivity;
  assert.equal(latest(now, null, 'invalid', new Date(now+100).toISOString()), null);
  assert.equal(latest(now, new Date(now-1000).toISOString(), new Date(now-100).toISOString()), new Date(now-100).toISOString());
});
async function runSelect(tables, { intercept, sourceId = "source", candidateId = "c0", admin = false, signedIn = true, allowedAdmin = true, atTime } = {}) {
  const db = mockDatabase(tables, intercept);
  const notifications = [];
  const apiLoad = createLoader({
    "@/lib/supabase/server": { createAdminClient: () => db },
    "@/lib/supabase/request": { getRequestAuthContext: async () => ({ user: signedIn ? { id: "user-source" } : null }) },
    "@/lib/admin": { isAllowedAdminUser: () => allowedAdmin },
    "@/lib/dating-email-templates": {
      buildOneOnOneSelectionReceivedNotification: () => ({
        emailSubject: "test",
        emailText: "test",
        pushTitle: "test",
        pushBody: "test",
      }),
    },
    "@/lib/dating-swipe": { sendDatingEmailNotification: async () => { notifications.push("email"); return true; } },
    "@/lib/dating-notifications": { notifyDatingUser: async () => { notifications.push("site"); return true; } },
    "@/lib/dating-1on1-sms": { sendOneOnOneSelectionSms: async () => { notifications.push("sms"); return false; } },
  }, atTime);
  const { POST } = apiLoad(`@/app/api/dating/1on1/matches/${admin ? "admin" : "auto"}/route`);
  const response = await POST(new Request("http://localhost/api/dating/1on1/matches/auto", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_card_id: sourceId, ...(admin ? { candidate_card_ids: [candidateId] } : { candidate_card_id: candidateId }) }),
  }));
  return { response, body: await response.json(), calls: db.calls, notifications };
}
async function runFavorite(tables) {
  const db = mockDatabase(tables);
  const apiLoad = createLoader({
    "@/lib/supabase/server": { createAdminClient: () => db },
    "@/lib/supabase/request": { getRequestAuthContext: async () => ({ user: { id: "user-source" } }) },
    "@/lib/request-origin": { ensureAllowedMutationOrigin: () => null },
  });
  const response = await apiLoad("@/app/api/dating/1on1/favorites/route").POST(new Request("http://localhost/api/dating/1on1/favorites", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_card_id: "source", candidate_card_id: "c0" }),
  }));
  return { response, body: await response.json(), calls: db.calls };
}
function allCandidates(body) {
  return body.items.flatMap((item) => [...item.recommendations, ...item.admin_recommendations]);
}

async function runExpansion(tables, snapshotIds, intercept) {
  const db = mockDatabase(tables, intercept);
  const response = await createLoader({}, now)('@/lib/dating-1on1-recommendation-service')
    .loadOneOnOneRecommendations(db, { id: 'user-source' }, undefined, { candidateIds: snapshotIds });
  return { response, body: await response.json(), calls: db.calls };
}
const activeFixture = size => {
  const tables = fixture(size);
  tables.profiles.forEach(p => { p.last_meaningful_activity_at = new Date(now - 1000).toISOString(); });
  return tables;
};
function hideCandidate(tables, candidate) {
  tables.dating_1on1_candidate_hides ??= [];
  tables.dating_1on1_candidate_hides.push({ id: 'hide-' + candidate.id, user_id: 'user-source',
    candidate_user_id: candidate.user_id, candidate_card_id: candidate.id, candidate_name: candidate.name, created_at: new Date(now).toISOString() });
}
for (const legacy of [false, true]) test('hidden candidates stay excluded through repeated refreshes, favorites, extras and re-created profiles: legacy=' + legacy, async () => {
  const tables = activeFixture(60);
  if (!legacy) { tables.dating_1on1_recommendation_pages = []; tables.dating_1on1_recommendation_page_history = []; }
  const initial = await runApi(tables, { atTime: now });
  const hidden = allCandidates(initial.body).slice(0, 7);
  hidden.forEach(c => hideCandidate(tables, c));
  const hiddenUsers = new Set(hidden.map(c => c.user_id));
  tables.dating_1on1_candidate_favorites = [{ user_id: 'user-source', source_card_id: 'source', candidate_card_id: hidden[0].id }];
  tables.dating_1on1_cards.push({ ...tables.dating_1on1_cards.find(c => c.id === hidden[1].id), id: 'recreated-hidden', created_at: new Date(now - 1).toISOString() });
  const pairBefore = structuredClone(tables.dating_1on1_match_proposals);
  for (let step = 0; step < 8; step++) {
    const at = now + step * 25 * 3600000;
    const refresh = await runRefresh(tables, { atTime: at });
    assert.equal(refresh.response.status, 200);
    const read = await runApi(tables, { atTime: at + 1 });
    assert.equal(read.response.status, 200); assert.equal(read.body.items[0].hides_enabled, true);
    const visible = allCandidates(read.body);
    assert.equal(visible.length, 13); assert.ok(visible.every(c => !hiddenUsers.has(c.user_id)));
    assert.deepEqual(read.body.items[0].favorite_candidates, []);
    assert.ok(read.body.items[0].hidden_candidate_ids.includes('recreated-hidden'));
    if (!legacy) assert.deepEqual(ids(visible), [...tables.dating_1on1_recommendation_pages[0].main_candidate_ids, ...tables.dating_1on1_recommendation_pages[0].extra_candidate_ids], 'persisted refresh matches next GET exactly');
  }
  assert.deepEqual(tables.dating_1on1_match_proposals, pairBefore);
  tables.dating_1on1_candidate_hides = [];
  const restored = await runApi(tables, { atTime: now });
  assert.equal(restored.body.items[0].favorite_candidates[0].id, hidden[0].id, 'unhide restores favorite without rewriting it');
});
test('hiding an already-saved page removes only those cards and never consumes a quota', async () => {
  const tables = activeFixture(40); tables.dating_1on1_recommendation_pages = [];
  await runRefresh(tables, { atTime: now });
  const before = allCandidates((await runApi(tables, { atTime: now + 1 })).body);
  before.slice(0, 4).forEach(c => hideCandidate(tables, c));
  const snapshot = structuredClone(tables);
  const after = await runApi(tables, { atTime: now + 2 });
  assert.deepEqual(ids(allCandidates(after.body)), ids(before.slice(4)));
  assert.deepEqual(tables, snapshot, 'ordinary GET neither alters exact page nor writes quota');
});

for (const mode of ['initial', 'legacy-refresh', 'saved-refresh']) test('hide slots: repeated reads remove only hidden people without free replacements: ' + mode, async () => {
  const tables = activeFixture(80);
  if (mode !== 'legacy-refresh') tables.dating_1on1_recommendation_pages = [];
  if (mode !== 'initial') await runRefresh(tables, { atTime: now });
  const initial = (await runApi(tables, { atTime: now + 1 })).body.items[0];
  let main = ids(initial.recommendations), extra = ids(initial.admin_recommendations);
  const expectedMain = [...main], expectedExtra = [...extra], hiddenIds = new Set();
  // Real observations of this page must not reorder it on a later GET.
  tables.dating_1on1_candidate_impressions = [...initial.recommendations, ...initial.admin_recommendations].map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now + 1).toISOString(),
  }));
  for (let step = 0; step < 3; step++) {
    const target = step === 1 ? extra[0] : main[0];
    const c = tables.dating_1on1_cards.find(c => c.id === target);
    hideCandidate(tables, c);
    tables.dating_1on1_candidate_hides.at(-1).created_at = new Date(now + 10 + step).toISOString();
    hiddenIds.add(target);
    const unchanged = structuredClone(tables);
    for (let repeat = 0; repeat < 3; repeat++) {
      const result = await runApi(tables, { atTime: now + 100 + step * 10 + repeat });
      assert.equal(result.response.status, 200);
      const group = result.body.items[0]; main = ids(group.recommendations); extra = ids(group.admin_recommendations);
      assert.deepEqual(main, expectedMain.filter(id => !hiddenIds.has(id)), 'main never refills a hidden slot');
      assert.deepEqual(extra, expectedExtra.filter(id => !hiddenIds.has(id)), 'extras never refill a hidden slot');
      assert.equal(group.refresh_remaining, initial.refresh_remaining);
      assert.deepEqual(tables, unchanged, 'GET cannot write quota, matches or a replacement page');
    }
  }
  tables.dating_1on1_candidate_hides = [];
  const restored = (await runApi(tables, { atTime: now + 200 })).body.items[0];
  assert.deepEqual(ids(restored.recommendations), expectedMain, 'restore returns the original people, not a new batch');
  assert.deepEqual(ids(restored.admin_recommendations), expectedExtra);
});

for (const legacy of [false, true]) test('hide slots: next explicit refresh fills up to 10 + 3 and repeated GET stays exact: legacy=' + legacy, async () => {
  const tables = activeFixture(80);
  if (!legacy) tables.dating_1on1_recommendation_pages = [];
  const initial = (await runApi(tables, { atTime: now })).body.items[0];
  const hidden = [...initial.recommendations.slice(0, 3), initial.admin_recommendations[0]];
  for (const c of hidden) {
    hideCandidate(tables, c); tables.dating_1on1_candidate_hides.at(-1).created_at = new Date(now + 1).toISOString();
  }
  const reduced = (await runApi(tables, { atTime: now + 2 })).body.items[0];
  assert.equal(reduced.recommendations.length, 7); assert.equal(reduced.admin_recommendations.length, 2);
  const result = await runRefresh(tables, { atTime: now + 10 });
  assert.equal(result.response.status, 200); assert.equal(result.body.refresh_consumed, true);
  assert.equal(result.rpcCalls.length, 1);
  const after = (await runApi(tables, { atTime: now + 11 })).body.items[0];
  assert.equal(after.recommendations.length, 10); assert.equal(after.admin_recommendations.length, 3);
  assert.ok([...after.recommendations, ...after.admin_recommendations].every(c => !hidden.some(h => h.user_id === c.user_id)));
  assert.equal(after.refresh_remaining, initial.refresh_remaining - 1);
  const again = (await runApi(tables, { atTime: now + 12 })).body.items[0];
  assert.deepEqual(ids(again.recommendations), ids(after.recommendations));
  assert.deepEqual(ids(again.admin_recommendations), ids(after.admin_recommendations));
});

test('hide slots: previous-day preferences apply to a new daily generation, not as permanent empty slots', async () => {
  const tables = activeFixture(40); tables.dating_1on1_recommendation_pages = [];
  const first = allCandidates((await runApi(tables, { atTime: now })).body).slice(0, 4);
  first.forEach(c => hideCandidate(tables, c));
  const snapshot = structuredClone(tables);
  const after = (await runApi(tables, { atTime: now + day })).body.items[0];
  assert.equal(after.recommendations.length, 10); assert.equal(after.admin_recommendations.length, 3);
  assert.ok([...after.recommendations, ...after.admin_recommendations].every(c => !first.some(h => h.user_id === c.user_id)));
  assert.deepEqual(tables, snapshot);
});

test('hide slots: a genuinely scarce pool is not forced to ten or charged for unchanged candidates', async () => {
  const tables = activeFixture(10); tables.dating_1on1_recommendation_pages = [];
  const first = allCandidates((await runApi(tables, { atTime: now })).body);
  hideCandidate(tables, first[0]);
  const read = await runApi(tables, { atTime: now + 1 });
  assert.equal(allCandidates(read.body).length, 9);
  const result = await runRefresh(tables, { atTime: now + 2 });
  assert.equal(result.response.status, 200); assert.equal(result.body.refresh_consumed, false);
  assert.equal(result.body.refresh_remaining, 1);
  assert.equal(allCandidates((await runApi(tables, { atTime: now + 3 })).body).length, 9);
});

test('hide slots: hiding all ten leaves no main candidates until an explicit refresh, without touching extras', async () => {
  const tables = activeFixture(80); tables.dating_1on1_recommendation_pages = [];
  const initial = (await runApi(tables, { atTime: now })).body.items[0];
  initial.recommendations.forEach(c => hideCandidate(tables, c));
  const hiddenState = structuredClone(tables);
  const after = (await runApi(tables, { atTime: now + 1 })).body.items[0];
  assert.equal(after.recommendations.length, 0);
  assert.deepEqual(ids(after.admin_recommendations), ids(initial.admin_recommendations));
  assert.equal(after.can_refresh, true); assert.equal(after.refresh_remaining, initial.refresh_remaining);
  assert.deepEqual(tables, hiddenState);
  const refresh = await runRefresh(tables, { atTime: now + 2 });
  assert.equal(refresh.response.status, 200); assert.equal(refresh.body.refresh_consumed, true);
  const next = (await runApi(tables, { atTime: now + 3 })).body.items[0];
  assert.equal(next.recommendations.length, 10);
  assert.ok(next.recommendations.every(c => !initial.recommendations.some(h => h.user_id === c.user_id)));
});

for (const legacy of [false, true]) test('hide slots: repeated hide, restore and refresh cycles retain slots and exclude earlier hides: legacy=' + legacy, async () => {
  const tables = activeFixture(100);
  if (!legacy) tables.dating_1on1_recommendation_pages = [];
  tables.dating_1on1_candidate_impressions = tables.dating_1on1_cards.slice(1).map(c => ({
    viewer_user_id: 'user-source', candidate_user_id: c.user_id, first_seen_at: new Date(now - 1000).toISOString(),
  }));
  const hiddenUsers = new Set();
  for (let round = 0; round < 3; round++) {
    const at = now + round * 10000;
    const current = (await runApi(tables, { atTime: at })).body.items[0];
    assert.equal(current.recommendations.length, 10);
    const target = current.recommendations[0];
    hideCandidate(tables, target); tables.dating_1on1_candidate_hides.at(-1).created_at = new Date(at + 1).toISOString();
    const reduced = (await runApi(tables, { atTime: at + 2 })).body.items[0];
    assert.deepEqual(ids(reduced.recommendations), ids(current.recommendations.slice(1)));
    tables.dating_1on1_candidate_hides.pop();
    const restored = (await runApi(tables, { atTime: at + 3 })).body.items[0];
    assert.deepEqual(ids(restored.recommendations), ids(current.recommendations));
    hideCandidate(tables, target); tables.dating_1on1_candidate_hides.at(-1).created_at = new Date(at + 4).toISOString();
    hiddenUsers.add(target.user_id);
    const next = await runRefresh(tables, { atTime: at + 5 });
    assert.equal(next.response.status, 200); assert.equal(next.rpcCalls.length, 1);
    assert.equal(next.body.refresh_consumed, false, 'rotating previously seen people retains the existing no-charge rule');
    const read = (await runApi(tables, { atTime: at + 6 })).body.items[0];
    assert.equal(read.recommendations.length, 10); assert.equal(read.admin_recommendations.length, 3);
    assert.ok([...read.recommendations, ...read.admin_recommendations].every(c => !hiddenUsers.has(c.user_id)));
  }
});
test('hides apply to stored expansion without refilling and do not affect another viewer', async () => {
  const tables = activeFixture(40);
  const expanded = await runExpansion(tables); const snapshotIds = ids(expanded.body.candidates);
  hideCandidate(tables, expanded.body.candidates[0]);
  const result = await runExpansion(tables, snapshotIds);
  assert.deepEqual(ids(result.body.candidates), snapshotIds.slice(1));
  tables.dating_1on1_candidate_hides[0].user_id = 'different-viewer';
  assert.deepEqual(ids((await runExpansion(tables, snapshotIds)).body.candidates), snapshotIds);
});
test('all-hidden pool and failed hide reads cannot consume refresh or expose hidden profiles', async () => {
  const tables = activeFixture(20); tables.dating_1on1_cards.slice(1).forEach(c => hideCandidate(tables, c));
  const empty = await runRefresh(tables, { atTime: now });
  assert.equal(empty.rpcCalls.length, 0);
  assert.equal(allCandidates((await runApi(tables, { atTime: now })).body).length, 0);
  assert.equal((await runExpansion(tables)).body.candidates.length, 0);
  for (const code of ['42P01', 'PGRST205', '57014']) {
    const intercept = q => q.table === 'dating_1on1_candidate_hides' ? { data: null, error: { code } } : null;
    const read = await runApi(activeFixture(20), { atTime: now, intercept });
    if (code !== '57014') { assert.equal(read.response.status, 200); assert.equal(read.body.items[0].hides_enabled, false); }
    else {
      assert.ok(read.response.status >= 500);
      assert.equal((await runRefresh(activeFixture(20), { atTime: now, intercept })).rpcCalls.length, 0);
      assert.ok((await runExpansion(activeFixture(20), undefined, intercept)).response.status >= 500);
    }
  }
});
for (const size of [0, 3, 10, 13, 14, 16, 80]) test('expansion is additive, read-only and does not duplicate main/extra: pool ' + size, async () => {
  const tables = activeFixture(size), before = structuredClone(tables);
  const main = await runApi(tables, { atTime: now });
  const result = await runExpansion(tables);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.candidates.length, Math.min(3, Math.max(0, size - 13)));
  assert.ok(result.body.candidates.every(c => !allCandidates(main.body).some(existing => existing.id === c.id)));
  assert.deepEqual(tables, before);
  assert.ok(result.calls.every(q => !q.insert && !q.update && !q.delete));
  const after = await runApi(tables, { atTime: now }); assert.deepEqual(after.body, main.body);
  for (const candidate of result.body.candidates) {
    assert.equal(candidate.name, '테스트 ' + candidate.id);
    assert.ok(!Object.hasOwn(candidate, 'phone')); assert.ok(!Object.hasOwn(candidate, 'phone_e164'));
    assert.equal(candidate.photo_signed_urls.length, 1);
  }
});
for (const mode of ['ban', 'withdrawn', 'hidden', 'favorite', 'user-block', 'reverse-block', 'admin-block',
  'phone-block', 'contact-block', 'rejected', 'matched', 'old-pending', 'old-activity', 'new-identity', 'phone-unverified']) {
  test('stored expansion revalidates ' + mode + ' without refilling', async () => {
    const tables = activeFixture(50);
    const first = await runExpansion(tables); assert.equal(first.body.candidates.length, 3);
    const snapshot = first.body.candidates.map(c => c.id), id = snapshot[0], user = 'user-' + id;
    const row = tables.dating_1on1_cards.find(c => c.id === id), profile = tables.profiles.find(p => p.user_id === user);
    if (mode === 'ban') profile.is_banned = true;
    if (mode === 'withdrawn') tables.profiles = tables.profiles.filter(p => p.user_id !== user);
    if (mode === 'hidden') row.status = 'rejected';
    if (mode === 'favorite') tables.dating_1on1_candidate_favorites = [{ user_id: 'user-source', source_card_id: 'source', candidate_card_id: id }];
    if (mode === 'user-block' || mode === 'reverse-block') tables.dating_user_blocks = [{ blocker_user_id: mode === 'user-block' ? 'user-source' : user, blocked_user_id: mode === 'user-block' ? user : 'user-source' }];
    if (mode === 'admin-block') tables.dating_1on1_admin_user_blocks = [{ user_a_id: user, user_b_id: 'user-source' }];
    if (mode === 'phone-block') tables.dating_1on1_phone_blocks = [{ user_id: 'user-source', phone_hash: load('@/lib/dating-1on1-phone-blocks').hashOneOnOneBlockedPhone(profile.phone_e164) }];
    if (mode === 'contact-block') tables.dating_contact_blocks = [{ user_id: user, block_type: 'phone', value_hash: load('@/lib/dating-contact-blocks').hashDatingContactBlockValue('phone', tables.profiles[0].phone_e164) }];
    if (mode === 'rejected' || mode === 'matched') tables.dating_1on1_match_proposals = [pair({ candidate_card_id: id, candidate_user_id: user, state: mode === 'rejected' ? 'candidate_rejected' : 'mutual_accepted' })];
    if (mode === 'old-pending') tables.dating_1on1_match_proposals = [pair({ candidate_card_id: id, candidate_user_id: user, source_selected_at: new Date(now - 30 * day).toISOString() })];
    if (mode === 'old-activity') profile.last_meaningful_activity_at = '2025-01-01';
    if (mode === 'new-identity') tables.dating_1on1_cards.push({ ...row, id: 'new-' + id, created_at: new Date(now - 100).toISOString() });
    if (mode === 'phone-unverified') profile.phone_e164 = null;
    const result = await runExpansion(tables, snapshot);
    assert.equal(result.response.status, 200);
    assert.ok(result.body.candidates.every(c => c.id !== id && snapshot.includes(c.id)));
    assert.ok(result.body.candidates.length <= 2);
  });
}
test('expansion errors cannot silently bypass eligibility or consume quota', async () => {
  for (const table of ['profiles', 'dating_user_blocks', 'dating_1on1_candidate_favorites', 'dating_1on1_match_proposals', 'dating_1on1_recommendation_refresh_events', 'dating_1on1_recommendation_recoveries']) {
    const result = await runExpansion(activeFixture(20), undefined, q => q.table === table ? { data: null, error: { code: 'XX000', message: 'test failure' } } : null);
    assert.ok(result.response.status >= 400, table); assert.equal(result.body.candidates, undefined);
    assert.ok(result.calls.every(q => !q.insert && !q.update && !q.delete));
  }
});
test('expansion requires a currently verified source without altering legacy recommendation reads', async () => {
  const tables = activeFixture(20); tables.profiles[0].phone_e164 = null;
  assert.equal((await runExpansion(tables)).response.status, 403);
  assert.equal((await runApi(tables, { atTime: now })).response.status, 200);
});
test('a refresh cannot charge only for people already seen in an expansion batch', async () => {
  const tables = activeFixture(16);
  const expanded = await runExpansion(tables);
  tables.dating_1on1_expansion_batches = [{ user_id: 'user-source', day_key: '2026-08-31', candidate_ids: expanded.body.candidates.map(c => c.id) }];
  const result = await runRefresh(tables, { expansionEnabled: true });
  assert.equal(result.response.status, 200); assert.equal(result.body.refresh_consumed, false);
  assert.equal(result.body.changed_candidate_count, 0); assert.equal(result.rpcCalls.length, 1);
  assert.ok(tables.dating_1on1_recommendation_refresh_events.every(e => e.rotation_only && e.quota_refunded_at));
});
function pair(overrides = {}) {
  return {
    id: "pair", source_card_id: "source", candidate_card_id: "c0",
    source_user_id: "user-source", candidate_user_id: "user-c0", state: "source_selected",
    created_at: new Date().toISOString(), source_selected_at: new Date().toISOString(),
    candidate_responded_at: null, updated_at: new Date().toISOString(), ...overrides,
  };
}

test("underage/malformed sources receive no candidates and do not consume refreshes", async () => {
  for (const year of [new Date().getFullYear() - 17, 2010, null, 1996.2, 9999, 1959]) {
    const tables = fixture(); tables.dating_1on1_cards[0].birth_year = year;
    const result = await runApi(tables);
    assert.equal(result.response.status, 403);
    assert.equal(result.body.code, 'DATING_AGE_INELIGIBLE');
    assert.equal(result.calls.some(q => q.insert || q.update || q.delete), false);
  }
});
test("existing underage cards are absent from main, extra and saved candidates", async () => {
  const tables = fixture(20);
  for (const row of tables.dating_1on1_cards.slice(1, 5)) row.birth_year = new Date().getFullYear() - 17;
  tables.dating_1on1_candidate_favorites = [{ source_card_id: 'source', candidate_card_id: 'c0', user_id: 'user-source', created_at: new Date().toISOString() }];
  const result = await runApi(tables);
  assert.equal(result.response.status, 200);
  for (const id of ['c0','c1','c2','c3']) assert.equal(JSON.stringify(result.body).includes(`"id":"${id}"`), false);
  assert.equal(allCandidates(result.body).length, 13);
});
test("latest underage identity cannot expose an older adult card or be selected manually/by admin", async () => {
  for (const sourceInvalid of [false, true]) {
    const tables = fixture();
    const row = tables.dating_1on1_cards[sourceInvalid ? 0 : 1];
    tables.dating_1on1_cards.push({ ...row, id: 'new-age-invalid', birth_year: 2010, created_at: '2026-09-20T12:00:00Z' });
    const result = await runApi(tables);
    if (sourceInvalid) assert.equal(result.response.status, 403);
    else assert.equal(allCandidates(result.body).some(c => c.user_id === row.user_id), false);
    for (const admin of [false, true]) {
      const selected = await runSelect(structuredClone(tables), { admin });
      assert.equal(selected.response.status, 409);
      assert.equal(selected.calls.some(q => q.insert), false);
    }
  }
});
test("birth year changed during photo hydration is not exposed", async () => {
  const result = await runApi(fixture(), { intercept: query => query.table === 'dating_1on1_cards' && query.fields.includes('photo_paths')
    ? { data: [{ ...fixture(1).dating_1on1_cards[1], birth_year: 2010 }], error: null } : null });
  assert.equal(result.response.status, 200);
  assert.equal(allCandidates(result.body).length, 0);
});

test("extra candidates never overlap main candidates, even in a small pool", () => {
  const candidates = Array.from({ length: 10 }, (_, i) => card(String(i)));
  assert.deepEqual(rules.takeRecommendations(candidates, 3, new Set(ids(candidates))), []);
  assert.deepEqual(ids(rules.takeRecommendations([...candidates, card("extra")], 3, new Set(ids(candidates)))), ["extra"]);
});
test("actual age quota is met despite four recent nearby out-of-age candidates", () => {
  const recent = Array.from({ length: 4 }, (_, i) => card(`recent-${i}`, { age: 45, created_at: new Date(now).toISOString() }));
  const ageMatched = Array.from({ length: 6 }, (_, i) => card(`age-${i}`, { age: 26, region: "부산 해운대구" }));
  const others = Array.from({ length: 8 }, (_, i) => card(`other-${i}`, { age: 45 }));
  const result = rules.takeBalancedRecommendations(source, [...recent, ...others, ...ageMatched], 10, new Set(), now);
  assert.equal(result.length, 10);
  assert.equal(result.filter((candidate) => rules.isCandidateInSourceAgeRange(source, candidate)).length, 6);
});
test("recent candidates count toward both quotas when applicable", () => {
  const recent = Array.from({ length: 4 }, (_, i) => card(`recent-${i}`, { last_active_at: new Date(now).toISOString() }));
  const candidates = [...recent, ...Array.from({ length: 20 }, (_, i) => card(String(i)))];
  const sorted = rules.sortCandidatesForSource(source, candidates, "day", now);
  const result = rules.takeBalancedRecommendations(source, sorted, 10, new Set(), now);
  assert.equal(result.filter((candidate) => candidate.last_active_at).length, 4);
  assert.equal(result.length, 10);
});

test('equally suitable nearby active candidates receive a majority without jumping age or distance tiers', () => {
  const inactive = Array.from({ length: 30 }, (_, i) => card(`inactive-${i}`));
  const active = Array.from({ length: 12 }, (_, i) => card(`active-${i}`, { region: '경기 수원', last_active_at: new Date(now - day).toISOString() }));
  const distant = Array.from({ length: 20 }, (_, i) => card(`distant-${i}`, { region: '부산', last_active_at: new Date(now - 1000).toISOString() }));
  const wrongAge = Array.from({ length: 20 }, (_, i) => card(`wrong-age-${i}`, { age: 48, last_active_at: new Date(now - 1000).toISOString() }));
  for (let seed = 0; seed < 20; seed++) {
    const result = rules.takeBalancedRecommendations(source,
      rules.sortCandidatesForSource(source, [...inactive, ...active, ...distant, ...wrongAge], String(seed), now), 10, new Set(), now);
    assert.equal(result.length, 10);
    assert.ok(result.filter(c => c.id.startsWith('active-')).length >= 6);
    assert.ok(result.every(c => rules.isCandidateInSourceAgeRange(source, c)));
    assert.ok(result.every(c => !/^(distant|wrong-age)-/.test(c.id)));
  }
});
test("daily variety does not move remote candidates ahead of equally suitable local candidates", () => {
  const candidates = [card("local"), card("remote", { region: "부산 해운대구" })];
  for (let i = 0; i < 30; i += 1) {
    const sorted = rules.sortCandidatesForSource(source, candidates, String(i), now);
    assert.equal(sorted[0].id, "local");
    assert.equal(rules.takeBalancedRecommendations(source, sorted, 10, new Set(), now)[0].id, "local");
  }
});
test("recent real activity outranks unknown activity within the same geography and age tier", () => {
  const sorted = rules.sortCandidatesForSource(source, [card("unknown"), card("active", { last_active_at: new Date(now - day).toISOString() })], "day", now);
  assert.equal(sorted[0].id, "active");
});
test("Plus priority survives daily seed changes within an equivalent relevance tier", () => {
  for (let i = 0; i < 20; i += 1) {
    const candidates = [card("free"), card("plus", { plus_expires_at: new Date(now + day).toISOString() })];
    assert.equal(rules.sortCandidatesForSource(source, candidates, String(i), now)[0].id, "plus");
  }
});
test("unknown ages/regions and invalid dates remain eligible without throwing", () => {
  const candidates = [card("unknown", { age: null, region: "", created_at: "invalid" })];
  assert.equal(rules.takeBalancedRecommendations(source, rules.sortCandidatesForSource(source, candidates, "day", now), 10, new Set(), now).length, 1);
});
test("main soft exclusions are used only when alternatives are insufficient", () => {
  const candidates = Array.from({ length: 12 }, (_, i) => card(String(i)));
  const exclude = new Set(["0", "1"]);
  assert.equal(rules.takeBalancedRecommendations(source, candidates, 10, exclude, now).some((candidate) => exclude.has(candidate.id)), false);
  assert.equal(rules.takeBalancedRecommendations(source, candidates.slice(0, 3), 10, exclude, now).length, 3);
});
test("refresh prioritizes alternatives and expires at exactly 24 hours", () => {
  assert.equal(rules.getActiveRecommendationRefresh(new Date(now - day).toISOString(), now), null);
  assert.equal(rules.getActiveRecommendationRefresh("invalid", now), null);
  assert.equal(rules.getActiveRecommendationRefresh(new Date(now + day).toISOString(), now), null);
  assert.ok(rules.getActiveRecommendationRefresh(new Date(now - day + 1).toISOString(), now));
  assert.equal(rules.sortRefreshCandidatesForSource(source, [card("old"), card("new")], "refresh", new Set(["old"]), now)[0].id, "new");
});
test("selection has no duplicate IDs, respects the limit and retains sorted order across varied pools", () => {
  for (let size = 0; size <= 60; size += 1) {
    const candidates = Array.from({ length: size }, (_, i) => card(String(i), { age: 19 + i % 32, region: i % 2 ? "서울 강남구" : "부산 해운대구" }));
    const sorted = rules.sortCandidatesForSource(source, candidates, "day", now);
    const result = rules.takeBalancedRecommendations(source, sorted, 10, new Set(), now);
    assert.equal(result.length, Math.min(size, 10));
    assert.equal(new Set(ids(result)).size, result.length);
    assert.deepEqual(ids(result), ids(sorted.filter((candidate) => ids(result).includes(candidate.id))));
    const extras = rules.takeRecommendations(sorted, 3, new Set(ids(result)));
    assert.equal(extras.some((candidate) => ids(result).includes(candidate.id)), false);
  }
});

test("API rejects unsigned requests without a database query", async () => {
  const result = await runApi(fixture(), { signedIn: false });
  assert.equal(result.response.status, 401);
  assert.equal(result.calls.length, 0);
});
test("API returns immediately for users with no application", async () => {
  const tables = fixture();
  tables.dating_1on1_cards.shift();
  const result = await runApi(tables);
  assert.deepEqual(result.body, { items: [] });
  assert.equal(result.calls.length, 1);
  assert.ok(result.calls[0].filters.some(([op, key, value]) => op === "eq" && key === "user_id" && value === "user-source"));
});
test("API fetches only opposite-sex summaries and hydrates at most 13 unique cards", async () => {
  const tables = fixture(80);
  tables.dating_1on1_cards.push({ ...tables.dating_1on1_cards[0], id: "same-sex", user_id: "other-male" });
  const result = await runApi(tables);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.items[0].recommendations.length, 10);
  assert.equal(result.body.items[0].admin_recommendations.length, 3);
  const candidates = allCandidates(result.body);
  assert.equal(new Set(ids(candidates)).size, 13);
  assert.ok(candidates.every((candidate) => candidate.sex === "female"));
  const scans = result.calls.filter((call) => call.table === "dating_1on1_cards");
  assert.ok(scans.length >= 3);
  assert.ok(scans[1].filters.some(([op, key, value]) => op === "in" && key === "sex" && value.join() === "female"));
  for (const scan of scans.slice(0, 2)) {
    assert.equal(scan.fields.includes("photo_paths"), false);
    assert.equal(scan.fields.includes("intro_text"), false);
  }
  const details = scans.filter((query) => query.fields.includes("photo_paths"));
  assert.equal(details.length, 1);
  assert.equal(details[0].filters.find(([op, key]) => op === "in" && key === "id")[2].length, 13);
  const identityScans = scans.filter((query) => query.fields === "id,user_id,phone,created_at");
  assert.ok(identityScans.every((query) => query.filters.some(([op, key]) => op === "in" && ["user_id", "phone"].includes(key))));
  for (const candidate of candidates) {
    assert.equal(candidate.intro_text, "한글 소개");
    assert.equal(candidate.photo_signed_urls.length, 1);
    for (const internal of ["phone", "phone_e164", "last_active_at", "priority_boost_expires_at", "plus_expires_at", "photo_paths"]) {
      assert.equal(Object.hasOwn(candidate, internal), false);
    }
  }
});
test("female source sees only male candidates", async () => {
  const tables = fixture(2);
  tables.dating_1on1_cards[0].sex = "female";
  tables.dating_1on1_cards[1].sex = "male";
  const result = await runApi(tables);
  assert.deepEqual(ids(allCandidates(result.body)), ["c0"]);
});
test("banned, withdrawn and rejected cards are excluded", async () => {
  const tables = fixture(4);
  tables.profiles.find((row) => row.user_id === "user-c0").is_banned = true;
  tables.profiles = tables.profiles.filter((row) => row.user_id !== "user-c1");
  tables.dating_1on1_cards.find((row) => row.id === "c2").status = "rejected";
  const result = await runApi(tables);
  assert.deepEqual(ids(allCandidates(result.body)), ["c3"]);
});
test("banned source cannot request recommendations", async () => {
  const tables = fixture();
  tables.profiles[0].is_banned = true;
  assert.equal((await runApi(tables)).response.status, 403);
});
test("identity duplicates and own verified phone are excluded", async () => {
  const tables = fixture(4);
  tables.profiles[1].phone_e164 = tables.profiles[0].phone_e164;
  tables.profiles[2].phone_e164 = "+821012345678";
  tables.profiles[3].phone_e164 = "01012345678";
  tables.dating_1on1_cards[3].created_at = "2026-02-01T00:00:00Z";
  const result = await runApi(tables);
  assert.deepEqual(new Set(ids(allCandidates(result.body))), new Set(["c2", "c3"]));
});
for (const reverse of [false, true]) {
  test(`active and permanent rejection exclusions work ${reverse ? "in reverse" : "directly"}`, async () => {
    const tables = fixture(3);
    const makePair = (candidate, state) => pair({
      id: `pair-${candidate}`, state,
      source_card_id: reverse ? candidate : "source", candidate_card_id: reverse ? "source" : candidate,
      source_user_id: reverse ? `user-${candidate}` : "user-source", candidate_user_id: reverse ? "user-source" : `user-${candidate}`,
    });
    tables.dating_1on1_match_proposals = [makePair("c0", "mutual_accepted"), makePair("c1", "candidate_rejected")];
    // Permanent rejection is user-level even after the old card is replaced.
    tables.dating_1on1_cards.find((row) => row.id === "c1").id = "c1-new";
    assert.deepEqual(ids(allCandidates((await runApi(tables)).body)), ["c2"]);
  });
  test(`user and admin blocks work ${reverse ? "in reverse" : "directly"}`, async () => {
    const tables = fixture(3);
    tables.dating_user_blocks = [{ blocker_user_id: reverse ? "user-c0" : "user-source", blocked_user_id: reverse ? "user-source" : "user-c0" }];
    tables.dating_1on1_admin_user_blocks = [{ user_a_id: reverse ? "user-c1" : "user-source", user_b_id: reverse ? "user-source" : "user-c1" }];
    assert.deepEqual(ids(allCandidates((await runApi(tables)).body)), ["c2"]);
  });
  test(`phone and unified contact blocks work ${reverse ? "in reverse" : "directly"}`, async () => {
    const tables = fixture(3);
    const phoneLib = load("@/lib/dating-1on1-phone-blocks");
    const contactLib = load("@/lib/dating-contact-blocks");
    tables.dating_1on1_phone_blocks = [{ user_id: reverse ? "user-c0" : "user-source", phone_hash: phoneLib.hashOneOnOneBlockedPhone(tables.profiles[reverse ? 0 : 1].phone_e164) }];
    tables.dating_contact_blocks = [{ user_id: reverse ? "user-c1" : "user-source", block_type: "phone", value_hash: contactLib.hashDatingContactBlockValue("phone", tables.profiles[reverse ? 0 : 2].phone_e164) }];
    assert.deepEqual(ids(allCandidates((await runApi(tables)).body)), ["c2"]);
  });
}
test("old pending pairs stay excluded even when the main and extra pool would otherwise be empty", async () => {
  const tables = fixture(1);
  tables.dating_1on1_match_proposals = [pair({ source_selected_at: new Date(Date.now() - 3 * day).toISOString() })];
  const result = await runApi(tables);
  assert.deepEqual(result.body.items[0].recommendations, []);
  assert.deepEqual(result.body.items[0].admin_recommendations, []);
});
test("safe schema fallback retains opposite-sex filtering and avoids detail fields", async () => {
  const result = await runApi(fixture(2), { intercept: (query) => query.fields.includes("priority_boost_expires_at")
    ? { data: null, error: { code: "42703", message: "column priority_boost_expires_at does not exist" } } : null });
  assert.equal(result.response.status, 200);
  assert.equal(allCandidates(result.body).length, 2);
  const candidateScans = result.calls.filter((query) => query.table === "dating_1on1_cards" && !query.fields.includes("photo_paths") && query.filters.some(([op, key]) => op === "neq" && key === "user_id"));
  assert.equal(candidateScans.length, 2);
  assert.ok(candidateScans.every((query) => query.filters.some(([op, key]) => op === "in" && key === "sex")));
});
test("summary pagination does not silently cap the eligible pool at 500 or 1000", async () => {
  const result = await runApi(fixture(1005));
  assert.equal(result.body.items[0].candidate_pool_count, 1005);
  const candidateScans = result.calls.filter((query) => query.table === "dating_1on1_cards" && query.filters.some(([op]) => op === "neq"));
  assert.deepEqual(candidateScans.map((query) => query.from), [0, 500, 1000]);
  assert.equal(allCandidates(result.body).length, 13);
});
test("optional activity failure preserves candidates, but ban/context/detail failures do not disclose them", async () => {
  const failure = { data: null, error: { code: "XX000", message: "backend unavailable" } };
  const activityFailure = await runApi(fixture(2), { intercept: (query) =>
    query.table === "dating_1on1_match_proposals" && query.filters.some(([op]) => op === "gte") ? failure : null });
  assert.equal(activityFailure.response.status, 200);
  assert.equal(allCandidates(activityFailure.body).length, 2);
  for (const table of ["profiles", "dating_user_blocks"]) {
    const result = await runApi(fixture(2), { intercept: (query) => query.table === table ? failure : null });
    assert.equal(result.response.status, 500);
    assert.equal(Object.hasOwn(result.body, "items"), false);
  }
  const detailFailure = await runApi(fixture(2), { intercept: (query) => query.fields.includes("photo_paths") ? failure : null });
  assert.equal(detailFailure.response.status, 500);
});
test("cards changed to rejected or another sex during hydration are omitted", async () => {
  const result = await runApi(fixture(3), { intercept: (query, tables) => {
    if (query.fields.includes("photo_paths")) {
      tables.dating_1on1_cards.find((row) => row.id === "c0").status = "rejected";
      tables.dating_1on1_cards.find((row) => row.id === "c1").sex = "male";
    }
  } });
  assert.deepEqual(ids(allCandidates(result.body)), ["c2"]);
});
test("activity credits only the participant who acted, not the passive recipient", async () => {
  const tables = fixture(2);
  tables.dating_1on1_match_proposals = [pair({ source_user_id: "user-c0", candidate_user_id: "user-c1", source_selected_at: new Date(now - day).toISOString(), candidate_responded_at: null })];
  const activity = await load("@/lib/dating-1on1-recommendation-data").fetchRecommendationActivity(mockDatabase(tables), ["user-c0", "user-c1"], now);
  assert.equal(activity.has("user-c0"), true);
  assert.equal(activity.has("user-c1"), false);
});
test("free/Plus refresh limits and legacy timestamps remain compatible", async () => {
  for (const plus of [false, true]) {
    const tables = fixture(1);
    const refreshedAt = new Date(Date.now() - 10000).toISOString();
    tables.dating_1on1_cards[0].recommendation_refresh_used_at = refreshedAt;
    tables.dating_1on1_recommendation_refresh_events = [{ card_id: "source", refreshed_at: refreshedAt }];
    if (plus) tables.dating_1on1_plus_subscriptions = [{ user_id: "user-source", expires_at: new Date(Date.now() + day).toISOString() }];
    const group = (await runApi(tables)).body.items[0];
    assert.equal(group.refresh_limit, plus ? 2 : 1);
    assert.equal(group.refresh_used_count, 1);
    assert.equal(group.refresh_remaining, plus ? 1 : 0);
    assert.equal(group.can_refresh, plus);
  }
});

test("saved candidates are separated from rotating recommendations without duplication", async () => {
  const tables = fixture(15);
  tables.dating_1on1_candidate_favorites = [{
    id: "favorite-1",
    user_id: "user-source",
    source_card_id: "source",
    candidate_card_id: "c0",
    created_at: "2026-08-31T02:00:00Z",
  }];
  const { response, body } = await runApi(tables);
  assert.equal(response.status, 200);
  assert.deepEqual(body.items[0].favorite_candidates.map((candidate) => candidate.id), ["c0"]);
  assert.equal(body.items[0].recommendations.some((candidate) => candidate.id === "c0"), false);
  assert.equal(body.items[0].admin_recommendations.some((candidate) => candidate.id === "c0"), false);
});

test("a second Plus refresh excludes both the default and first refreshed candidate lists", async () => {
  const firstRefreshedAt = new Date(Date.now() - 60_000).toISOString();
  const secondRefreshedAt = new Date(Date.now() - 30_000).toISOString();
  const firstTables = fixture(40);
  firstTables.dating_1on1_cards[0].recommendation_refresh_used_at = firstRefreshedAt;
  firstTables.dating_1on1_recommendation_refresh_events = [
    { card_id: "source", refreshed_at: firstRefreshedAt },
  ];
  const firstRecommendations = (await runApi(firstTables)).body.items[0].recommendations;

  const secondTables = fixture(40);
  secondTables.dating_1on1_cards[0].recommendation_refresh_used_at = secondRefreshedAt;
  secondTables.dating_1on1_recommendation_refresh_events = [
    { card_id: "source", refreshed_at: firstRefreshedAt },
    { card_id: "source", refreshed_at: secondRefreshedAt },
  ];
  const secondRecommendations = (await runApi(secondTables)).body.items[0].recommendations;

  assert.equal(firstRecommendations.length, 10);
  assert.equal(secondRecommendations.length, 10);
  assert.equal(secondRecommendations.some((candidate) => ids(firstRecommendations).includes(candidate.id)), false);
});

test('support quota refunds preserve exact candidate seeds and restore only the refunded charges', async () => {
  const tables = fixture(80);
  const stamps = [now - 3600000, now - 1800000].map(value => new Date(value).toISOString());
  tables.dating_1on1_cards[0].recommendation_refresh_used_at = stamps[1];
  tables.dating_1on1_recommendation_refresh_events = stamps.map(refreshed_at => ({ card_id: 'source', refreshed_at }));
  tables.dating_1on1_plus_subscriptions = [{ user_id: 'user-source', expires_at: new Date(now+day).toISOString() }];
  const original = (await runApi(tables, { atTime: now })).body.items[0];
  assert.equal(original.refresh_remaining, 0);
  for (let refunded = 1; refunded <= 2; refunded++) {
    tables.dating_1on1_recommendation_refresh_events[refunded-1].quota_refunded_at = new Date(now-1000).toISOString();
    const result = await runApi(tables, { atTime: now });
    assert.equal(result.response.status, 200);
    const item = result.body.items[0];
    assert.equal(item.refresh_remaining, refunded); assert.equal(item.refresh_used_count, 2-refunded);
    assert.equal(item.refresh_limit, 2); assert.equal(item.refresh_used_at, stamps[1]);
    assert.equal(item.can_refresh, true); assert.equal(item.next_refresh_at, null);
    assert.deepEqual(item.recommendations, original.recommendations);
    assert.deepEqual(item.admin_recommendations, original.admin_recommendations);
    assert.deepEqual(item.plus, original.plus);
    assert.ok(result.calls.every(c=>!c.insert&&!c.update&&!c.delete));
  }
  const refresh = await runRefresh(tables, { atTime: now });
  assert.equal(refresh.response.status, 200); assert.equal(refresh.body.refresh_consumed, true);
  const after = (await runApi(tables, { atTime: now+1 })).body.items[0];
  assert.equal(after.refresh_remaining, 1); assert.equal(after.refresh_used_count, 1);
  assert.equal(tables.dating_1on1_recommendation_refresh_events.length, 3);
  assert.deepEqual(tables.dating_1on1_recommendation_refresh_events.slice(0,2).map(e=>e.refreshed_at), stamps);
});

test('Plus expiry waits for enough normal charges to expire; bonus credits stay independent', async () => {
  const tables = fixture(40);
  const stamps = [now - 7200000, now - 3600000].map(value => new Date(value).toISOString());
  tables.dating_1on1_cards[0].recommendation_refresh_used_at = stamps[1];
  tables.dating_1on1_recommendation_refresh_events = stamps.map(refreshed_at => ({ card_id: 'source', refreshed_at }));
  tables.dating_1on1_plus_subscriptions = [{ user_id: 'user-source', expires_at: new Date(now-1000).toISOString() }];
  const before = structuredClone(tables);
  for (const atTime of [now, Date.parse(stamps[0])+day]) {
    const item = (await runApi(tables, { atTime })).body.items[0];
    assert.equal(item.refresh_limit, 1); assert.equal(item.refresh_remaining, 0);
    assert.equal(item.next_refresh_at, new Date(Date.parse(stamps[1])+day).toISOString());
    assert.equal(item.can_refresh, false);
  }
  const restored = (await runApi(tables, { atTime: Date.parse(stamps[1])+day })).body.items[0];
  assert.equal(restored.refresh_remaining, 1); assert.equal(restored.can_refresh, true);
  assert.deepEqual(tables, before, 'time-based allowance checks never mutate history');
  tables.dating_1on1_refresh_compensations = [{ user_id: 'user-source', granted_count: 2, used_count: 1 }];
  const withBonus = (await runApi(tables, { atTime: now })).body.items[0];
  assert.equal(withBonus.refresh_remaining, 1); assert.equal(withBonus.refresh_bonus_remaining, 1);
  assert.equal(withBonus.next_refresh_at, null); assert.equal(withBonus.can_refresh, true);
  const afterRollover = (await runApi(tables, { atTime: Date.parse(stamps[1])+day })).body.items[0];
  assert.equal(afterRollover.refresh_remaining, 2); assert.equal(afterRollover.refresh_bonus_remaining, 1);
});

test('missing refund column during rollout retains the original charged quota', async () => {
  const tables = fixture(50);
  const stamp = new Date(now-1000).toISOString();
  tables.dating_1on1_cards[0].recommendation_refresh_used_at = stamp;
  tables.dating_1on1_recommendation_refresh_events = [{ card_id:'source',refreshed_at:stamp }];
  const result = await runApi(tables, { atTime:now, intercept:q=>q.table==='dating_1on1_recommendation_refresh_events'&&q.fields.includes('quota_refunded_at')
    ? {data:null,error:{code:'42703',message:'column quota_refunded_at does not exist'}} : null });
  assert.equal(result.response.status,200); assert.equal(result.body.items[0].refresh_remaining,0);
  assert.equal(result.calls.filter(q=>q.table==='dating_1on1_recommendation_refresh_events').length,2);
});

test("a second Plus refresh safely refills a genuinely small pool", async () => {
  const firstRefreshedAt = new Date(Date.now() - 60_000).toISOString();
  const secondRefreshedAt = new Date(Date.now() - 30_000).toISOString();
  const tables = fixture(12);
  tables.dating_1on1_cards[0].recommendation_refresh_used_at = secondRefreshedAt;
  tables.dating_1on1_recommendation_refresh_events = [
    { card_id: "source", refreshed_at: firstRefreshedAt },
    { card_id: "source", refreshed_at: secondRefreshedAt },
  ];
  const recommendations = (await runApi(tables)).body.items[0].recommendations;

  assert.equal(recommendations.length, 10);
  assert.equal(new Set(ids(recommendations)).size, 10);
});

test("cross-day refresh history rotates candidates without consuming today's allowance", async () => {
  const tables = fixture(45);
  const atTime = Date.parse('2026-09-08T14:00:00.000Z');
  const old = new Date(atTime - 26 * 3600000).toISOString();
  const latest = new Date(atTime - 10000).toISOString();
  tables.dating_1on1_recommendation_refresh_events = [{ card_id: 'source', refreshed_at: old }];
  const expired = (await runApi(tables, { atTime })).body.items[0];
  assert.equal(expired.refresh_used_count, 0);
  assert.equal(expired.refresh_remaining, 1);
  const refreshedTables = structuredClone(tables);
  refreshedTables.dating_1on1_cards[0].recommendation_refresh_used_at = latest;
  refreshedTables.dating_1on1_recommendation_refresh_events.push({ card_id: 'source', refreshed_at: latest });
  const refreshed = (await runApi(refreshedTables, { atTime })).body.items[0];
  assert.equal(refreshed.refresh_used_count, 1);
  assert.equal(refreshed.refresh_remaining, 0);
  assert.equal(refreshed.recommendations.some(c=>ids(expired.recommendations).includes(c.id)), false);
  const normalize = c => ({ ...c, age: load('@/lib/dating-1on1').toDatingOneOnOneAge(c.birth_year) });
  const expectedSource = normalize(refreshedTables.dating_1on1_cards[0]);
  const pool = refreshedTables.dating_1on1_cards.slice(1).map(normalize);
  const defaults = rules.takeBalancedRecommendations(expectedSource,
    rules.sortCandidatesForSource(expectedSource, pool, '2026-09-08:default', atTime), 10, new Set(), atTime);
  // Different random seeds may legitimately yield the same page. Verify the
  // real two-event replay, not an unreliable comparison against a one-event page.
  const expected = rules.replayRecommendationRefreshes(expectedSource, pool, defaults, [old, latest], new Set(), 10, atTime);
  assert.deepEqual(ids(refreshed.recommendations), ids(expected.recommendations));
});

test("history replay maximizes rotation within comparable candidates even after the pool has all been seen", () => {
  for (const size of [0, 1, 9, 10, 11, 12, 19, 20, 60]) {
    const pool = Array.from({length:size},(_,i)=>card(`p${i}`, { age: 28 }));
    const defaults = rules.takeBalancedRecommendations(source,pool,10,new Set(),now);
    let previous = defaults;
    const stamps = [];
    for (let i=0;i<8;i++) {
      stamps.push(new Date(now-(8-i)*1000).toISOString());
      const result = rules.replayRecommendationRefreshes(source,pool,defaults,stamps,new Set(),10,now);
      assert.equal(result.recommendations.length, Math.min(size,10));
      assert.equal(new Set(ids(result.recommendations)).size, result.recommendations.length);
      const newCount = result.recommendations.filter(c=>!ids(previous).includes(c.id)).length;
      assert.equal(newCount, Math.min(10,Math.max(size-10,0)));
      assert.deepEqual(result, rules.replayRecommendationRefreshes(source,pool,defaults,stamps,new Set(),10,now));
      previous = result.recommendations;
    }
  }
});

test("daily refresh expiry rotates the currently displayed defaults across genders, ages and regions", () => {
  const start = Date.parse('2026-09-01T03:00:00Z');
  for (const sex of ['male', 'female']) {
    for (const region of ['서울 강남구', '경기 의정부', '부산 해운대구', '대전 서구', '광주 북구', '제주 제주시']) {
      for (const size of [5, 10, 12, 20, 30, 50, 100]) {
        for (const age of [23, 30, 39]) {
          const sourceCard = card(`${sex}-${region}-${age}`, { sex, region, age });
          const pool = Array.from({ length: size }, (_, i) => card(`c-${i}`, {
            sex: sex === 'male' ? 'female' : 'male', region,
            age: age + (i % 6) - (sex === 'male' ? 4 : 1),
          }));
          const stamps = [];
          for (let index = 0; index < 8; index++) {
            const at = start + index * (day + 1000);
            const date = load('@/lib/weekly').getKstDateString(new Date(at));
            // The GET route shows daily defaults after the prior refresh expires.
            const visible = rules.takeBalancedRecommendations(sourceCard,
              rules.sortCandidatesForSource(sourceCard, pool, `${date}:default`, at), 10, new Set(), at);
            stamps.push(new Date(at + 1).toISOString());
            const result = rules.replayRecommendationRefreshes(sourceCard, pool, visible, stamps, new Set(), 10, at + 2);
            assert.equal(result.recommendations.length, Math.min(size, 10));
            const novel = result.recommendations.filter(c => !ids(visible).includes(c.id)).length;
            assert.equal(novel, Math.min(10, Math.max(size - 10, 0)), `${sex}/${region}/${age}/${size}/day${index}`);
          }
        }
      }
    }
  }
});

test("real GET expiry and KST midnight transitions match the page being refreshed, with unchanged allowances", async () => {
  const start = Date.parse('2026-09-01T14:59:00Z'); // 23:59 KST
  for (const sex of ['male', 'female']) {
    const tables = fixture(20);
    tables.dating_1on1_cards[0].sex = sex;
    for (const row of tables.dating_1on1_cards.slice(1)) {
      row.sex = sex === 'male' ? 'female' : 'male';
      row.birth_year = 1995;
    }
    tables.dating_1on1_recommendation_refresh_events = [];
    tables.dating_1on1_plus_subscriptions = [{ user_id: 'user-source', expires_at: new Date(start + 30 * day).toISOString() }];
    for (const offset of [0, 120000, day + 121000, day + 181000, 2 * day + 182000, 7 * day + 183000]) {
      const at = start + offset;
      const before = (await runApi(tables, { atTime: at })).body.items[0];
      const refreshedAt = new Date(at + 1).toISOString();
      tables.dating_1on1_cards[0].recommendation_refresh_used_at = refreshedAt;
      tables.dating_1on1_recommendation_refresh_events.push({ card_id: 'source', refreshed_at: refreshedAt });
      const result = await runApi(tables, { atTime: at + 2 });
      const after = result.body.items[0];
      assert.equal(before.can_refresh, true);
      assert.equal(after.recommendations.length, 10);
      const oldPage = [...before.recommendations, ...before.admin_recommendations];
      const newPage = [...after.recommendations, ...after.admin_recommendations];
      assert.equal(newPage.filter(c => !ids(oldPage).includes(c.id)).length,
        Math.min(newPage.length, 20 - oldPage.length), `${sex}/${offset}: count different people, not section moves`);
      assert.equal(after.refresh_used_count, before.refresh_used_count + 1);
      assert.equal(after.refresh_remaining, before.refresh_remaining - 1);
      assert.equal(after.admin_recommendations.some(c => ids(after.recommendations).includes(c.id)), false);
      assert.equal(result.calls.some(c => c.insert || c.update || c.delete), false);
    }
  }
});

test("legacy refreshes exhaust unshown compatible locals before widening to unshown distant people", () => {
  const locals = Array.from({ length: 45 }, (_, i) => card(`local-${i}`));
  const remote = Array.from({ length: 80 }, (_, i) => card(`remote-${i}`, { region: '부산 해운대구' }));
  const pool = [...locals, ...remote];
  const defaults = rules.takeBalancedRecommendations(source, rules.sortCandidatesForSource(source, pool, 'day', now), 10, new Set(), now);
  let previous = defaults;
  const encountered = new Set(ids(defaults));
  const times = [];
  for (let index = 0; index < 10; index++) {
    times.push(new Date(now - 6 * day + index * 1000).toISOString());
    const result = rules.replayRecommendationRefreshes(source, pool, defaults, times, new Set(locals.slice(0, 25).map(c => c.id)), 10, now);
    assert.equal(result.recommendations.length, 10);
    const remainingLocal = locals.filter(c => !encountered.has(c.id));
    assert.equal(result.recommendations.filter(c => remainingLocal.some(x => x.id === c.id)).length, Math.min(10, remainingLocal.length));
    assert.ok(result.recommendations.every(c => !encountered.has(c.id)), 'never repeat a replayed page while eligible alternatives remain');
    assert.equal(result.recommendations.some(c => ids(previous).includes(c.id)), false);
    previous = result.recommendations;
    for (const c of result.recommendations) encountered.add(c.id);
  }
});

test("repeated refreshes leave exhausted nearby tiers before repeating them", () => {
  for (const sex of ['male', 'female']) {
    const src = card('regional-source', { sex, age: 31, region: '양산(경남)' });
    const peerSex = sex === 'male' ? 'female' : 'male';
    const closest = Array.from({ length: 19 }, (_, i) => card('ideal-' + i, { sex: peerSex, age: 31, region: '부산 해운대구' }));
    const similar = Array.from({ length: 22 }, (_, i) => card('similar-' + i, { sex: peerSex, age: sex === 'male' ? 33 : 29, region: '부산 해운대구' }));
    const distant = Array.from({ length: 80 }, (_, i) => card('remote-' + i, { sex: peerSex, age: 31, region: '서울 강남구' }));
    const wrongAge = Array.from({ length: 20 }, (_, i) => card('wrong-age-' + i, { sex: peerSex, age: 50, region: '부산 해운대구' }));
    const pool = [...closest, ...similar, ...distant, ...wrongAge];
    const defaults = rules.takeBalancedRecommendations(src, rules.sortCandidatesForSource(src, pool, 'default', now), 10, new Set(), now);
    const initial = rules.replayRecommendationRefreshes(src, pool, defaults, [], new Set(), 10, now, { limit: 3, excludeIds: new Set() });
    const encountered = new Set([...ids(initial.recommendations), ...ids(initial.extraRecommendations)]);
    const stamps = [];
    for (let index = 0; index < 4; index++) {
      stamps.push(new Date(now - 60000 + index * 1000).toISOString());
      const result = rules.replayRecommendationRefreshes(src, pool, defaults, stamps, new Set(), 10, now, { limit: 3, excludeIds: new Set() });
      const fresh = result.recommendations.filter(c => !encountered.has(c.id));
      assert.ok(fresh.length >= 4, `round ${index}: genuinely unseen similar locals remain`);
      const remainingNearby = [...closest, ...similar].filter(c => !encountered.has(c.id));
      assert.equal(result.recommendations.filter(c => remainingNearby.some(x => x.id === c.id)).length, Math.min(10, remainingNearby.length));
      assert.ok(result.recommendations.every(c => !c.id.startsWith('wrong-age-')));
      assert.equal(new Set(ids(result.recommendations)).size, 10);
      assert.equal(result.extraRecommendations.some(c => ids(result.recommendations).includes(c.id)), false);
      assert.deepEqual(result, rules.replayRecommendationRefreshes(src, pool, defaults, stamps, new Set(), 10, now, { limit: 3, excludeIds: new Set() }));
      for (const c of [...result.recommendations, ...result.extraRecommendations]) encountered.add(c.id);
    }
    assert.ok(encountered.size > 19, 'must not stay trapped within the same 19 people');
  }
});

test("refresh keeps unseen best matches first, broadens exhausted pools, and defers recently handled profiles", () => {
  const best = Array.from({ length: 50 }, (_, i) => card('best-' + i));
  const similar = Array.from({ length: 20 }, (_, i) => card('similar-' + i, { age: 32 }));
  const run = (pool, defaults) => rules.replayRecommendationRefreshes(source, pool, defaults,
    [new Date(now - 1000).toISOString()], new Set(), 10, now, { limit: 3, excludeIds: new Set() });
  assert.ok(run([...best, ...similar], best.slice(0, 10)).recommendations.every(c => c.id.startsWith('best-')));
  const unsafe = [
    card('far', { region: '부산' }), card('unknown-region', { region: '모름' }),
    card('wrong-age', { age: 50 }), card('unknown-age', { age: null }),
    card('recent-handled', { age: 32, last_handled_at: new Date(now - 1000).toISOString() }),
  ];
  const widened = run([...best.slice(0, 13), ...unsafe], best.slice(0, 10)).recommendations;
  assert.ok(widened.some(c => c.id === 'far'));
  assert.ok(widened.every(c => c.id !== 'recent-handled'));
  // This pure ranking helper is not an eligibility gate. API tests separately
  // prove malformed/underage/blocked candidates cannot enter any of its pools.
});

for (const sex of ['male', 'female']) test(`regional rotation agrees with charged plans across three days and Plus refreshes (${sex})`, async () => {
  const tables = fixture(80);
  for (const [i, c] of tables.dating_1on1_cards.entries()) {
    c.sex = i === 0 ? sex : sex === 'male' ? 'female' : 'male';
    c.birth_year = 1996;
    c.region = i === 0 ? '양산(경남)' : i <= 41 ? '부산 해운대구' : '서울 강남구';
    if (i > 19 && i <= 41) c.birth_year = sex === 'male' ? 1994 : 1998;
  }
  tables.dating_1on1_plus_subscriptions = [{ user_id: 'user-source', starts_at: new Date(now-day).toISOString(), expires_at: new Date(now+7*day).toISOString() }];
  const seen = new Set();
  for (const offset of [0, 25 * 3600000, 50 * 3600000, 54 * 3600000]) {
    const atTime = now + offset + 573;
    const before = (await runApi(tables, { atTime })).body;
    const beforeIds = new Set(allCandidates(before).map(c => c.user_id));
    for (const c of allCandidates(before)) seen.add(c.user_id);
    const result = await runRefresh(tables, { atTime });
    const after = (await runApi(tables, { atTime: atTime + 1 })).body;
    const repeatedRead = (await runApi(tables, { atTime: atTime + 2 })).body;
    const changed = allCandidates(after).filter(c => !beforeIds.has(c.user_id));
    assert.equal(result.response.status, 200);
    assert.equal(result.body.refresh_consumed, true);
    assert.equal(result.body.changed_candidate_count, changed.length);
    assert.ok(changed.length >= 4);
    assert.equal(result.rpcCalls.length, 1);
    assert.equal(after.items[0].refresh_used_count, before.items[0].refresh_used_count + 1);
    assert.equal(after.items[0].refresh_remaining, before.items[0].refresh_remaining - 1);
    assert.deepEqual(ids(allCandidates(after)), ids(allCandidates(repeatedRead)));
    assert.ok(after.items[0].recommendations.every(c => Math.abs(c.birth_year - 1996) <= 2));
    for (const c of allCandidates(after)) seen.add(c.user_id);
  }
  assert.ok(seen.size > 19);
  const exhausted = await runRefresh(tables, { atTime: now + 54 * 3600000 + 1000 });
  assert.equal(exhausted.response.status, 409);
  assert.equal(exhausted.rpcCalls.length, 0, 'variety never grants extra Plus allowance');
});

test('new nearby variety slots retain bans, blocks, pending requests, rejections and favorites', async () => {
  const tables = fixture(40);
  tables.dating_1on1_cards.slice(14).forEach(c => { c.birth_year -= 4; }); // outside preferred age, but within six years
  const blocked = ['c13', 'c14', 'c15', 'c16', 'c17', 'c18'];
  tables.profiles.find(p => p.user_id === 'user-c13').is_banned = true;
  tables.dating_user_blocks = [{ blocker_user_id: 'user-source', blocked_user_id: 'user-c14' }];
  tables.dating_1on1_cards.find(c => c.id === 'c15').status = 'hidden';
  tables.dating_1on1_match_proposals = [
    { source_user_id: 'user-c16', candidate_user_id: 'user-source', state: 'source_selected', source_card_id: 'c16', candidate_card_id: 'source' },
    { source_user_id: 'user-source', candidate_user_id: 'user-c17', state: 'candidate_rejected', source_card_id: 'source', candidate_card_id: 'c17' },
  ];
  tables.dating_1on1_candidate_favorites = [{ user_id: 'user-source', source_card_id: 'source', candidate_card_id: 'c18', created_at: new Date(now-1000).toISOString() }];
  const result = await runRefresh(tables, { atTime: now });
  assert.equal(result.body.refresh_consumed, true);
  const after = (await runApi(tables, { atTime: now + 1 })).body;
  assert.ok(allCandidates(after).every(c => !blocked.includes(c.id)));
  assert.equal(after.items[0].recommendations.filter(c => Number(c.id.slice(1)) > 18).length, 10);
  assert.deepEqual(ids(after.items[0].favorite_candidates), ['c18']);
});

test("handled pairs do not erase exposure history: older pages rotate before a repeat", () => {
  const pool = Array.from({ length: 90 }, (_, i) => card(`handled-${i}`, {
    last_handled_at: new Date(now - 15 * day).toISOString(),
  }));
  const handled = new Set(ids(pool));
  const defaults = rules.takeBalancedRecommendations(source, pool, 10, handled, now);
  const seen = new Set(ids(defaults));
  const stamps = [];
  for (let i = 0; i < 6; i++) {
    stamps.push(new Date(now - 60000 + i * 1000).toISOString());
    const result = rules.replayRecommendationRefreshes(source, pool, defaults, stamps, handled, 10, now);
    assert.equal(result.recommendations.length, 10);
    assert.equal(result.recommendations.some(c => seen.has(c.id)), false);
    for (const c of result.recommendations) seen.add(c.id);
  }
});

test("recently handled locals wait behind other comparable locals without forcing distant matches", () => {
  const recent = Array.from({length: 15}, (_,i)=>card(`recent-${i}`, { last_handled_at: new Date(now-day).toISOString() }));
  const older = Array.from({length: 15}, (_,i)=>card(`older-${i}`, { region: '경기 수원', last_handled_at: new Date(now-10*day).toISOString() }));
  const distant = Array.from({length: 15}, (_,i)=>card(`distant-${i}`, { region: '제주' }));
  const sorted = rules.sortCandidatesForSource(source,[...recent,...older,...distant],'cooldown',now);
  const result = rules.takeBalancedRecommendations(source,sorted,10,new Set([...ids(recent),...ids(older)]),now);
  assert.ok(result.every(c=>c.id.startsWith('older-')));
  const small = rules.takeBalancedRecommendations(source,rules.sortCandidatesForSource(source,[...recent,...distant],'small',now),10,new Set(ids(recent)),now);
  assert.ok(small.every(c=>c.id.startsWith('recent-')));
  assert.equal(rules.isRecentlyHandledCandidate(card('boundary',{last_handled_at:new Date(now-7*day).toISOString()}),now),false);
});

test("extras explicitly rotate past high-priority previous extras within the same local tier", async () => {
  const tables = fixture(120);
  const at = Date.parse('2026-09-20T04:00:00Z');
  for (const [i,c] of tables.dating_1on1_cards.slice(1).entries()) {
    c.region = ['서울 강남구','서울 동작구','경기 수원','서울 송파구'][i%4];
    if (i < 20) c.recommendation_refresh_used_at = new Date(at-10000).toISOString();
  }
  tables.dating_1on1_plus_subscriptions = [{ user_id:'user-source',expires_at:new Date(at+day).toISOString() }];
  tables.dating_1on1_recommendation_refresh_events = [];
  let before=(await runApi(tables,{atTime:at})).body.items[0];
  for(let i=0;i<2;i++) {
    const t=at+1000+i*1000, stamp=new Date(t).toISOString();
    tables.dating_1on1_cards[0].recommendation_refresh_used_at=stamp;
    tables.dating_1on1_recommendation_refresh_events.push({card_id:'source',refreshed_at:stamp});
    const result=await runApi(tables,{atTime:t+1}), after=result.body.items[0];
    assert.equal(after.admin_recommendations.length,3);
    assert.equal(after.admin_recommendations.some(c=>ids(before.admin_recommendations).includes(c.id)),false);
    assert.equal(after.admin_recommendations.some(c=>ids(after.recommendations).includes(c.id)),false);
    assert.equal(after.recommendations.some(c=>ids(before.admin_recommendations).includes(c.id)),false, 'extra-to-main repeats wait while equally suitable unseen people remain');
    assert.equal(result.calls.some(c=>c.insert||c.update||c.delete),false);
    before=after;
  }
});

test("old recyclable pairs may fill local extras; recent and permanently rejected pairs cannot", async () => {
  const tables=fixture(45), at=Date.parse('2026-09-20T04:00:00Z');
  tables.dating_1on1_match_proposals=tables.dating_1on1_cards.slice(1).map((c,i)=>pair({
    id:`history-${i}`,candidate_card_id:c.id,candidate_user_id:c.user_id,
    state:i===0?'candidate_rejected':i===1?'source_declined':i<5?'source_skipped':'admin_canceled',
    updated_at:new Date(at-(i<5?1:14)*day).toISOString(), created_at:new Date(at-20*day).toISOString(),
  }));
  const group=(await runApi(tables,{atTime:at})).body.items[0];
  assert.equal(group.admin_recommendations.length,3);
  assert.ok(group.admin_recommendations.every(c=>Number(c.id.slice(1))>=5));
  assert.ok([...group.recommendations,...group.admin_recommendations].every(c=>!['c0','c1'].includes(c.id)));
});

test("extras in tiny and mixed-region pools remain unique, never overlap main or introduce rejected inputs", () => {
  for(const size of [0,1,3,9,10,11,12,15,20,30,70]) {
    const pool=Array.from({length:size},(_,i)=>card(`small-${i}`,{region:i%5===0?'부산':'서울 강남구'}));
    const defaults=rules.takeBalancedRecommendations(source,rules.sortCandidatesForSource(source,pool,'d',now),10,new Set(),now);
    const stamps=[new Date(now-10000).toISOString(),new Date(now-5000).toISOString()];
    const result=rules.replayRecommendationRefreshes(source,pool,defaults,stamps,new Set(),10,now,{limit:3,excludeIds:new Set(['small-1'])});
    assert.ok(result.extraRecommendations.length<=3);
    assert.equal(new Set(ids(result.extraRecommendations)).size,result.extraRecommendations.length);
    assert.ok(result.extraRecommendations.every(c=>!ids(result.recommendations).includes(c.id)&&c.id!=='small-1'));
    assert.deepEqual(result,rules.replayRecommendationRefreshes(source,pool,defaults,stamps,new Set(),10,now,{limit:3,excludeIds:new Set(['small-1'])}));
  }
});

test("extras rotate at midnight and refresh expiry for both sexes, without changing on repeated reads", async () => {
  const start = Date.parse('2026-09-01T14:59:00Z');
  for (const sex of ['male', 'female']) {
    const tables = fixture(120);
    tables.dating_1on1_cards[0].sex = sex;
    for (const c of tables.dating_1on1_cards.slice(1)) {
      c.sex = sex === 'male' ? 'female' : 'male'; c.birth_year = tables.dating_1on1_cards[0].birth_year;
    }
    tables.dating_1on1_recommendation_refresh_events = [];
    for (const offset of [0, 120000, day + 121000, day + 181000, 7 * day + 183000]) {
      const at = start + offset;
      const before = (await runApi(tables, { atTime: at })).body.items[0];
      const stamp = new Date(at + 1).toISOString();
      tables.dating_1on1_cards[0].recommendation_refresh_used_at = stamp;
      tables.dating_1on1_recommendation_refresh_events.push({ card_id: 'source', refreshed_at: stamp });
      const after = (await runApi(tables, { atTime: at + 2 })).body.items[0];
      const repeated = (await runApi(tables, { atTime: at + 3 })).body.items[0];
      assert.equal(after.admin_recommendations.length, 3);
      assert.equal(after.admin_recommendations.some(c => ids(before.admin_recommendations).includes(c.id)), false, `${sex}/${offset}`);
      assert.deepEqual(ids(after.admin_recommendations), ids(repeated.admin_recommendations));
      assert.equal(after.admin_recommendations.some(c => ids(after.recommendations).includes(c.id)), false);
    }
  }
});

test("soft handled history does not rank far-away people above enough compatible locals", () => {
  const locals = Array.from({ length: 20 }, (_, i) => card(`local-${i}`));
  const far = Array.from({ length: 20 }, (_, i) => card(`far-${i}`, { region: '제주' }));
  const sorted = rules.sortCandidatesForSource(source, [...far, ...locals], 'day', now);
  const result = rules.takeBalancedRecommendations(source, sorted, 10, new Set(ids(locals)), now);
  assert.equal(result.length, 10);
  assert.ok(result.every(c => c.id.startsWith('local-')));
});

test("daily variety works across different nearby cities instead of only exact distance ties", () => {
  const pool = Array.from({ length: 40 }, (_, i) => card(`variety-${i}`, {
    region: ['서울 서초구', '서울 송파구', '서울 동작구', '경기 과천시', '서울 강동구'][i % 5],
    age: 26 + i % 6,
  }));
  const dayOne = rules.sortCandidatesForSource(source, pool, '2026-09-15:admin-extra', now).slice(0, 3);
  const dayTwo = rules.sortCandidatesForSource(source, pool, '2026-09-16:admin-extra', now).slice(0, 3);
  assert.notDeepEqual(ids(dayOne).sort(), ids(dayTwo).sort());
  assert.deepEqual(dayOne, rules.sortCandidatesForSource(source, pool, '2026-09-15:admin-extra', now).slice(0, 3));
});

test("compatible new profiles appear during an active refresh without being counted in older history", () => {
  const pool = Array.from({ length: 40 }, (_, i) => card(`old-${i}`));
  const fresh = card('fresh-near', { created_at: new Date(now - 500).toISOString() });
  const far = card('fresh-far', { region: '제주', created_at: fresh.created_at });
  const ageMismatch = card('fresh-wrong-age', { age: 60, created_at: fresh.created_at });
  const defaults = pool.slice(0, 10);
  const stamps = [new Date(now - 2 * day).toISOString(), new Date(now - 1000).toISOString()];
  const before = rules.replayRecommendationRefreshes(source, pool, defaults, stamps, new Set(), 10, now);
  const after = rules.replayRecommendationRefreshes(source, [...pool, fresh, far, ageMismatch], defaults, stamps, new Set(), 10, now);
  assert.ok(ids(after.recommendations).includes(fresh.id));
  assert.ok(!ids(after.recommendations).includes(far.id));
  assert.ok(!ids(after.recommendations).includes(ageMismatch.id));
  assert.equal(after.recommendations.filter(c => ids(before.recommendations).includes(c.id)).length, 9);
  assert.deepEqual(after.seeds, before.seeds);
  const refreshed = rules.replayRecommendationRefreshes(source, [...pool, fresh], defaults, [...stamps, new Date(now).toISOString()], new Set(), 10, now);
  assert.equal(refreshed.recommendations.some(c => ids(after.recommendations).includes(c.id)), false);
});

test("unrefreshed main recommendations reserve space for new compatible profiles", () => {
  const active = Array.from({ length: 30 }, (_, i) => card(`active-${i}`, { last_active_at: new Date(now).toISOString() }));
  const fresh = Array.from({ length: 4 }, (_, i) => card(`fresh-${i}`, { created_at: new Date(now - 1000).toISOString() }));
  const sorted = rules.sortCandidatesForSource(source, [...active, ...fresh], 'day', now);
  const result = rules.takeBalancedRecommendations(source, sorted, 10, new Set(), now);
  assert.equal(result.filter(c => c.id.startsWith('fresh-')).length, 2);
  assert.equal(result.length, 10);
});

test("a formerly empty historical pool is refilled when enough new profiles register", () => {
  const pool = Array.from({ length: 20 }, (_, i) => card(`new-${i}`, { created_at: new Date(now - 500).toISOString() }));
  const result = rules.replayRecommendationRefreshes(source, pool, pool.slice(0, 10), [new Date(now - 1000).toISOString()], new Set(), 10, now);
  assert.equal(result.recommendations.length, 10);
  assert.equal(new Set(ids(result.recommendations)).size, 10);
});

test("extra candidates rotate with refresh and day while preserving quotas, favorites and no overlap", async () => {
  const tables = fixture(100);
  const atTime = Date.parse('2026-09-15T03:00:00Z');
  tables.dating_1on1_cards.slice(1).forEach((c, i) => {
    c.region = ['서울 서초구', '서울 송파구', '서울 동작구', '경기 과천시', '서울 강동구'][i % 5];
  });
  const before = (await runApi(tables, { atTime })).body.items[0];
  const nextDay = (await runApi(tables, { atTime: atTime + day })).body.items[0];
  assert.notDeepEqual(ids(before.admin_recommendations).sort(), ids(nextDay.admin_recommendations).sort());
  const stamp = new Date(atTime - 1000).toISOString();
  tables.dating_1on1_cards[0].recommendation_refresh_used_at = stamp;
  tables.dating_1on1_recommendation_refresh_events = [{ card_id: 'source', refreshed_at: stamp }];
  const snapshot = structuredClone(tables);
  const result = await runApi(tables, { atTime });
  const after = result.body.items[0];
  assert.notDeepEqual(ids(before.admin_recommendations).sort(), ids(after.admin_recommendations).sort());
  assert.equal(after.admin_recommendations.length, 3);
  assert.equal(after.admin_recommendations.some(c => ids(after.recommendations).includes(c.id)), false);
  assert.equal(after.refresh_used_count, 1);
  assert.equal(after.refresh_remaining, 0);
  assert.deepEqual(tables, snapshot);
  assert.equal(result.calls.some(c => c.insert || c.update || c.delete), false);
});

test("new-profile insertion still respects bans, blocks, withdrawals, active matches and favorites", async () => {
  const tables = fixture(50);
  const atTime = Date.parse('2026-09-16T03:00:00Z');
  const stamp = new Date(atTime - 60000).toISOString();
  for (const c of tables.dating_1on1_cards.slice(1, 8)) c.created_at = new Date(atTime - 1000).toISOString();
  tables.dating_1on1_cards[0].recommendation_refresh_used_at = stamp;
  tables.dating_1on1_recommendation_refresh_events = [{ card_id: 'source', refreshed_at: stamp }];
  tables.dating_user_blocks = [{ blocker_user_id: 'user-c0', blocked_user_id: 'user-source' }];
  tables.profiles.find(p => p.user_id === 'user-c1').is_banned = true;
  tables.profiles = tables.profiles.filter(p => p.user_id !== 'user-c2');
  tables.dating_1on1_candidate_favorites = [{ user_id: 'user-source', source_card_id: 'source', candidate_card_id: 'c3', created_at: stamp }];
  tables.dating_1on1_match_proposals = [
    pair({ candidate_card_id: 'c4', candidate_user_id: 'user-c4', state: 'mutual_accepted' }),
    pair({ id: 'rejected', candidate_card_id: 'c5', candidate_user_id: 'user-c5', state: 'candidate_rejected' }),
  ];
  const before = structuredClone(tables);
  const result = await runApi(tables, { atTime });
  assert.equal(result.response.status, 200);
  const group = result.body.items[0];
  assert.ok(ids(group.recommendations).includes('c6'));
  assert.ok(!allCandidates(result.body).some(c => ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'].includes(c.id)));
  assert.deepEqual(ids(group.favorite_candidates), ['c3']);
  assert.equal(group.refresh_used_count, 1);
  assert.equal(group.refresh_remaining, 0);
  assert.deepEqual(tables, before);
});

test("history replay calculates geography once per candidate and never caches across sources", () => {
  const geography = load('@/lib/region-distance');
  let calls = 0;
  const instrumented = createLoader({ '@/lib/region-distance': {
    getRegionDistanceMeta: (...args) => { calls++; return geography.getRegionDistanceMeta(...args); },
  } })('@/lib/dating-1on1-recommendations');
  const pool = Array.from({ length: 500 }, (_, i) => card(`perf-${i}`));
  const seeds = Array.from({ length: 14 }, (_, i) => new Date(now - (14 - i) * 1000).toISOString());
  instrumented.replayRecommendationRefreshes(source, pool, pool.slice(0, 10), seeds, new Set(), 10, now, { limit: 3, excludeIds: new Set() });
  assert.equal(calls, pool.length);
  calls = 0;
  instrumented.replayRecommendationRefreshes({ ...source, region: '부산' }, pool, pool.slice(0, 10), seeds, new Set(), 10, now, { limit: 3, excludeIds: new Set() });
  assert.equal(calls, pool.length);
});

test("refresh replay ignores invalid, future, duplicate and expired history", () => {
  const pool = Array.from({length:40},(_,i)=>card(`history${i}`));
  const stamp = new Date(now-1000).toISOString();
  const result = rules.replayRecommendationRefreshes(source,pool,pool.slice(0,10),
    ['bad',new Date(now+1).toISOString(),new Date(now-7*day).toISOString(),stamp,stamp],new Set(),10,now);
  assert.deepEqual(result.seeds,[stamp]);
  assert.equal(result.recommendations.length,10);
});

test("refreshes more than 24 hours apart avoid the visible daily page, not a no-longer-displayed historical page", () => {
  const pool = Array.from({length:60},(_,i)=>card(`daily${i}`,{age:20+i%15}));
  const date = load('@/lib/weekly').getKstDateString(new Date(now));
  const defaults = rules.takeBalancedRecommendations(source,
    rules.sortCandidatesForSource(source, pool, `${date}:default`, now), 10, new Set(), now);
  const first = new Date(now-2*day).toISOString();
  const second = new Date(now-1000).toISOString();
  // GET no longer displays the first replay after its 24-hour window expires.
  // Insisting on avoiding that stale page can return the visible page unchanged.
  const after = rules.replayRecommendationRefreshes(source,pool,defaults,[first,second],new Set(),10,now).recommendations;
  assert.equal(after.some(c=>ids(defaults).includes(c.id)),false);
});

test("recovery replays only a recorded past timestamp within normal refresh history", () => {
  const stamp = '2026-09-08T13:30:00.000Z';
  const recovery = Date.parse(stamp);
  assert.equal(rules.getRecommendationRecoverySeed(stamp, recovery), stamp);
  assert.equal(rules.getRecommendationRecoverySeed(stamp, recovery - 1), null);
  assert.equal(rules.getRecommendationRecoverySeed(stamp, recovery + 7 * day - 1), stamp);
  assert.equal(rules.getRecommendationRecoverySeed(stamp, recovery + 7 * day), null);
  for (const missing of [null, undefined, '', 'invalid']) {
    assert.equal(rules.getRecommendationRecoverySeed(missing, recovery), null);
  }
});

test("automatic recovery is deterministic, quota-free, read-only and preserves safety/favorites", async () => {
  const cutoff = Date.parse('2026-09-08T13:12:00.000Z');
  const recovery = Date.parse('2026-09-08T13:30:00.000Z');
  for(const plus of [false,true]) for(const expired of [false,true]) {
    const tables = fixture(65);
    const times = [cutoff-3*day,cutoff-(expired?26*3600000:1000)].map(ms=>new Date(ms).toISOString());
    tables.dating_1on1_cards[0].recommendation_refresh_used_at=times[1];
    tables.dating_1on1_recommendation_refresh_events=times.map(refreshed_at=>({card_id:'source',refreshed_at}));
    tables.dating_1on1_recommendation_recoveries=[{user_id:'user-source',card_id:'source',refreshed_at:new Date(recovery).toISOString()}];
    if(plus)tables.dating_1on1_plus_subscriptions=[{user_id:'user-source',expires_at:new Date(recovery+day).toISOString()}];
    tables.profiles.find(p=>p.user_id==='user-c0').is_banned=true;
    tables.dating_1on1_candidate_favorites=[{user_id:'user-source',source_card_id:'source',candidate_card_id:'c1',created_at:new Date(cutoff).toISOString()}];
    const before=(await runApi(tables,{atTime:recovery-1})).body.items[0];
    const result=await runApi(tables,{atTime:recovery+1000});
    const after=result.body.items[0];
    const again=(await runApi(tables,{atTime:recovery+1000})).body.items[0];
    assert.equal(after.recovery_refresh_applied,true);
    for(const key of ['refresh_used_count','refresh_remaining','refresh_limit','next_refresh_at','refresh_used_at'])assert.equal(after[key],before[key],key);
    assert.equal(after.recommendations.some(c=>ids(before.recommendations).includes(c.id)),false);
    assert.deepEqual(ids(after.recommendations),ids(again.recommendations));
    assert.equal(after.recommendations.some(c=>['c0','c1'].includes(c.id)),false);
    assert.deepEqual(ids(after.favorite_candidates),['c1']);
    assert.equal(after.admin_recommendations.some(c=>ids(after.recommendations).includes(c.id)),false);
    assert.equal(result.calls.some(c=>c.insert||c.update||c.delete),false);
  }
});

test("reading after the normal refresh window never grants another recovery or changes quota", async () => {
  const cutoff = Date.parse('2026-09-08T13:12:00.000Z');
  const recovery = Date.parse('2026-09-08T13:30:00.000Z');
  const tables = fixture(65);
  const times = [cutoff - 6 * day, cutoff - 2 * day].map(ms => new Date(ms).toISOString());
  tables.dating_1on1_cards[0].recommendation_refresh_used_at = times[1];
  tables.dating_1on1_recommendation_refresh_events = times.map(refreshed_at => ({ card_id: 'source', refreshed_at }));
  tables.dating_1on1_recommendation_recoveries = [{ user_id: 'user-source', card_id: 'source', refreshed_at: new Date(recovery).toISOString() }];
  const before = structuredClone(tables);
  for (const atTime of [recovery + day - 1, recovery + day, recovery + 2 * day, recovery + 10 * day]) {
    const result = await runApi(tables, { atTime });
    assert.equal(result.response.status, 200);
    const group = result.body.items[0];
    assert.equal(group.recovery_refresh_applied, atTime < recovery + day);
    assert.equal(group.refresh_used_count, 0);
    assert.equal(group.refresh_remaining, 1);
    assert.equal(group.can_refresh, true);
    assert.equal(group.recommendations.length, 10);
    assert.equal(group.admin_recommendations.some(c => ids(group.recommendations).includes(c.id)), false);
    assert.equal(result.calls.filter(c => c.table === 'dating_1on1_recommendation_refresh_events').length, 1);
    assert.equal(result.calls.some(c => c.insert || c.update || c.delete), false);
    assert.deepEqual(tables, before);
  }
});

test("a manual refresh after recovery rotates again and charges only the real refresh", async () => {
  const cutoff = Date.parse('2026-09-08T13:12:00.000Z');
  const recovery = Date.parse('2026-09-08T13:30:00.000Z');
  for (const plus of [false, true]) {
    const tables = fixture(80);
    const times = [cutoff - 3 * day, cutoff - 26 * 3600000].map(ms => new Date(ms).toISOString());
    tables.dating_1on1_cards[0].recommendation_refresh_used_at = times[1];
    tables.dating_1on1_recommendation_refresh_events = times.map(refreshed_at => ({ card_id: 'source', refreshed_at }));
    tables.dating_1on1_recommendation_recoveries = [{ user_id: 'user-source', card_id: 'source', refreshed_at: new Date(recovery).toISOString() }];
    if (plus) tables.dating_1on1_plus_subscriptions = [{ user_id: 'user-source', expires_at: new Date(recovery + day).toISOString() }];
    const before = (await runApi(tables, { atTime: recovery + 1000 })).body.items[0];
    const refreshedAt = new Date(recovery + 2000).toISOString();
    tables.dating_1on1_cards[0].recommendation_refresh_used_at = refreshedAt;
    tables.dating_1on1_recommendation_refresh_events.push({ card_id: 'source', refreshed_at: refreshedAt });
    const after = (await runApi(tables, { atTime: recovery + 3000 })).body.items[0];
    assert.equal(after.recovery_refresh_applied, true);
    assert.equal(after.refresh_used_count, 1);
    assert.equal(after.refresh_remaining, plus ? 1 : 0);
    assert.equal(after.recommendations.length, 10);
    assert.equal(after.recommendations.some(c => ids(before.recommendations).includes(c.id)), false);
  }
});

test("recovery cannot restore blocked, active, rejected or withdrawn candidates in either direction", async () => {
  const cutoff = Date.parse('2026-09-08T13:12:00.000Z');
  const recovery = Date.parse('2026-09-08T13:30:00.000Z');
  const phoneLib = load('@/lib/dating-1on1-phone-blocks');
  const contactLib = load('@/lib/dating-contact-blocks');
  for (const reverse of [false, true]) {
    const tables = fixture(10);
    tables.dating_1on1_recommendation_refresh_events = [cutoff - 2 * day, cutoff - 1000]
      .map(ms => ({ card_id: 'source', refreshed_at: new Date(ms).toISOString() }));
    tables.dating_1on1_recommendation_recoveries = [{ user_id: 'user-source', card_id: 'source', refreshed_at: new Date(recovery).toISOString() }];
    tables.dating_user_blocks = [{ blocker_user_id: reverse ? 'user-c0' : 'user-source', blocked_user_id: reverse ? 'user-source' : 'user-c0' }];
    tables.dating_1on1_admin_user_blocks = [{ user_a_id: reverse ? 'user-c1' : 'user-source', user_b_id: reverse ? 'user-source' : 'user-c1' }];
    tables.dating_1on1_phone_blocks = [{ user_id: reverse ? 'user-c2' : 'user-source', phone_hash: phoneLib.hashOneOnOneBlockedPhone(tables.profiles[reverse ? 0 : 3].phone_e164) }];
    tables.dating_contact_blocks = [{ user_id: reverse ? 'user-c3' : 'user-source', block_type: 'phone', value_hash: contactLib.hashDatingContactBlockValue('phone', tables.profiles[reverse ? 0 : 4].phone_e164) }];
    tables.dating_1on1_match_proposals = ['mutual_accepted', 'candidate_rejected'].map((state, i) => {
      const other = `c${i + 4}`;
      return pair({ id: `pair-${other}`, state,
        source_card_id: reverse ? other : 'source', candidate_card_id: reverse ? 'source' : other,
        source_user_id: reverse ? `user-${other}` : 'user-source', candidate_user_id: reverse ? 'user-source' : `user-${other}`,
      });
    });
    tables.profiles = tables.profiles.filter(p => p.user_id !== 'user-c6');
    tables.profiles.find(p => p.user_id === 'user-c7').is_banned = true;
    tables.dating_1on1_candidate_favorites = [{ user_id: 'user-source', source_card_id: 'source', candidate_card_id: 'c8', created_at: new Date(cutoff).toISOString() }];
    const before = structuredClone(tables);
    const result = await runApi(tables, { atTime: recovery + 1000 });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.items[0].recovery_refresh_applied, true);
    assert.deepEqual(ids(allCandidates(result.body)), ['c9']);
    assert.deepEqual(ids(result.body.items[0].favorite_candidates), ['c8']);
    assert.deepEqual(tables, before);
  }
});

test("missing recovery schema, unrelated records or refresh history cannot grant a correction", async () => {
  const atTime = Date.parse('2026-09-08T14:00:00.000Z');
  const tables = fixture(20);
  tables.dating_1on1_recommendation_refresh_events = [atTime - 3 * day, atTime - 2 * day]
    .map(ms => ({ card_id: 'source', refreshed_at: new Date(ms).toISOString() }));
  for (const record of [null,
    { user_id: 'someone-else', card_id: 'source' },
    { user_id: 'user-source', card_id: 'old-source' },
  ]) {
    tables.dating_1on1_recommendation_recoveries = record ? [{ ...record, refreshed_at: new Date(atTime - 1000).toISOString() }] : [];
    const result = await runApi(tables, { atTime });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.items[0].recovery_refresh_applied, false);
  }
  const result = await runApi(tables, { atTime, intercept: q => q.table === 'dating_1on1_recommendation_recoveries'
    ? { data: null, error: { code: 'PGRST205', message: 'recovery table missing' } } : null });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.items[0].recommendations.length, 10);
  assert.equal(result.body.items[0].recovery_refresh_applied, false);
});

test("activity lookup skips already-found busy members without losing quieter members", async () => {
  const tables = fixture(2);
  tables.dating_1on1_match_proposals = Array.from({ length: 2000 }, (_, index) => pair({
    id: `busy-${index}`, source_user_id: "user-c0", source_selected_at: new Date(now - 10000).toISOString(),
  }));
  tables.dating_1on1_match_proposals.push(pair({ id: "quiet", source_user_id: "user-c1", source_selected_at: new Date(now - day).toISOString() }));
  const db = mockDatabase(tables);
  const activity = await load("@/lib/dating-1on1-recommendation-data").fetchRecommendationActivity(db, ["user-c0", "user-c1"], now);
  assert.equal(activity.size, 2);
  assert.equal(db.calls.filter((query) => query.fields.includes("source_selected_at")).length, 2);
});
test("UUID lookup batches stay below the HTTP header limit", async () => {
  const result = await runApi(fixture(605));
  for (const query of result.calls) {
    for (const [operation, key, value] of query.filters) {
      if (operation === "in" && key === "user_id") assert.ok(value.length <= 200);
    }
  }
});

test("phone/contact blocks beyond the first 1000 rows are still enforced", async () => {
  const phoneRows = Array.from({ length: 1105 }, (_, i) => ({ id: String(i).padStart(5, "0"), user_id: "one-user", phone_hash: `hash-${i}` }));
  const contactRows = phoneRows.map((row) => ({ id: row.id, user_id: row.user_id, block_type: "phone", value_hash: row.phone_hash }));
  const db = mockDatabase({ dating_1on1_phone_blocks: phoneRows, dating_contact_blocks: contactRows });
  const phoneMap = await load("@/lib/dating-1on1-phone-blocks").getOneOnOnePhoneBlockMapForUsers(db, ["one-user"]);
  const contactMap = await load("@/lib/dating-contact-blocks").getDatingContactBlockMapForUsers(db, ["one-user"]);
  assert.equal(phoneMap.get("one-user").size, 1105);
  assert.equal(contactMap.get("one-user:phone").size, 1105);
});

for (const reverse of [false, true]) {
  for (const state of ["proposed", "source_selected", "candidate_accepted", "mutual_accepted"]) {
    test(`recreated source AND candidate cannot bypass ${state} (${reverse ? "reverse" : "direct"})`, async () => {
      const tables = fixture(2);
      for (const id of ["source", "c0"]) {
        const current = tables.dating_1on1_cards.find((row) => row.id === id);
        tables.dating_1on1_cards.push({ ...current, id: `old-${id}`, status: "rejected" });
      }
      tables.dating_1on1_match_proposals = [pair({ state,
        source_card_id: reverse ? "old-c0" : "old-source", candidate_card_id: reverse ? "old-source" : "old-c0",
        source_user_id: reverse ? "user-c0" : "user-source", candidate_user_id: reverse ? "user-source" : "user-c0",
        source_selected_at: new Date(Date.now() - 30 * day).toISOString(),
        created_at: new Date(Date.now() - 30 * day).toISOString(),
      })];
      const before = structuredClone(tables);
      assert.deepEqual(ids(allCandidates((await runApi(tables)).body)), ["c1"]);
      for (const admin of [false, true]) {
        const selected = await runSelect(tables, { admin });
        assert.equal(selected.response.status, 409);
        assert.equal(selected.calls.some((query) => query.insert || query.update), false);
        assert.deepEqual(selected.notifications, []);
      }
      assert.equal((await runFavorite(tables)).response.status, 409);
      assert.deepEqual(tables, before);
    });
  }
}

test("gender changed after an old card: no obsolete recommendation and neither endpoint accepts it", async () => {
  const tables = fixture(2);
  tables.dating_1on1_cards.push({ ...tables.dating_1on1_cards[1], id: "new-male", sex: "male", created_at: new Date().toISOString() });
  assert.deepEqual(ids(allCandidates((await runApi(tables)).body)), ["c1"]);
  for (const admin of [false, true]) {
    const result = await runSelect(tables, { admin });
    assert.equal(result.response.status, 409);
    assert.equal(result.calls.some((query) => query.insert), false);
  }
});

test("source gender follows newest card, and stale source selection reloads instead of matching", async () => {
  const tables = fixture(2);
  tables.dating_1on1_cards.push({ ...tables.dating_1on1_cards[0], id: "new-source", sex: "female", created_at: new Date().toISOString() });
  const body = (await runApi(tables)).body;
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].source_card_id, "new-source");
  assert.deepEqual(allCandidates(body), []);
  const result = await runSelect(tables);
  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, "STALE_SOURCE_IDENTITY");
});

test("cross-sex identity duplicates are detected across accounts and phone formats", async () => {
  const tables = fixture(2);
  const newer = { ...tables.dating_1on1_cards[1], id: "new-identity", user_id: "other-account", sex: "male", created_at: new Date().toISOString() };
  newer.phone = "01012345678";
  tables.profiles[1].phone_e164 = "+821012345678";
  tables.dating_1on1_cards[1].phone = "+821012345678";
  tables.dating_1on1_cards.push(newer);
  tables.profiles.push({ user_id: newer.user_id, phone_e164: newer.phone, is_banned: false });
  assert.deepEqual(ids(allCandidates((await runApi(tables)).body)), ["c1"]);
  assert.equal((await runSelect(tables)).response.status, 409);
});

test("same-timestamp latest identity uses the same deterministic ID tie-break for display and selection", async () => {
  const tables = fixture(2);
  tables.dating_1on1_cards.push({ ...tables.dating_1on1_cards[1], id: "z-new" });
  assert.deepEqual(new Set(ids(allCandidates((await runApi(tables)).body))), new Set(["c1", "z-new"]));
  assert.equal((await runSelect(tables)).response.status, 409);
  assert.equal((await runSelect(tables, { candidateId: "z-new" })).response.status, 200);
});

test("all historical rows are checked: closed rows cannot conceal an old pending request after 1000 rows", async () => {
  const tables = fixture(1);
  tables.dating_1on1_match_proposals = Array.from({ length: 1001 }, (_, i) => pair({ id: `closed-${i}`, state: "admin_canceled" }));
  tables.dating_1on1_match_proposals.push(pair({ id: "live", candidate_card_id: "old-c0", source_selected_at: "2025-01-01T00:00:00Z", created_at: "2025-01-01T00:00:00Z" }));
  assert.deepEqual(allCandidates((await runApi(tables)).body), []);
  const result = await runSelect(tables);
  assert.equal(result.response.status, 409);
  assert.equal(result.calls.some((query) => query.update || query.insert), false);
});

for (const reverse of [false, true]) test(`pending requests never expire through recommendations or resend (${reverse ? "reverse" : "direct"})`, async () => {
  for (const stamp of [new Date(now - 2 * day + 1).toISOString(), new Date(now - 2 * day).toISOString(),
    new Date(now - 2 * day - 1).toISOString(), new Date(now - 90 * day).toISOString(), null, "invalid", new Date(now + day).toISOString()]) {
    const tables = fixture(2);
    tables.dating_1on1_match_proposals = [pair({ source_selected_at: stamp, updated_at: stamp, created_at: stamp,
      source_card_id: reverse ? "c0" : "source", candidate_card_id: reverse ? "source" : "c0",
      source_user_id: reverse ? "user-c0" : "user-source", candidate_user_id: reverse ? "user-source" : "user-c0",
    })];
    tables.dating_1on1_candidate_favorites = [{ id: "saved", user_id: "user-source", source_card_id: "source", candidate_card_id: "c0", created_at: new Date(now).toISOString() }];
    const before = structuredClone(tables);
    const recommendations = await runApi(tables, { atTime: now });
    assert.equal(recommendations.response.status, 200);
    assert.deepEqual(ids(allCandidates(recommendations.body)), ["c1"]);
    assert.deepEqual(recommendations.body.items[0].favorite_candidates, []);
    const result = await runSelect(tables, { atTime: now });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.code, "CANDIDATE_ALREADY_HANDLED");
    assert.match(result.body.error, /기존 매칭은 그대로 유지/);
    assert.deepEqual(result.notifications, []);
    assert.ok(result.calls.every(q => !q.insert && !q.update && !q.delete));
    assert.equal((await runFavorite(tables)).response.status, 409);
    assert.deepEqual(tables, before);
  }
});

for (const plus of [false, true]) test(`refresh excludes old pending requests without extra quota writes (Plus=${plus})`, async () => {
  const tables = fixture(80);
  if (plus) tables.dating_1on1_plus_subscriptions = [{ user_id: "user-source", starts_at: new Date(now - day).toISOString(), expires_at: new Date(now + day).toISOString() }];
  tables.dating_1on1_match_proposals = Array.from({ length: 20 }, (_, i) => pair({
    id: `pending-${i}`, candidate_card_id: `c${i}`, candidate_user_id: `user-c${i}`, source_selected_at: new Date(now - 30 * day).toISOString(),
  }));
  const pairsBefore = structuredClone(tables.dating_1on1_match_proposals);
  const result = await runRefresh(tables);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.refresh_consumed, true);
  assert.equal(result.rpcCalls.length, 1);
  assert.equal(result.rpcCalls[0].p_limit, plus ? 2 : 1);
  const after = await runApi(tables, { atTime: now + 1 });
  assert.ok(allCandidates(after.body).every(c => Number(c.id.slice(1)) >= 20));
  assert.equal(allCandidates(after.body).length, 13);
  assert.deepEqual(tables.dating_1on1_match_proposals, pairsBefore);
});

test("an entirely pending pool never consumes a refresh or recycles a request", async () => {
  const tables = fixture(1);
  tables.dating_1on1_match_proposals = [pair({ source_selected_at: new Date(now - 30 * day).toISOString() })];
  const before = structuredClone(tables);
  const result = await runRefresh(tables);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.refresh_consumed, false);
  assert.equal(result.rpcCalls.length, 0);
  assert.deepEqual(tables, before);
});

test("explicitly canceled pairs remain recyclable without rewriting their history", async () => {
  for (const state of ["source_skipped", "admin_canceled"]) {
    const tables = fixture(1);
    tables.dating_1on1_match_proposals = [pair({ state, updated_at: new Date(now - 30 * day).toISOString() })];
    const closed = structuredClone(tables.dating_1on1_match_proposals[0]);
    assert.deepEqual(ids(allCandidates((await runApi(tables, { atTime: now })).body)), ["c0"]);
    const result = await runSelect(tables, { atTime: now });
    assert.equal(result.response.status, 200);
    assert.deepEqual(tables.dating_1on1_match_proposals[0], closed);
    assert.equal(tables.dating_1on1_match_proposals[1].state, "source_selected");
    assert.deepEqual(result.notifications.sort(), ["email", "site", "sms"]);
    const repeat = await runSelect(tables, { atTime: now });
    assert.equal(repeat.response.status, 409);
    assert.deepEqual(repeat.notifications, []);
    assert.equal(tables.dating_1on1_match_proposals.length, 2);
  }
});

test("a concurrent insert conflict never cancels history or sends notifications", async () => {
  const tables = fixture(1);
  const before = structuredClone(tables);
  const result = await runSelect(tables, { intercept: query => query.insert ? { data: null, error: { code: "23505", message: "duplicate pair" } } : null });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, "CANDIDATE_PAIR_ACTIVE");
  assert.deepEqual(result.notifications, []);
  assert.ok(result.calls.every(q => !q.update && !q.delete));
  assert.deepEqual(tables, before);
});

test("normal selection succeeds, but replay cannot insert a second user-pair", async () => {
  for (const admin of [false, true]) {
    const tables = fixture(1);
    assert.equal((await runSelect(tables, { admin })).response.status, 200);
    assert.equal((await runSelect(tables, { admin })).response.status, 409);
    assert.equal(tables.dating_1on1_match_proposals.length, 1);
  }
});

test("selection still rejects banned, withdrawn, blocked and permanently rejected members", async () => {
  for (const condition of ["banned", "withdrawn", "blocked", "rejected", "reverse-rejected"]) {
    const tables = fixture(1);
    if (condition === "banned") tables.profiles[1].is_banned = true;
    if (condition === "withdrawn") tables.profiles.pop();
    if (condition === "blocked") tables.dating_user_blocks = [{ id: "block", blocker_user_id: "user-c0", blocked_user_id: "user-source" }];
    if (condition === "rejected") tables.dating_1on1_match_proposals = [pair({ state: "candidate_rejected", candidate_card_id: "old-c0" })];
    if (condition === "reverse-rejected") tables.dating_1on1_match_proposals = [pair({ state: "source_declined", source_user_id: "user-c0", candidate_user_id: "user-source" })];
    for (const admin of [false, true]) {
      const result = await runSelect(tables, { admin });
      assert.equal(result.response.status, 409, condition);
      assert.equal(result.calls.some((query) => query.insert), false);
    }
  }
});

test("new identity/history safety queries fail closed", async () => {
  const failure = { data: null, error: { code: "XX000", message: "backend unavailable" } };
  for (const field of ["id,user_id,phone,created_at,birth_year", "id,source_card_id,candidate_card_id,source_user_id,candidate_user_id,state,source_selected_at,updated_at,created_at"]) {
    const intercept = (query) => query.fields === field ? failure : null;
    assert.equal((await runApi(fixture(1), { intercept })).response.status, 500);
    for (const admin of [false, true]) {
      const result = await runSelect(fixture(1), { intercept, admin });
      assert.equal(result.response.status, 500);
      assert.equal(result.calls.some((query) => query.insert), false);
    }
  }
});

test("selection preserves authentication, admin-role and source ownership boundaries", async () => {
  assert.equal((await runSelect(fixture(), { signedIn: false })).response.status, 401);
  assert.equal((await runSelect(fixture(), { admin: true, allowedAdmin: false })).response.status, 403);
  assert.equal((await runSelect(fixture(), { sourceId: "c1" })).response.status, 403);
});

test("large pools validate only the displayed shortlist, without loading all identity rows", async () => {
  const result = await runApi(fixture(1005));
  const ownerLookups = result.calls.filter((query) => query.fields === "id,user_id,phone,created_at,birth_year" &&
    query.filters.some(([op, key]) => op === "in" && key === "user_id"));
  assert.equal(ownerLookups.length, 1);
  assert.equal(ownerLookups[0].filters.find(([op, key]) => op === "in" && key === "user_id")[2].length, 14);
  assert.equal(allCandidates(result.body).length, 13);
});

test("stale shortlist members are refilled, and an entirely stale pool terminates without leaking photos", async () => {
  for (const staleCount of [20, 30]) {
    const tables = fixture(30);
    for (const row of tables.dating_1on1_cards.slice(1, staleCount + 1)) {
      tables.dating_1on1_cards.push({ ...row, id: `new-${row.id}`, sex: "male", created_at: new Date().toISOString() });
    }
    const result = await runApi(tables);
    assert.equal(result.response.status, 200);
    const candidates = allCandidates(result.body);
    assert.equal(candidates.length, 30 - staleCount);
    assert.equal(new Set(ids(candidates)).size, candidates.length);
    const photoScans = result.calls.filter((query) => query.fields.includes("photo_paths"));
    assert.equal(photoScans.length, staleCount === 30 ? 0 : 1);
    assert.ok(result.calls.length < 100);
  }
});
