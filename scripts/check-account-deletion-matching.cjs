/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('lib/account-deletion.ts', 'utf8');
const mod = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)((name) => name === '@/lib/dating-cards-queue'
  ? { promotePendingCardsBySex: async () => {} } : require(name), mod, mod.exports);

async function check(config = {}) {
  const cards = [
    { id: 'a', user_id: 'self', status: 'approved' },
    { id: 'b', user_id: 'self', status: 'submitted' },
    { id: 'c', user_id: 'other', status: 'approved' },
    { id: 'd', user_id: 'self', status: 'rejected' },
  ];
  let authCalls = 0;
  const admin = {
    auth: { admin: { deleteUser: async (_, soft) => {
      authCalls++;
      assert.equal(cards[0].status, 'rejected', 'hide before Auth deletion');
      assert.equal(cards[1].status, 'rejected');
      return { error: config.failBoth || (config.soft && !soft) ? { message: 'simulated failure' } : null };
    } } },
    from(table) {
      const filters = [];
      let patch;
      const q = {
        select: () => q, insert: () => q, delete: () => q,
        update: (value) => { patch = value; return q; },
        eq: (key, value) => { filters.push((r) => r[key] === value); return q; },
        in: (key, values) => { filters.push((r) => values.includes(r[key])); return q; },
        then(ok, fail) {
          return Promise.resolve().then(() => {
            if (table !== 'dating_1on1_cards') return { data: [], error: null };
            if (config.hideError && patch?.status === 'rejected') return { error: { message: 'hide failed' } };
            const rows = cards.filter((r) => filters.every((f) => f(r)));
            const data = rows.map((r) => ({ ...r }));
            if (patch) rows.forEach((r) => Object.assign(r, patch));
            return { data, error: null };
          }).then(ok, fail);
        },
      };
      return q;
    },
  };
  const result = await mod.exports.performAccountDeletion({ admin, userId: 'self', email: null, nickname: 'test' });
  assert.equal(cards[2].status, 'approved', 'other member unchanged');
  assert.equal(cards[3].status, 'rejected', 'previously hidden card unchanged');
  if (config.failBoth || config.hideError) {
    assert.equal(result.ok, false);
    assert.equal(cards[0].status, 'approved');
    assert.equal(cards[1].status, 'submitted');
    if (config.hideError) assert.equal(authCalls, 0);
  } else {
    assert.equal(result.ok, true);
    assert.equal(result.mode, config.soft ? 'soft' : 'hard');
    assert.equal(cards[0].status, 'rejected');
    assert.equal(cards[1].status, 'rejected');
  }
}
(async () => {
  for (const config of [{}, { soft: true }, { failBoth: true }, { hideError: true }]) await check(config);
  console.log('PASS: hard/soft deletion hides 1:1 cards; failure restores; hide failure stops deletion; other users unchanged');
})().catch((error) => { console.error(error); process.exitCode = 1; });
