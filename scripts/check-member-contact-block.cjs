/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const modules = {};
let db, user;
function load(file) {
  if (modules[file]) return modules[file];
  const m = { exports: {} };
  const mocks = {
    '@/lib/supabase/server': { createAdminClient: () => db },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user }) },
    '@/lib/request-rate-limit': { checkRouteRateLimit: async () => ({ allowed: true }), extractClientIp: () => 'test' },
  };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => mocks[name] || (name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name)), m, m.exports);
  return (modules[file] = m.exports);
}
const helper = load('lib/dating-member-contact-block.ts');
const contact = load('lib/dating-contact-blocks.ts');
const legacy = load('lib/dating-1on1-phone-blocks.ts');
const blocks = load('app/api/dating/blocks/route.ts');
const unblock = load('app/api/dating/blocks/[userId]/route.ts');
const contacts = load('app/api/dating/contact-blocks/route.ts');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const PHONE = '+821012345678';
function database() {
  const tables = { profiles: [{ user_id: B, phone_verified: true, phone_e164: PHONE }], dating_user_blocks: [], dating_contact_blocks: [] };
  const errors = {};
  return { tables, errors, from(table) {
    let operation = 'select', payload, options, single = false;
    const filters = [];
    const q = {
      select() { return q; }, order() { return q; }, limit() { return q; }, range() { return q; },
      eq(k, v) { filters.push(r => r[k] === v); return q; },
      in(k, vs) { filters.push(r => vs.includes(r[k])); return q; },
      upsert(v, o) { operation = 'upsert'; payload = v; options = o; return q; },
      update(v) { operation = 'update'; payload = v; return q; },
      delete() { operation = 'delete'; return q; },
      single() { single = true; return q; }, maybeSingle() { single = true; return q; },
      then(resolve, reject) {
        const error = errors[table + ':' + operation];
        if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
        let rows = tables[table].filter(r => filters.every(f => f(r)));
        if (operation === 'upsert') {
          const keys = options.onConflict.split(',');
          let row = tables[table].find(r => keys.every(k => r[k] === payload[k]));
          if (!row) { row = { id: crypto.randomUUID(), ...payload }; tables[table].push(row); }
          else if (!options.ignoreDuplicates) Object.assign(row, payload);
          rows = [row];
        }
        if (operation === 'delete') tables[table] = tables[table].filter(r => !rows.includes(r));
        if (operation === 'update') rows.forEach(r => Object.assign(r, payload));
        return Promise.resolve({ data: single ? rows[0] || null : rows.map(r => ({ ...r })), error: null }).then(resolve, reject);
      },
    };
    return q;
  } };
}
function request(body, method = 'POST') { return new Request('https://helchang.com/api/dating/blocks', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
function reset() { db = database(); user = { id: A }; }
test('block persists a private verified identity and blocks a recreated account in both directions', async () => {
  reset();
  assert.equal((await blocks.POST(request({ blocked_user_id: B }))).status, 200);
  const row = db.tables.dating_contact_blocks[0];
  assert.equal(row.value_hash, contact.hashDatingContactBlockValue('phone', PHONE));
  assert.equal(row.value_hint, '회원 차단 연동');
  assert.ok(!JSON.stringify(row).includes(PHONE));
  const listing = await (await contacts.GET(request({}))).json();
  assert.equal(listing.items[0].label, '회원 차단 · 재가입 방지');
  assert.ok(!JSON.stringify(listing).includes(B));
  // Auth deletion cascades the old UUID pair; contact ownership remains A.
  db.tables.dating_user_blocks = [];
  db.tables.profiles = [{ user_id: C, phone_e164: PHONE, phone_verified: true }];
  assert.equal(await contact.hasDatingContactPhoneBlockBetween(db, A, C), true);
  assert.equal(await contact.hasDatingContactPhoneBlockBetween(db, C, A), true);
  assert.equal((await blocks.POST(request({ blocked_user_id: C }))).status, 200);
  assert.equal(helper.memberBlockSource(row.label), C);
  assert.equal((await unblock.DELETE(request({}, 'DELETE'), { params: Promise.resolve({ userId: C }) })).status, 200);
  assert.equal(db.tables.dating_contact_blocks.length, 0);
});
test('unverified phone is never used for identity blocking', async () => {
  reset(); db.tables.profiles[0].phone_verified = false;
  assert.equal((await blocks.POST(request({ blocked_user_id: B }))).status, 200);
  assert.equal(db.tables.dating_user_blocks.length, 1);
  assert.equal(db.tables.dating_contact_blocks.length, 0);
});
test('unblocking one of two accounts sharing a phone preserves the other block', async () => {
  reset(); db.tables.profiles.push({ user_id: C, phone_e164: PHONE, phone_verified: true });
  await blocks.POST(request({ blocked_user_id: B }));
  await blocks.POST(request({ blocked_user_id: C }));
  assert.equal(helper.memberBlockSource(db.tables.dating_contact_blocks[0].label), B);
  await unblock.DELETE(request({}, 'DELETE'), { params: Promise.resolve({ userId: B }) });
  assert.equal(helper.memberBlockSource(db.tables.dating_contact_blocks[0].label), C);
  assert.equal(await contact.hasDatingContactPhoneBlockBetween(db, A, C), true);
});
test('manual contact block survives member block and unblock', async () => {
  reset();
  const row = await helper.prepareMemberContactBlock(db, A, B);
  db.tables.dating_contact_blocks.push({ ...row, id: 'manual', label: '직접 등록' });
  await blocks.POST(request({ blocked_user_id: B }));
  await unblock.DELETE(request({}, 'DELETE'), { params: Promise.resolve({ userId: B }) });
  assert.equal(db.tables.dating_contact_blocks[0].label, '직접 등록');
});
test('contact unblock clears linked UUID block but cannot touch another owner', async () => {
  reset(); await blocks.POST(request({ blocked_user_id: B }));
  const id = db.tables.dating_contact_blocks[0].id;
  user = { id: C }; await contacts.DELETE(request({ id }, 'DELETE'));
  assert.equal(db.tables.dating_user_blocks.length, 1);
  user = { id: A }; await contacts.DELETE(request({ id }, 'DELETE'));
  assert.equal(db.tables.dating_user_blocks.length, 0);
  assert.equal(db.tables.dating_contact_blocks.length, 0);
});
test('partial write fails visibly, current account stays blocked, retry is idempotent', async () => {
  reset(); db.errors['dating_contact_blocks:upsert'] = { code: '42501' };
  assert.equal((await blocks.POST(request({ blocked_user_id: B }))).status, 503);
  assert.equal(db.tables.dating_user_blocks.length, 1);
  delete db.errors['dating_contact_blocks:upsert'];
  await blocks.POST(request({ blocked_user_id: B })); await blocks.POST(request({ blocked_user_id: B }));
  assert.equal(db.tables.dating_contact_blocks.length, 1);
  assert.equal(db.tables.dating_user_blocks.length, 1);
});
test('identity read failure cannot return success; anonymous and malformed requests cannot mutate', async () => {
  reset(); db.errors['profiles:select'] = { code: '57014' };
  assert.equal((await blocks.POST(request({ blocked_user_id: B }))).status, 503);
  assert.equal(db.tables.dating_user_blocks.length, 0);
  assert.equal((await blocks.POST(request({ blocked_user_id: 'bad' }))).status, 400);
  user = null;
  assert.equal((await blocks.POST(request({ blocked_user_id: B }))).status, 401);
});
test('query failures mentioning table/column must not silently disable blocking', async () => {
  reset();
  for (const error of [{ code: '42501', message: 'permission denied for dating_contact_blocks' }, { code: '57014', message: 'timeout dating_contact_blocks schema cache' }]) {
    assert.equal(contact.isMissingDatingContactBlocksTableError(error), false);
    db.errors['dating_contact_blocks:select'] = error;
    await assert.rejects(contact.getDatingContactBlockMapForUsers(db, [A]));
  }
  assert.equal(legacy.isMissingPhoneBlocksTableError({ code: '42501', message: 'permission denied dating_1on1_phone_blocks' }), false);
  db.errors['profiles:select'] = { code: '57014', message: 'timeout phone_e164' };
  await assert.rejects(contact.getDatingProfilePhoneMapForUsers(db, [A]));
});
test('contact deletion failure is retryable and cannot claim success', async () => {
  reset(); await blocks.POST(request({ blocked_user_id: B }));
  db.errors['dating_contact_blocks:delete'] = { code: '57014' };
  assert.equal((await unblock.DELETE(request({}, 'DELETE'), { params: Promise.resolve({ userId: B }) })).status, 503);
  assert.equal(db.tables.dating_contact_blocks.length, 1);
  delete db.errors['dating_contact_blocks:delete'];
  assert.equal((await unblock.DELETE(request({}, 'DELETE'), { params: Promise.resolve({ userId: B }) })).status, 200);
});
test('cross-site requests cannot create a block', async () => {
  reset();
  const r = new Request('https://helchang.com/api/dating/blocks', { method: 'POST', headers: { origin: 'https://evil.example', host: 'helchang.com' }, body: JSON.stringify({ blocked_user_id: B }) });
  assert.equal((await blocks.POST(r)).status, 403);
  assert.equal(db.tables.dating_user_blocks.length, 0);
});
test('real SQL foreign keys retain identity block after target deletion and remove it on blocker deletion', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite();
  try {
    await pg.exec(`create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create role anon; create role authenticated; create role service_role;`);
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/sql/dating_user_blocks_repair.sql'), 'utf8'));
    const schema = fs.readFileSync(path.join(root, 'supabase/sql/dating_contact_blocks.sql'), 'utf8');
    await pg.exec(schema.slice(0, schema.indexOf('create table if not exists public.dating_1on1_match_hides')) + '\ncommit;');
    await pg.query('insert into auth.users values ($1),($2)', [A, B]);
    await pg.query('insert into dating_user_blocks(blocker_user_id,blocked_user_id) values ($1,$2)', [A, B]);
    await pg.query("insert into dating_contact_blocks(user_id,block_type,value_hash,label) values ($1,'phone',$2,$3)", [A, contact.hashDatingContactBlockValue('phone', PHONE), 'member-block:' + B]);
    await pg.query('delete from auth.users where id=$1', [B]);
    assert.equal((await pg.query('select * from dating_user_blocks')).rows.length, 0);
    assert.equal((await pg.query('select * from dating_contact_blocks')).rows.length, 1);
    await pg.query('delete from auth.users where id=$1', [A]);
    assert.equal((await pg.query('select * from dating_contact_blocks')).rows.length, 0);
  } finally { await pg.close(); }
});
